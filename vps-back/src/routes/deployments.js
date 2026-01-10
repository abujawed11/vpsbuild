const express = require("express");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const util = require("util");
const execPromise = util.promisify(exec);

const router = express.Router();

// Mock/Local path for testing if not on server
const BASE_STATIC_PATH = process.env.STATIC_SITES_PATH || "/srv/static-sites";

router.post("/:projectId", authRequired, async (req, res) => {
    const { projectId } = req.params;
    
    try {
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { envVars: true }
        });

        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        if (!project.slug) {
            return res.status(400).json({ error: "Project slug is required for deployment" });
        }

        // 1. Create Deployment record
        const deployment = await prisma.deployment.create({
            data: {
                projectId: project.id,
                status: "QUEUED",
                logs: "Deployment queued..."
            }
        });

        // Trigger build process (async)
        runBuild(project, deployment.id).catch(console.error);

        res.json({ success: true, deploymentId: deployment.id });
    } catch (err) {
        res.status(500).json({ error: "Failed to start deployment" });
    }
});

router.get("/status/:id", authRequired, async (req, res) => {
    try {
        const deployment = await prisma.deployment.findUnique({
            where: { id: req.params.id }
        });
        if (!deployment) return res.status(404).json({ error: "Deployment not found" });
        res.json(deployment);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch status" });
    }
});

/**
 * Verify that a deployment is fully ready to serve traffic
 * @returns {boolean} true if deployment is ready, false otherwise
 */
function verifyDeploymentReadiness(releasePath, symlinkPath) {
    try {
        // 1. Check release directory exists
        if (!fs.existsSync(releasePath)) {
            console.error(`[Verify] Release directory does not exist: ${releasePath}`);
            return false;
        }

        // 2. Check index.html exists in release
        const indexPath = path.join(releasePath, "index.html");
        if (!fs.existsSync(indexPath)) {
            console.error(`[Verify] index.html not found in release: ${indexPath}`);
            return false;
        }

        // 3. Check symlink exists
        if (!fs.existsSync(symlinkPath)) {
            console.error(`[Verify] Current symlink does not exist: ${symlinkPath}`);
            return false;
        }

        // 4. Verify symlink points to correct release (platform-specific)
        if (process.platform === "win32") {
            // On Windows, check if it's a junction/symlink and points to the right place
            const stats = fs.lstatSync(symlinkPath);
            if (!stats.isSymbolicLink() && !stats.isDirectory()) {
                console.error(`[Verify] Current path is not a symlink or junction: ${symlinkPath}`);
                return false;
            }
            // Read the target (Windows readlink can be tricky, but fs.realpathSync works)
            const target = fs.realpathSync(symlinkPath);
            if (target !== releasePath) {
                console.error(`[Verify] Symlink points to wrong target. Expected: ${releasePath}, Got: ${target}`);
                return false;
            }
        } else {
            // On Linux, check symlink target
            const stats = fs.lstatSync(symlinkPath);
            if (!stats.isSymbolicLink()) {
                console.error(`[Verify] Current path is not a symlink: ${symlinkPath}`);
                return false;
            }
            const target = fs.readlinkSync(symlinkPath);
            // readlinkSync returns the symlink target (might be relative or absolute)
            const absoluteTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(symlinkPath), target);
            if (absoluteTarget !== releasePath) {
                console.error(`[Verify] Symlink points to wrong target. Expected: ${releasePath}, Got: ${absoluteTarget}`);
                return false;
            }
        }

        // 5. Verify index.html is readable through symlink
        const symlinkIndexPath = path.join(symlinkPath, "index.html");
        if (!fs.existsSync(symlinkIndexPath)) {
            console.error(`[Verify] index.html not accessible through symlink: ${symlinkIndexPath}`);
            return false;
        }

        console.log(`[Verify] All checks passed for deployment at ${releasePath}`);
        return true;
    } catch (error) {
        console.error(`[Verify] Error during verification: ${error.message}`);
        return false;
    }
}

async function runBuild(project, deploymentId) {
    const updateLogs = async (logLine) => {
        console.log(`[Deploy ${deploymentId}] ${logLine}`);
        const current = await prisma.deployment.findUnique({ where: { id: deploymentId } });
        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { logs: (current.logs || "") + "\n" + logLine }
        });
    };

    try {
        // ============================================
        // PHASE 1: BUILD
        // ============================================
        await prisma.deployment.update({ where: { id: deploymentId }, data: { status: "BUILDING" } });
        await updateLogs("=== BUILD PHASE ===");
        await updateLogs(`[INFO] Project: ${project.name}`);
        await updateLogs(`[INFO] Repository: ${project.repoFullName}`);
        await updateLogs(`[INFO] Branch: ${project.branch}`);
        await updateLogs(`[INFO] Slug: ${project.slug}`);

        const projectRoot = path.join(project.workspacePath, project.rootDir || "");
        await updateLogs(`[INFO] Workspace: ${projectRoot}`);

        // Build Pipeline
        if (project.packageManager && project.buildCommand) {
            await updateLogs(`Running install: ${project.packageManager}...`);
            const installCmd = project.packageManager === "pnpm" ? "pnpm i" : (project.packageManager === "yarn" ? "yarn install" : "npm ci");
            await execPromise(installCmd, { cwd: projectRoot });

            await updateLogs(`Running build: ${project.buildCommand}...`);
            // Inject env vars
            const env = { ...process.env };
            const projectEnvVars = await prisma.envVar.findMany({ where: { projectId: project.id } });
            projectEnvVars.forEach(ev => { env[ev.key] = ev.value; });

            await execPromise(project.buildCommand, { cwd: projectRoot, env });
            await updateLogs("Build completed successfully.");
        } else {
            await updateLogs("No build command specified, using workspace as-is.");
        }

        // Validate Output
        const outputFullPath = path.join(projectRoot, project.outputDir || ".");
        if (!fs.existsSync(outputFullPath)) {
            throw new Error(`Output directory not found: ${project.outputDir}`);
        }
        await updateLogs(`[INFO] Output directory: ${outputFullPath}`);

        // ============================================
        // PHASE 2: FINALIZING (Atomic Deployment)
        // ============================================
        await prisma.deployment.update({ where: { id: deploymentId }, data: { status: "FINALIZING" } });
        await updateLogs("=== FINALIZE PHASE ===");

        const sitePath = path.join(BASE_STATIC_PATH, project.slug);
        const releasesPath = path.join(sitePath, "releases");
        const currentReleasePath = path.join(releasesPath, deploymentId);

        await updateLogs(`[INFO] Release path: ${currentReleasePath}`);

        if (!fs.existsSync(releasesPath)) {
            fs.mkdirSync(releasesPath, { recursive: true });
            await updateLogs(`Created releases directory: ${releasesPath}`);
        }

        await updateLogs("Copying files to release folder...");
        // Use recursive copy
        if (process.platform === "win32") {
            await execPromise(`xcopy /E /I /Y "${outputFullPath}" "${currentReleasePath}"`);
        } else {
            await execPromise(`cp -R "${outputFullPath}/." "${currentReleasePath}"`);
        }
        await updateLogs(`Files copied to: ${currentReleasePath}`);

        // Check index.html
        const indexHtmlPath = path.join(currentReleasePath, "index.html");
        if (!fs.existsSync(indexHtmlPath)) {
            await updateLogs("[WARN] index.html not found at root, checking for nested structure...");
            // Check for Angular subfolder case
            const files = fs.readdirSync(currentReleasePath);
            if (files.length === 1 && fs.lstatSync(path.join(currentReleasePath, files[0])).isDirectory()) {
                const subDir = path.join(currentReleasePath, files[0]);
                if (fs.existsSync(path.join(subDir, "index.html"))) {
                    await updateLogs(`[INFO] Auto-detected nested build output in: ${files[0]}`);
                    // Move files up
                    if (process.platform === "win32") {
                        await execPromise(`xcopy /E /I /Y "${subDir}\\*" "${currentReleasePath}" && rd /S /Q "${subDir}"`);
                    } else {
                        await execPromise(`mv ${subDir}/* ${currentReleasePath}/ && rm -rf ${subDir}`);
                    }
                    await updateLogs("Files moved to root level.");
                } else {
                    throw new Error("index.html not found in output directory or nested folder.");
                }
            } else {
                throw new Error("index.html not found in output directory.");
            }
        } else {
            await updateLogs(`[OK] index.html found at: ${indexHtmlPath}`);
        }

        // Atomic symlink creation
        await updateLogs("Creating symlink (atomic)...");
        const currentSymlink = path.join(sitePath, "current");

        if (process.platform === "win32") {
            // Windows: Use temp symlink + rename for atomicity
            const tempSymlink = path.join(sitePath, `current_tmp_${Date.now()}`);

            // Create temp symlink
            await execPromise(`mklink /D "${tempSymlink}" "${currentReleasePath}"`);

            // Atomic rename (delete old if exists, then rename)
            if (fs.existsSync(currentSymlink)) {
                await execPromise(`rmdir "${currentSymlink}"`);
            }
            // On Windows, we need to use move instead of atomic rename
            await execPromise(`move "${tempSymlink}" "${currentSymlink}"`);

            await updateLogs(`[OK] Symlink created: ${currentSymlink} -> ${currentReleasePath}`);
        } else {
            // Linux: Atomic symlink swap
            const tempSymlink = path.join(sitePath, `current_tmp_${Date.now()}`);
            await execPromise(`ln -sfn ${currentReleasePath} ${tempSymlink}`);
            await execPromise(`mv -Tf ${tempSymlink} ${currentSymlink}`);
            await updateLogs(`[OK] Symlink created (atomic): ${currentSymlink} -> ${currentReleasePath}`);
        }

        // ============================================
        // PHASE 3: VERIFICATION
        // ============================================
        await updateLogs("=== VERIFICATION PHASE ===");
        await updateLogs("Verifying deployment readiness...");

        const isReady = verifyDeploymentReadiness(currentReleasePath, currentSymlink);

        if (!isReady) {
            throw new Error("Deployment verification failed. Site is not ready to serve traffic.");
        }

        await updateLogs("[OK] Release directory exists");
        await updateLogs("[OK] index.html exists in release");
        await updateLogs("[OK] Symlink exists and points correctly");
        await updateLogs("[OK] Site is accessible through symlink");

        // ============================================
        // PHASE 4: MARK AS DEPLOYED
        // ============================================
        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { status: "DEPLOYED", finishedAt: new Date() }
        });
        await updateLogs("=== DEPLOYMENT COMPLETE ===");
        await updateLogs(`✓ Your site is now live at: http://${project.slug}.${process.env.BASE_DOMAIN || 'localhost'}`);
        await updateLogs(`✓ Deployment ID: ${deploymentId}`);

    } catch (err) {
        await updateLogs(`[ERROR] ${err.message}`);
        await updateLogs("Deployment failed. Please check logs above for details.");
        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { status: "FAILED", finishedAt: new Date() }
        });
    }
}

module.exports = router;
