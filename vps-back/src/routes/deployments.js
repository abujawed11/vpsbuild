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
        await prisma.deployment.update({ where: { id: deploymentId }, data: { status: "BUILDING" } });
        
        const projectRoot = path.join(project.workspacePath, project.rootDir || "");
        
        // 2. Build Pipeline
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
        }

        // 3. Validate Output
        const outputFullPath = path.join(projectRoot, project.outputDir || ".");
        if (!fs.existsSync(outputFullPath)) {
            throw new Error(`Output directory not found: ${project.outputDir}`);
        }

        // 4. Publish (Atomic Symlink Swap)
        const sitePath = path.join(BASE_STATIC_PATH, project.slug);
        const releasesPath = path.join(sitePath, "releases");
        const currentReleasePath = path.join(releasesPath, deploymentId);
        
        await updateLogs(`[INFO] Project Slug: ${project.slug}`);
        await updateLogs(`[INFO] Repo: ${project.repoFullName}`);
        await updateLogs(`[INFO] Publish Directory: ${currentReleasePath}`);
        
        if (!fs.existsSync(releasesPath)) fs.mkdirSync(releasesPath, { recursive: true });

        await updateLogs("Copying files to release folder...");
        // Use recursive copy
        if (process.platform === "win32") {
            await execPromise(`xcopy /E /I /Y "${outputFullPath}" "${currentReleasePath}"`);
        } else {
            await execPromise(`cp -R "${outputFullPath}/." "${currentReleasePath}"`);
        }

        // Check index.html
        if (!fs.existsSync(path.join(currentReleasePath, "index.html"))) {
            // Check for Angular subfolder case
            const files = fs.readdirSync(currentReleasePath);
            if (files.length === 1 && fs.lstatSync(path.join(currentReleasePath, files[0])).isDirectory()) {
                const subDir = path.join(currentReleasePath, files[0]);
                if (fs.existsSync(path.join(subDir, "index.html"))) {
                    await updateLogs(`Auto-detected Angular subfolder: ${files[0]}`);
                    // Move files up
                    await execPromise(process.platform === "win32" ? `xcopy /E /I /Y "${subDir}" "${currentReleasePath}" && rd /S /Q "${subDir}"` : `mv ${subDir}/* ${currentReleasePath}/ && rm -rf ${subDir}`);
                }
            } else {
                throw new Error("index.html not found in output directory.");
            }
        }

        await updateLogs("Updating symlink...");
        const currentSymlink = path.join(sitePath, "current");
        
        if (process.platform === "win32") {
            // Windows symlinks are tricky, sometimes it's better to just use a junction or copy for local dev
            if (fs.existsSync(currentSymlink)) {
                await execPromise(`rmdir "${currentSymlink}"`);
            }
            await execPromise(`mklink /D "${currentSymlink}" "${currentReleasePath}"`);
        } else {
            const tempSymlink = path.join(sitePath, "current_tmp");
            await execPromise(`ln -sfn ${currentReleasePath} ${tempSymlink}`);
            await execPromise(`mv -Tf ${tempSymlink} ${currentSymlink}`);
        }

        await updateLogs(`[INFO] Symlink Target: ${currentSymlink} -> ${currentReleasePath}`);

        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { status: "LIVE", finishedAt: new Date() }
        });
        await updateLogs("Deployment successful! Site is LIVE.");

    } catch (err) {
        await updateLogs(`Error: ${err.message}`);
        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { status: "FAILED", finishedAt: new Date() }
        });
    }
}

module.exports = router;
