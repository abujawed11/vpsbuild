const express = require("express");
const axios = require("axios");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

// 1) Redirect user to GitHub OAuth
router.get("/connect", authRequired, (req, res) => {
  const state = Buffer.from(JSON.stringify({
    userId: req.user.id,
    t: Date.now()
  })).toString("base64url");

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_CALLBACK_URL,
    scope: "read:user repo",
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// 2) GitHub callback -> exchange code for access token -> save
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code/state");

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
      redirect_uri: process.env.GITHUB_CALLBACK_URL,
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

  // Redirect back to frontend
  const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
  res.redirect(`${frontend}/dashboard?connected=1`);
});

module.exports = router;
