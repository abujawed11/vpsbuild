const express = require("express");
const axios = require("axios");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const { detectFramework } = require("../lib/detector");
const { cloneRepo } = require("../lib/git");
const { analyzeWorkspace } = require("../lib/analyzer");
const { getDirectoryChildren } = require("../lib/file-utils");
const {
    generateNodeBackendDockerfile,
    generatePythonBackendDockerfile,
    generateFrontendDockerfile,
    writeDockerfile
} = require("../lib/docker-generator");

const router = express.Router();

// GET /api/projects
router.get("/", authRequired, async (req, res) => {
    try {
        const projects = await prisma.project.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: "desc" },
            include: {
                deployments: {
                    orderBy: { createdAt: "desc" },
                    take: 1 // Get only the latest deployment
                }
            }
        });

        // Add hasDeployedVersion flag to each project
        const projectsWithStatus = projects.map(p => ({
            ...p,
            latestDeployment: p.deployments[0] || null,
            hasDeployedVersion: p.deployments.some(d => d.status === "DEPLOYED")
        }));

        res.json({ projects: projectsWithStatus });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch projects" });
    }
});

// GET /api/projects/:id/deploy-config
router.get("/:id/deploy-config", authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }
        res.json({
            deployType: project.deployType,
            backendRoot: project.backendRoot,
            frontendRoot: project.frontendRoot,
            dockerfileBackendContent: project.dockerfileBackendContent,
            dockerfileFrontendContent: project.dockerfileFrontendContent,
            dockerfileGenerated: project.dockerfileGenerated
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to get config" });
    }
});

// POST /api/projects/:id/deploy-type
router.post("/:id/deploy-type", authRequired, async (req, res) => {
    const { id } = req.params;
    const { deployType } = req.body; // BACKEND, FRONTEND, FULLSTACK

    if (!["BACKEND", "FRONTEND", "FULLSTACK"].includes(deployType)) {
        return res.status(400).json({ error: "Invalid deployType" });
    }

    try {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        await prisma.project.update({
            where: { id },
            data: { deployType }
        });

        res.json({ success: true, deployType });
    } catch (err) {
        res.status(500).json({ error: "Failed to set deploy type" });
    }
});

// POST /api/projects/:id/generate-dockerfiles
router.post("/:id/generate-dockerfiles", authRequired, async (req, res) => {
    const { id } = req.params;

    try {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        const workspacePath = project.workspacePath;
        if (!workspacePath) return res.status(400).json({ error: "Workspace not ready" });

        // Validate FULLSTACK configuration before generation
        if (project.deployType === "FULLSTACK") {
            // Both roots must be explicitly set for fullstack
            if (project.backendRoot === null || project.frontendRoot === null) {
                return res.status(400).json({
                    error: "FULLSTACK deployment requires both frontend and backend folders to be configured. Please click 'Configure folders' to set them."
                });
            }
            // Ensure they're not in the same directory (would overwrite Dockerfiles)
            if (project.backendRoot === project.frontendRoot) {
                return res.status(400).json({
                    error: "Backend and frontend must be in different directories for FULLSTACK deployment."
                });
            }
        }

        let backendContent = null;
        let frontendContent = null;

        // Helper to get config
        const getConfig = async (rootRel) => {
            return await analyzeWorkspace(workspacePath, rootRel || "");
        };

        // Generate Backend
        if (project.deployType === "BACKEND" || project.deployType === "FULLSTACK") {
            let root = project.backendRoot;
            // Default to root directory if not set (for BACKEND-only deploys)
            if (root === null) root = "";

            const config = await getConfig(root);

            // Generate appropriate Dockerfile based on runtime
            if (config.runtime === "node") {
                backendContent = generateNodeBackendDockerfile(config);
            } else if (config.runtime === "python") {
                backendContent = generatePythonBackendDockerfile(config);
            } else {
                throw new Error(`Unsupported backend runtime: ${config.runtime}. Expected 'node' or 'python'.`);
            }

            // Write file
            const targetDir = path.join(workspacePath, root);
            await writeDockerfile(backendContent, targetDir);
        }

        // Generate Frontend
        if (project.deployType === "FRONTEND" || project.deployType === "FULLSTACK") {
            let root = project.frontendRoot;
            // Default to root directory if not set (for FRONTEND-only deploys)
            if (root === null) root = "";

            const config = await getConfig(root);
            frontendContent = generateFrontendDockerfile(config);

            // Write file
            const targetDir = path.join(workspacePath, root);
            await writeDockerfile(frontendContent, targetDir);
        }

        // Update DB
        await prisma.project.update({
            where: { id },
            data: {
                dockerfileGenerated: true,
                dockerfileBackendContent: backendContent,
                dockerfileFrontendContent: frontendContent,
                dockerfileBackendSource: "GENERATED",
                dockerfileFrontendSource: "GENERATED"
            }
        });

        res.json({ success: true, backendContent, frontendContent });

    } catch (err) {
        console.error("Dockerfile generation error:", err.message);
        res.status(500).json({ error: "Failed to generate Dockerfiles" });
    }
});

// GET /api/projects/:id/tree
// Query: ?path=src/components (optional)
router.get("/:id/tree", authRequired, async (req, res) => {
    const { id } = req.params;
    const { path: relPath } = req.query;

    try {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }
        if (!project.workspacePath) {
            return res.status(400).json({ error: "Workspace not ready" });
        }

        if (relPath) {
            // Lazy load specific folder
            const children = await getDirectoryChildren(project.workspacePath, relPath);
            res.json({ children });
        } else {
            // Initial load: root signals + root children
            // We can reuse getDirectoryChildren for the children list
            const children = await getDirectoryChildren(project.workspacePath, "");
            
            // We need to manually construct the root node to hold signals for the root itself
            const fs = require("fs");
            const path = require("path");
            // Re-importing fs/path here is ugly but effective for this quick snippet without modifying imports globally
            // Actually they are already available in file-utils scope but we are in routes.
            // Let's rely on file-utils logic or just move this logic to file-utils.
            // Since I removed scanWorkspaceForRoots logic from file-utils partially, let's fix this.
            
            // I'll call getDirectoryChildren("") which returns children of root.
            // But I also need root's signals.
            // I'll add a helper in file-utils for "getRootInfo" or just do it here.
            // I'll do it here for now using `scanWorkspaceForRoots` if I hadn't deleted it? 
            // I deleted `scanWorkspaceForRoots` implementation but kept the export? 
            // No, I overwrote it.
            // Let's just use getDirectoryChildren("") and fetch root signals manually.
            
            // Re-read root dir for signals
            // (Simulated logic since I can't import fs easily if not at top)
            // Actually I should have kept scanWorkspaceForRoots.
            // I will return a "root" object.
            
             // We need `fs` to read root signals. 
             // Let's assume the frontend asks for `path=.` or empty and we handle the "root node" construction on frontend?
             // Or we return a `tree` object wrapping the root.
             
             // Let's return the children list and let frontend handle the root node visualization?
             // But we need root signals.
             
             // I'll do:
             const rootChildren = await getDirectoryChildren(project.workspacePath, "");
             // Root signals - quick hack:
             // I don't have access to fs easily here without require.
             // I will use `require("fs")`
             const rootFiles = await require("fs").promises.readdir(project.workspacePath).catch(() => []);
             const SIGNAL_FILES = ["package.json", "vite.config.js", "next.config.js", "requirements.txt", "Pipfile", "index.html", "manage.py"]; 
             const rootSignals = rootFiles.filter(f => SIGNAL_FILES.some(s => f.includes(s))); // Simple check

             const tree = {
                 name: "(Project Root)",
                 path: ".",
                 type: "folder",
                 signals: rootSignals,
                 children: rootChildren,
                 expanded: true // Root is expanded by default
             };
             
             res.json({ tree });
        }
    } catch (err) {
        console.error("Tree scan error:", err.message);
        res.status(500).json({ error: "Failed to scan workspace" });
    }
});

// POST /api/projects/:id/roots
router.post("/:id/roots", authRequired, async (req, res) => {
    const { id } = req.params;
    const { frontendRoot, backendRoot } = req.body; // paths relative to workspace

    try {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        // TODO: Validate paths exist? For now, trust the UI/User.
        
        const updated = await prisma.project.update({
            where: { id },
            data: { frontendRoot, backendRoot }
        });

        res.json({ success: true, project: updated });
    } catch (err) {
        console.error("Save roots error:", err.message);
        res.status(500).json({ error: "Failed to save folder config" });
    }
});

// PATCH /api/projects/:id
router.patch("/:id", authRequired, async (req, res) => {
    const { id } = req.params;
    const { name, slug, rootDir, buildCommand, outputDir, packageManager } = req.body;

    try {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        const updated = await prisma.project.update({
            where: { id },
            data: { name, slug, rootDir, buildCommand, outputDir, packageManager }
        });

        res.json({ success: true, project: updated });
    } catch (err) {
        res.status(500).json({ error: "Failed to update project" });
    }
});

// DELETE /api/projects/:id
// Deletes project from database and cleans up all associated files
router.delete("/:id", authRequired, async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Verify ownership
        const project = await prisma.project.findUnique({
            where: { id },
            include: { deployments: true }
        });

        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        console.log(`[Delete] Starting deletion for project: ${project.name} (${project.id})`);

        // 2. Delete static site files (releases + symlink)
        if (project.slug) {
            const staticSitePath = path.join(
                process.env.STATIC_SITES_PATH || "/srv/static-sites",
                project.slug
            );

            if (fsSync.existsSync(staticSitePath)) {
                console.log(`[Delete] Removing static site directory: ${staticSitePath}`);
                await fs.rm(staticSitePath, { recursive: true, force: true });
                console.log(`[Delete] Static site directory removed successfully`);
            } else {
                console.log(`[Delete] Static site directory not found: ${staticSitePath}`);
            }
        }

        // 3. Delete workspace (cloned repo)
        if (project.workspacePath && fsSync.existsSync(project.workspacePath)) {
            console.log(`[Delete] Removing workspace: ${project.workspacePath}`);
            await fs.rm(project.workspacePath, { recursive: true, force: true });
            console.log(`[Delete] Workspace removed successfully`);
        } else {
            console.log(`[Delete] Workspace not found or not set`);
        }

        // 4. Delete from database (cascades to deployments and envVars)
        console.log(`[Delete] Removing project from database`);
        await prisma.project.delete({ where: { id } });
        console.log(`[Delete] Project deleted successfully from database`);

        res.json({
            success: true,
            message: "Project and all associated files deleted successfully"
        });

    } catch (err) {
        console.error("[Delete] Error:", err.message);
        res.status(500).json({ error: "Failed to delete project" });
    }
});

// GET /api/projects/:id/env-vars
router.get("/:id/env-vars", authRequired, async (req, res) => {
    try {
        const envVars = await prisma.envVar.findMany({ where: { projectId: req.params.id } });
        res.json(envVars);
    } catch (err) {
        res.status(500).json({ error: "Failed to get env vars" });
    }
});

// POST /api/projects/:id/env-vars
router.post("/:id/env-vars", authRequired, async (req, res) => {
    const { key, value } = req.body;
    try {
        const envVar = await prisma.envVar.upsert({
            where: { projectId_key: { projectId: req.params.id, key } },
            update: { value },
            create: { projectId: req.params.id, key, value }
        });
        res.json(envVar);
    } catch (err) {
        res.status(500).json({ error: "Failed to save env var" });
    }
});

// DELETE /api/projects/:id/env-vars/:key
router.delete("/:id/env-vars/:key", authRequired, async (req, res) => {
    try {
        await prisma.envVar.delete({
            where: { projectId_key: { projectId: req.params.id, key: req.params.key } }
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete env var" });
    }
});

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

    // Determine which folder to analyze
    // If backendRoot is set, prioritize it (server usually drives the app)
    // If frontendRoot is set and no backendRoot, use that (static/SPA deploy)
    let targetRelativePath = "";
    if (project.backendRoot) {
        targetRelativePath = project.backendRoot;
    } else if (project.frontendRoot) {
        targetRelativePath = project.frontendRoot;
    }

    // Perform Analysis
    const config = await analyzeWorkspace(project.workspacePath, targetRelativePath);

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
            port: parseInt(config.port, 10) || 3000
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
// Input: { repoFullName: "user/repo", repoId: 12345, branch: "main", name: "...", slug: "..." }
router.post("/import", authRequired, async (req, res) => {
  const { repoFullName, repoId, branch, name: customName, slug: customSlug, groupId } = req.body;

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
    // Use custom name/slug if provided, otherwise fall back to repo name
    const projectName = customName || repoInfo.name;
    const projectSlug = customSlug || projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50);

    const project = await prisma.project.upsert({
      where: {
        userId_name: {
          userId: req.user.id,
          name: projectName,
        },
      },
      update: {
        repoFullName,
        branch: targetBranch,
        framework: detectedType,
        slug: projectSlug,
        groupId: groupId || null
      },
      create: {
        userId: req.user.id,
        name: projectName,
        repoFullName,
        branch: targetBranch,
        framework: detectedType,
        slug: projectSlug,
        groupId: groupId || null
      },
    });

    res.json({ success: true, project });

  } catch (err) {
    console.error("Project import failed:", err.message);
    res.status(500).json({ error: "Failed to analyze and import project" });
  }
});

module.exports = router;
