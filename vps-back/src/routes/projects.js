const express = require("express");
const axios = require("axios");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const path = require("path");
const { detectFramework } = require("../lib/detector");
const { cloneRepo } = require("../lib/git");
const { analyzeWorkspace } = require("../lib/analyzer");

const router = express.Router();

// POST /api/projects/analyze
router.post("/analyze", authRequired, async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "Missing projectId" });

  try {
    const project = await prisma.project.findUnique({
        where: { id: projectId }
    });

    if (!project || project.userId !== req.user.id) {
        return res.status(404).json({ error: "Project not found" });
    }

    if (project.cloneStatus !== "CLONED" || !project.workspacePath) {
        return res.status(400).json({ error: "Project not cloned yet" });
    }

    // Perform Analysis
    const config = await analyzeWorkspace(project.workspacePath);

    // Update DB
    const updated = await prisma.project.update({
        where: { id: projectId },
        data: {
            analysisStatus: "ANALYZED",
            runtime: config.runtime,
            framework: config.framework !== "unknown" ? config.framework : project.framework, // prefer deep analysis, fallback to initial detect
            packageManager: config.packageManager,
            buildCommand: config.buildCommand,
            startCommand: config.startCommand,
            outputDir: config.outputDir,
            port: config.port
        }
    });

    res.json({ success: true, project: updated, config });

  } catch (err) {
    console.error("Analysis failed:", err.message);
    await prisma.project.update({
        where: { id: projectId },
        data: { analysisStatus: "FAILED" }
    });
    res.status(500).json({ error: "Failed to analyze workspace" });
  }
});

// POST /api/projects/clone
router.post("/clone", authRequired, async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: "Missing projectId" });

  try {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { user: { include: { github: true } } }
    });

    if (!project || project.userId !== req.user.id) {
        return res.status(404).json({ error: "Project not found" });
    }

    const token = project.user.github?.accessToken;
    if (!token) return res.status(400).json({ error: "GitHub token missing" });

    // Define workspace path
    // vps-back/workspaces/<userId>/<projectName>
    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(__dirname, "../../workspaces");
    const targetDir = path.join(workspaceRoot, req.user.id, project.name);

    // Update status to pending
    await prisma.project.update({
        where: { id: projectId },
        data: { cloneStatus: "PENDING" }
    });

    // Perform Clone
    await cloneRepo(project.repoFullName, project.branch, token, targetDir);

    // Update DB on success
    const updated = await prisma.project.update({
        where: { id: projectId },
        data: { 
            workspacePath: targetDir,
            cloneStatus: "CLONED"
        }
    });

    res.json({ success: true, project: updated });

  } catch (err) {
    console.error("Clone route error:", err.message);
    
    // Update DB on failure
    await prisma.project.update({
        where: { id: projectId },
        data: { cloneStatus: "FAILED" }
    });

    res.status(500).json({ error: "Failed to clone repository" });
  }
});

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
