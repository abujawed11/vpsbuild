const express = require("express");
const axios = require("axios");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const { detectFramework } = require("../lib/detector");

const router = express.Router();

// POST /api/projects/import
// Input: { repoFullName: "user/repo", repoId: 12345, branch: "main" }
router.post("/import", authRequired, async (req, res) => {
  const { repoFullName, repoId, branch } = req.body;

  if (!repoFullName) {
    return res.status(400).json({ error: "Missing repoFullName" });
  }

  try {
    // 1. Get User's GitHub Token
    const account = await prisma.githubAccount.findUnique({
      where: { userId: req.user.id },
    });

    if (!account) {
      return res.status(400).json({ error: "GitHub account not connected" });
    }

    // 2. Fetch Repo Details (for default branch fallback)
    const { data: repoInfo } = await axios.get(
      `https://api.github.com/repos/${repoFullName}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } }
    );

    const targetBranch = branch || repoInfo.default_branch || "main";

    // 3. Detect Framework (pass branch!)
    const detectedType = await detectFramework(repoFullName, account.accessToken, targetBranch);

    // 4. Save to Database
    // Use repo name as project name (ensure uniqueness for user)
    const name = repoInfo.name;

    const project = await prisma.project.upsert({
      where: {
        userId_name: {
          userId: req.user.id,
          name: name,
        },
      },
      update: {
        repoFullName,
        branch: targetBranch,
        framework: detectedType,
      },
      create: {
        userId: req.user.id,
        name: name,
        repoFullName,
        branch: targetBranch,
        framework: detectedType,
      },
    });

    res.json({ success: true, project });

  } catch (err) {
    console.error("Project import failed:", err.message);
    res.status(500).json({ error: "Failed to analyze and import project" });
  }
});

module.exports = router;
