const express = require("express");
const axios = require("axios");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const multer = require("multer");
const extract = require("extract-zip");
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

// POST /api/projects
// Creates a project record (used by ZIP-upload flow before uploading the file)
router.post("/", authRequired, async (req, res) => {
    const { name, slug: customSlug, groupId, repoFullName, branch, role } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (!repoFullName) return res.status(400).json({ error: "repoFullName is required" });

    // Validate role if provided
    if (role && !['FRONTEND', 'BACKEND'].includes(role)) {
        return res.status(400).json({ error: "Invalid role. Must be FRONTEND or BACKEND" });
    }

    let slug;
    let group = null;

    try {
        if (groupId) {
            group = await prisma.projectGroup.findUnique({
                where: { id: groupId },
                include: { projects: true }
            });
            if (!group || group.userId !== req.user.id) {
                return res.status(400).json({ error: "Invalid groupId" });
            }

            // If role is specified, check if one already exists for this group
            if (role) {
                const existingWithRole = group.projects.find(p => p.role === role);
                if (existingWithRole) {
                    return res.status(400).json({
                        error: `A ${role.toLowerCase()} already exists for this project`,
                        message: `Delete the existing ${role.toLowerCase()} first before adding a new one.`
                    });
                }
            }

            // Use group slug + role for container naming: myapp-frontend or myapp-backend
            slug = role ? `${group.slug}-${role.toLowerCase()}` : (customSlug || name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50));
        } else {
            // Legacy: standalone project without group
            slug = customSlug || name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50);
        }

        const project = await prisma.project.create({
            data: {
                userId: req.user.id,
                name,
                slug,
                groupId: groupId || null,
                role: role || null,
                repoFullName,
                branch: branch || "main"
            }
        });

        res.json({
            success: true,
            project,
            // Include group info if available
            groupSlug: group?.slug || null,
            containerName: slug
        });
    } catch (err) {
        if (err?.code === "P2002") {
            // Check which unique constraint was violated
            if (err.meta?.target?.includes('groupId') && err.meta?.target?.includes('role')) {
                return res.status(400).json({
                    error: `A ${role?.toLowerCase() || 'component'} already exists for this project`
                });
            }
            return res.status(400).json({ error: "Project name or slug already exists" });
        }
        console.error("Project create failed:", err.message);
        res.status(500).json({ error: "Failed to create project" });
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
    const { name, slug, rootDir, buildCommand, outputDir, packageManager, startCommand, staticFolder } = req.body;

    try {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Auto-detect port from start command if provided
        let detectedPort = project.port; // Keep existing port by default
        if (startCommand) {
            const { detectPort } = require("../lib/port-detector");
            detectedPort = detectPort({
                startCommand,
                runtime: project.runtime,
                framework: project.framework
            });
        }

        const updated = await prisma.project.update({
            where: { id },
            data: {
                name,
                slug,
                rootDir,
                buildCommand,
                outputDir,
                packageManager,
                startCommand,
                staticFolder,
                port: detectedPort
            }
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

        // Clear stale database linkage (legacy linkedProjectId)
        await prisma.database.updateMany({
            where: { linkedProjectId: project.id },
            data: { linkedProjectId: null }
        }).catch(() => {});

        // 2. Delete static site files (releases + symlink)
        if (project.slug) {
            let staticSiteSlug = project.slug;
            if (project.groupId && project.role === "FRONTEND") {
                const group = await prisma.projectGroup.findUnique({ where: { id: project.groupId } });
                if (group?.slug) staticSiteSlug = group.slug;
            }

            const staticSitePath = path.join(
                process.env.STATIC_SITES_PATH || "/srv/static-sites",
                staticSiteSlug
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

        // 4. Stop and remove Docker container (for server deployments)
        if (project.slug && project.deployType === "BACKEND") {
            try {
                console.log(`[Delete] Stopping Docker container: ${project.slug}`);
                await execPromise(`docker stop ${project.slug}`).catch(() => {
                    console.log(`[Delete] Container ${project.slug} not running or doesn't exist`);
                });

                console.log(`[Delete] Removing Docker container: ${project.slug}`);
                await execPromise(`docker rm ${project.slug}`).catch(() => {
                    console.log(`[Delete] Container ${project.slug} already removed`);
                });

                console.log(`[Delete] Removing Docker image: ${project.slug}:latest`);
                await execPromise(`docker rmi ${project.slug}:latest`).catch(() => {
                    console.log(`[Delete] Image ${project.slug}:latest not found or already removed`);
                });

                console.log(`[Delete] Docker resources cleaned successfully`);
            } catch (err) {
                console.error(`[Delete] Docker cleanup error (non-fatal): ${err.message}`);
            }
        }

        // 5. Remove nginx configuration
        if (project.slug) {
            try {
                const { removeNginxConfig } = require("../lib/nginx-config-generator");
                console.log(`[Delete] Removing nginx config for: ${project.slug}`);
                let nginxSlug = project.slug;
                if (project.groupId && project.role === "FRONTEND") {
                    const group = await prisma.projectGroup.findUnique({ where: { id: project.groupId } });
                    if (group?.slug) nginxSlug = group.slug;
                }
                await removeNginxConfig(nginxSlug);
                console.log(`[Delete] Nginx config removed successfully`);
            } catch (err) {
                console.error(`[Delete] Nginx config cleanup error (non-fatal): ${err.message}`);
            }
        }

        // 6. Delete from database (cascades to deployments and envVars)
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

// POST /api/projects/:id/env-vars/bulk - Bulk save env vars (for wizard)
router.post("/:id/env-vars/bulk", authRequired, async (req, res) => {
    const { envVars } = req.body; // Array of { key, value }
    const projectId = req.params.id;

    try {
        // Verify project ownership
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Delete all existing env vars for this project
        await prisma.envVar.deleteMany({ where: { projectId } });

        // Create new env vars
        if (envVars && envVars.length > 0) {
            await prisma.envVar.createMany({
                data: envVars.map(ev => ({
                    projectId,
                    key: ev.key,
                    value: ev.value
                }))
            });
        }

        res.json({ success: true, count: envVars?.length || 0 });
    } catch (err) {
        console.error("Bulk env var save failed:", err);
        res.status(500).json({ error: "Failed to save env vars" });
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

// POST /api/projects/:id/env-vars/hot-reload
// Update env vars and restart container (hot reload)
router.post("/:id/env-vars/hot-reload", authRequired, async (req, res) => {
    const { envVars } = req.body; // Array of { key, value }
    const projectId = req.params.id;

    try {
        // Verify project ownership
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Check if project is deployed with a container
        const isServerDeployment = project.deployType === "BACKEND" || project.deployType === "FULLSTACK";

        if (!isServerDeployment) {
            // For static sites, just update env vars (they're used during build time only)
            await prisma.envVar.deleteMany({ where: { projectId } });
            if (envVars && envVars.length > 0) {
                await prisma.envVar.createMany({
                    data: envVars.map(ev => ({ projectId, key: ev.key, value: ev.value }))
                });
            }
            return res.json({ success: true, message: "Environment variables updated. Redeploy to apply changes." });
        }

        // For server deployments, update env vars and restart container
        await prisma.envVar.deleteMany({ where: { projectId } });
        if (envVars && envVars.length > 0) {
            await prisma.envVar.createMany({
                data: envVars.map(ev => ({ projectId, key: ev.key, value: ev.value }))
            });
        }

        // Check if container exists
        const { execSync } = require("child_process");
        try {
            execSync(`docker inspect ${project.slug}`, { stdio: 'ignore' });
        } catch {
            // Container doesn't exist, just update env vars
            return res.json({ success: true, message: "Environment variables updated. Deploy to create container." });
        }

        // Get updated env vars from database
        const updatedEnvVars = await prisma.envVar.findMany({ where: { projectId } });

        // Build env flags for docker run
        const envFlags = updatedEnvVars.map(ev => `-e ${ev.key}="${ev.value}"`).join(" ");

        // Get original container configuration
        const imageTag = project.slug;
        const effectivePort = project.port || 3000;
        const nodeEnv = `-e NODE_ENV=production`;
        const portEnv = `-e PORT=${effectivePort}`;

        // Stop and remove old container
        try {
            execSync(`docker stop ${project.slug}`, { stdio: 'ignore' });
        } catch {}
        try {
            execSync(`docker rm ${project.slug}`, { stdio: 'ignore' });
        } catch {}

        // Start new container with updated env vars (attach to gateway network immediately)
        const gatewayNetwork = process.env.GATEWAY_NETWORK || "vpsbuilds_default";
        const runCmd = `docker run -d --name ${project.slug} --network ${gatewayNetwork} --restart unless-stopped --memory="512m" --cpus="1.0" ${nodeEnv} ${portEnv} ${envFlags} ${imageTag}`;
        execSync(runCmd);

        res.json({ success: true, message: "Environment variables updated and container restarted successfully." });
    } catch (err) {
        console.error("Hot reload error:", err);
        res.status(500).json({ error: err.message || "Failed to hot reload environment variables" });
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
    const normalizeWorkspaceRelPath = (rel) => {
        if (rel === undefined || rel === null) return "";
        const raw = String(rel).trim();
        if (!raw || raw === "/" || raw === "." || raw === "./") return "";
        const stripped = raw.replace(/^[/\\]+/, "");
        const normalized = path.normalize(stripped);
        if (!normalized || normalized === "." || normalized === path.sep) return "";
        if (path.isAbsolute(normalized) || normalized.startsWith("..")) return "";
        return normalized;
    };

    // Prefer the user-selected rootDir (wizard flow), otherwise fall back to backendRoot/frontendRoot (fullstack flow)
    let targetRelativePath = normalizeWorkspaceRelPath(project.rootDir);
    if (!targetRelativePath) {
        if (project.backendRoot) targetRelativePath = normalizeWorkspaceRelPath(project.backendRoot);
        else if (project.frontendRoot) targetRelativePath = normalizeWorkspaceRelPath(project.frontendRoot);
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

// Configure multer for ZIP uploads
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        fsSync.mkdirSync(uploadsDir, { recursive: true });
        cb(null, uploadsDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const safeExt = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${safeExt}`);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === ".zip") {
      cb(null, true);
    } else {
      cb(new Error("Only ZIP files are allowed"));
    }
  }
});

const uploadZipSingle = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "ZIP file too large (max 100MB)" });
    }

    if (err.message?.includes("Only ZIP files are allowed")) {
      return res.status(400).json({ error: "Only ZIP files are allowed" });
    }

    return res.status(400).json({ error: err.message || "Upload failed" });
  });
};

// POST /api/projects/:id/upload-zip
router.post("/:id/upload-zip", authRequired, uploadZipSingle, async (req, res) => {
  const { id: projectId } = req.params;

  try {
    // Verify project ownership
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log(`[Upload] Processing ZIP for project: ${project.name}`);

    // Define workspace path
    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(__dirname, "../../workspaces");
    const targetDir = path.join(workspaceRoot, req.user.id, project.name);

    // Create target directory
    await fs.mkdir(targetDir, { recursive: true });

    // Extract ZIP file
    console.log(`[Upload] Extracting ZIP to: ${targetDir}`);
    await extract(req.file.path, { dir: path.resolve(targetDir) });

    // Remove uploaded ZIP file
    await fs.unlink(req.file.path);

    // Update project status
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        workspacePath: targetDir,
        cloneStatus: "CLONED"
      }
    });

    console.log(`[Upload] ZIP extracted successfully`);
    res.json({ success: true, project: updated });

  } catch (err) {
    console.error("[Upload] Error:", err.message);

    // Cleanup uploaded file
    if (req.file && fsSync.existsSync(req.file.path)) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    // Update project status
    await prisma.project.update({
      where: { id: projectId },
      data: { cloneStatus: "FAILED" }
    });

    res.status(500).json({ error: "Failed to upload and extract ZIP" });
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

// ===== FILE MANAGEMENT ENDPOINTS =====

// GET /api/projects/:id/files - List files and folders in workspace
router.get("/:id/files", authRequired, async (req, res) => {
  const { id } = req.params;
  const { path: relativePath = "" } = req.query;

  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!project.workspacePath || !fsSync.existsSync(project.workspacePath)) {
      return res.status(400).json({ error: "Workspace not found" });
    }

    // Security check: normalize path and prevent directory traversal
    const safeRelative = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const fullPath = path.join(project.workspacePath, safeRelative);

    if (!fullPath.startsWith(project.workspacePath)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    if (!fsSync.existsSync(fullPath)) {
      return res.status(404).json({ error: "Path not found" });
    }

    const stats = await fs.stat(fullPath);

    if (!stats.isDirectory()) {
      return res.status(400).json({ error: "Path is not a directory" });
    }

    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      const itemPath = path.join(fullPath, entry.name);
      const itemStats = await fs.stat(itemPath);

      items.push({
        name: entry.name,
        path: path.join(safeRelative, entry.name).replace(/\\/g, "/"),
        type: entry.isDirectory() ? "folder" : "file",
        size: entry.isFile() ? itemStats.size : null,
        modified: itemStats.mtime
      });
    }

    // Sort: folders first, then files, alphabetically
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      items,
      currentPath: safeRelative.replace(/\\/g, "/") || "/"
    });
  } catch (err) {
    console.error("Failed to list files:", err);
    res.status(500).json({ error: "Failed to list files" });
  }
});

// Configure multer for file uploads
const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // Destination will be set dynamically in the route
      cb(null, req.uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    }
  }),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit per file
  }
});

// POST /api/projects/:id/files/upload - Upload files to workspace
router.post("/:id/files/upload", authRequired, async (req, res) => {
  const { id } = req.params;

  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!project.workspacePath || !fsSync.existsSync(project.workspacePath)) {
      return res.status(400).json({ error: "Workspace not found" });
    }

    // Get target path from query or body
    const relativePath = req.query.path || req.body.path || "";
    const safeRelative = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const uploadDir = path.join(project.workspacePath, safeRelative);

    if (!uploadDir.startsWith(project.workspacePath)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    // Ensure directory exists
    await fs.mkdir(uploadDir, { recursive: true });
    req.uploadDir = uploadDir;

    // Use multer middleware
    fileUpload.array("files", 10)(req, res, async (err) => {
      if (err) {
        console.error("Upload error:", err);
        return res.status(400).json({ error: err.message });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const uploadedFiles = req.files.map(f => ({
        name: f.filename,
        size: f.size,
        path: path.join(safeRelative, f.filename).replace(/\\/g, "/")
      }));

      res.json({
        success: true,
        files: uploadedFiles,
        message: `Uploaded ${uploadedFiles.length} file(s)`
      });
    });
  } catch (err) {
    console.error("Failed to upload files:", err);
    res.status(500).json({ error: "Failed to upload files" });
  }
});

// POST /api/projects/:id/files/mkdir - Create new folder
router.post("/:id/files/mkdir", authRequired, async (req, res) => {
  const { id } = req.params;
  const { path: relativePath, name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Folder name is required" });
  }

  // Validate folder name
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    return res.status(400).json({ error: "Invalid folder name" });
  }

  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!project.workspacePath || !fsSync.existsSync(project.workspacePath)) {
      return res.status(400).json({ error: "Workspace not found" });
    }

    const safeRelative = path.normalize(relativePath || "").replace(/^(\.\.(\/|\\|$))+/, "");
    const parentDir = path.join(project.workspacePath, safeRelative);
    const newFolderPath = path.join(parentDir, name);

    if (!newFolderPath.startsWith(project.workspacePath)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    if (fsSync.existsSync(newFolderPath)) {
      return res.status(400).json({ error: "Folder already exists" });
    }

    await fs.mkdir(newFolderPath, { recursive: true });

    res.json({
      success: true,
      folder: {
        name,
        path: path.join(safeRelative, name).replace(/\\/g, "/"),
        type: "folder"
      }
    });
  } catch (err) {
    console.error("Failed to create folder:", err);
    res.status(500).json({ error: "Failed to create folder" });
  }
});

// DELETE /api/projects/:id/files - Delete file or folder
router.delete("/:id/files", authRequired, async (req, res) => {
  const { id } = req.params;
  const { path: relativePath } = req.query;

  if (!relativePath) {
    return res.status(400).json({ error: "Path is required" });
  }

  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!project.workspacePath || !fsSync.existsSync(project.workspacePath)) {
      return res.status(400).json({ error: "Workspace not found" });
    }

    const safeRelative = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const targetPath = path.join(project.workspacePath, safeRelative);

    if (!targetPath.startsWith(project.workspacePath)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    // Prevent deleting entire workspace
    if (targetPath === project.workspacePath) {
      return res.status(400).json({ error: "Cannot delete workspace root" });
    }

    if (!fsSync.existsSync(targetPath)) {
      return res.status(404).json({ error: "File or folder not found" });
    }

    const stats = await fs.stat(targetPath);
    const itemType = stats.isDirectory() ? "folder" : "file";

    await fs.rm(targetPath, { recursive: true, force: true });

    res.json({
      success: true,
      message: `${itemType} deleted successfully`,
      path: safeRelative.replace(/\\/g, "/")
    });
  } catch (err) {
    console.error("Failed to delete:", err);
    res.status(500).json({ error: "Failed to delete file or folder" });
  }
});

// POST /api/projects/:id/exec - Execute a command inside the project's container
// Uses Server-Sent Events (SSE) to stream output in real-time
router.post("/:id/exec", authRequired, async (req, res) => {
    const { id } = req.params;
    const { command } = req.body;

    if (!command || typeof command !== "string" || !command.trim()) {
        return res.status(400).json({ error: "Command is required" });
    }

    try {
        const project = await prisma.project.findUnique({ where: { id } });
        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Only backend/fullstack deployments have containers
        if (project.deployType !== "BACKEND" && project.deployType !== "FULLSTACK") {
            return res.status(400).json({ error: "This project does not have a running container (frontend-only deployment)" });
        }

        const containerName = project.slug;

        // Check if container exists and is running
        try {
            const { execSync } = require("child_process");
            const containerStatus = execSync(`docker inspect -f '{{.State.Running}}' ${containerName}`, { encoding: "utf8" }).trim();
            if (containerStatus !== "true") {
                return res.status(400).json({ error: "Container is not running. Deploy the project first." });
            }
        } catch {
            return res.status(400).json({ error: "Container not found. Deploy the project first." });
        }

        // Set up SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
        res.flushHeaders();

        // Send initial message
        res.write(`data: ${JSON.stringify({ type: "start", message: `Executing: ${command}` })}\n\n`);

        const { spawn } = require("child_process");

        // Execute command inside the container
        const dockerExec = spawn("docker", ["exec", containerName, "sh", "-c", command], {
            stdio: ["ignore", "pipe", "pipe"]
        });

        dockerExec.stdout.on("data", (data) => {
            const lines = data.toString().split("\n");
            for (const line of lines) {
                if (line) {
                    res.write(`data: ${JSON.stringify({ type: "stdout", message: line })}\n\n`);
                }
            }
        });

        dockerExec.stderr.on("data", (data) => {
            const lines = data.toString().split("\n");
            for (const line of lines) {
                if (line) {
                    res.write(`data: ${JSON.stringify({ type: "stderr", message: line })}\n\n`);
                }
            }
        });

        dockerExec.on("close", (code) => {
            res.write(`data: ${JSON.stringify({ type: "exit", code, message: `Process exited with code ${code}` })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
            res.end();
        });

        dockerExec.on("error", (err) => {
            res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
            res.end();
        });

        // Handle client disconnect
        req.on("close", () => {
            dockerExec.kill();
        });

    } catch (err) {
        console.error("Exec error:", err);
        // If headers not sent yet, send JSON error
        if (!res.headersSent) {
            res.status(500).json({ error: err.message || "Failed to execute command" });
        } else {
            res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
            res.end();
        }
    }
});

module.exports = router;
