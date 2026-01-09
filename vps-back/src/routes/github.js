const express = require("express");
const axios = require("axios");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

// 1) Redirect user to GitHub OAuth
router.get("/connect", authRequired, (req, res) => {
  if (!process.env.PUBLIC_BASE_URL) {
    console.error("Missing PUBLIC_BASE_URL env var");
    return res.status(500).send("Server configuration error");
  }
  
  const REDIRECT_URI = `${process.env.PUBLIC_BASE_URL}/api/github/callback`;
  
  const state = Buffer.from(JSON.stringify({
    userId: req.user.id,
    t: Date.now()
  })).toString("base64url");

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "read:user repo",
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// 2) GitHub callback -> exchange code for access token -> save
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code/state");

  if (!process.env.PUBLIC_BASE_URL) {
      console.error("Missing PUBLIC_BASE_URL env var");
      return res.status(500).send("Server configuration error");
  }
  
  const REDIRECT_URI = `${process.env.PUBLIC_BASE_URL}/api/github/callback`;

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return res.status(400).send("Invalid state");
  }

  const userId = parsed.userId;
  if (!userId) return res.status(400).send("Invalid state");

  // Exchange code -> access token
  const tokenRes = await axios.post(
    "https://github.com/login/oauth/access_token",
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI, // MUST MATCH EXACTLY what was sent in step 1
    },
    { headers: { Accept: "application/json" } }
  );

  const accessToken = tokenRes.data?.access_token;
  if (!accessToken) return res.status(400).send("Token exchange failed");

  // Fetch GitHub user profile
  const me = await axios.get("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const githubUserId = String(me.data.id);
  const username = me.data.login;

  // Upsert GithubAccount
  await prisma.githubAccount.upsert({
    where: { userId },
    update: { accessToken, githubUserId, username },
    create: { userId, accessToken, githubUserId, username },
  });

  // Redirect back to frontend dashboard
  // We assume frontend is served at root of PUBLIC_BASE_URL
  res.redirect(`${process.env.PUBLIC_BASE_URL}/dashboard?connected=1`);
});

// 3) List user repos
router.get("/repos", authRequired, async (req, res) => {
  try {
    const account = await prisma.githubAccount.findUnique({
      where: { userId: req.user.id }
    });

    if (!account) {
      return res.status(400).json({ error: "No GitHub account connected" });
    }

    // Fetch repos from GitHub (defaults to public + private if scope allows)
    const { data } = await axios.get("https://api.github.com/user/repos?sort=updated&per_page=100", {
      headers: { Authorization: `Bearer ${account.accessToken}` }
    });

    const repos = data.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      html_url: r.html_url,
    }));

    res.json({ repos });
  } catch (err) {
    console.error("GitHub repos error:", err.message);
    res.status(500).json({ error: "Failed to fetch repos from GitHub" });
  }
});

// 4) List branches for a repo
router.get("/branches", authRequired, async (req, res) => {
  const { repo } = req.query; // e.g. "facebook/react"
  if (!repo) return res.status(400).json({ error: "Missing repo param" });

  try {
    const account = await prisma.githubAccount.findUnique({
      where: { userId: req.user.id }
    });

    if (!account) {
      return res.status(400).json({ error: "No GitHub account connected" });
    }

    // Fetch branches (max 100)
    const { data } = await axios.get(`https://api.github.com/repos/${repo}/branches?per_page=100`, {
      headers: { Authorization: `Bearer ${account.accessToken}` }
    });

    const branches = data.map((b) => ({
      name: b.name,
      protected: b.protected
    }));

    res.json({ branches });
  } catch (err) {
    console.error("GitHub branches error:", err.message);
    res.status(500).json({ error: "Failed to fetch branches" });
  }
});

module.exports = router;
