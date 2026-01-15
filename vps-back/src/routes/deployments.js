const express = require("express");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const util = require("util");
const execPromise = util.promisify(exec);
const { cloneRepo } = require("../lib/git");
const { generateDockerCompose, writeDockerCompose } = require("../lib/docker-compose-generator");
const { generateNodeBackendDockerfile, generatePythonBackendDockerfile, writeDockerfile, detectPrisma } = require("../lib/docker-generator");
const { writeNginxConfig, reloadNginx, healthCheckFromNginx } = require("../lib/nginx-config-generator");
const { detectCaseSensitivityIssue, formatCaseSensitivityError } = require("../lib/case-sensitivity-checker");
const { detectPythonFramework, buildPythonStartCommand, validatePythonStartCommand } = require("../lib/python-framework-detector");
const { validatePythonProject } = require("../lib/python-validator");
const { streamCommand } = require("../lib/stream-command");

const router = express.Router();

// Mock/Local path for testing if not on server
const BASE_STATIC_PATH = process.env.STATIC_SITES_PATH || "/srv/static-sites";

function normalizeWorkspaceRelPath(rel) {
    if (rel === undefined || rel === null) return "";
    const raw = String(rel).trim();
    if (!raw || raw === "/" || raw === "." || raw === "./") return "";
    const stripped = raw.replace(/^[/\\]+/, "");
    const normalized = path.normalize(stripped);
    if (!normalized || normalized === "." || normalized === path.sep) return "";
    if (path.isAbsolute(normalized) || normalized.startsWith("..")) return "";
    return normalized;
}

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

        // Trigger build process (async) - route based on deploy type
        if (project.deployType === "BACKEND") {
            runServerDeploy(project, deployment.id).catch(console.error);
        } else {
            runBuild(project, deployment.id).catch(console.error);
        }

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

// POST /api/deployments/:projectId/redeploy - Redeploy project (pull latest code and deploy)
router.post("/:projectId/redeploy", authRequired, async (req, res) => {
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

        // If project is from GitHub, pull latest code
        if (project.repoFullName && project.branch) {
            console.log(`[Redeploy] Pulling latest code for ${project.name}...`);

            try {
                // Get GitHub access token
                const githubAccount = await prisma.githubAccount.findUnique({
                    where: { userId: req.user.id }
                });

                if (!githubAccount) {
                    return res.status(400).json({
                        error: "GitHub account not connected. Please reconnect your GitHub account."
                    });
                }

                // Re-clone the repository (cloneRepo removes existing dir and clones fresh)
                if (project.workspacePath) {
                    await cloneRepo(
                        project.repoFullName,
                        project.branch,
                        githubAccount.accessToken,
                        project.workspacePath
                    );

                    console.log(`[Redeploy] Successfully pulled latest code from ${project.repoFullName}`);
                } else {
                    return res.status(400).json({
                        error: "Workspace path not found. Please redeploy from the beginning."
                    });
                }
            } catch (gitErr) {
                console.error("[Redeploy] Failed to pull latest code:", gitErr);
                return res.status(500).json({
                    error: "Failed to pull latest code from GitHub. " + gitErr.message
                });
            }
        } else {
            console.log(`[Redeploy] Project is not from GitHub, using existing workspace files`);
        }

        // Create Deployment record
        const deployment = await prisma.deployment.create({
            data: {
                projectId: project.id,
                status: "QUEUED",
                logs: "Redeployment queued..."
            }
        });

        // Trigger build process (async) - route based on deploy type
        if (project.deployType === "BACKEND") {
            runServerDeploy(project, deployment.id).catch(console.error);
        } else {
            runBuild(project, deployment.id).catch(console.error);
        }

        res.json({
            success: true,
            deploymentId: deployment.id,
            message: project.repoFullName
                ? "Pulled latest code and started redeployment"
                : "Started redeployment with existing files"
        });
    } catch (err) {
        console.error("[Redeploy] Error:", err);
        res.status(500).json({ error: "Failed to start redeployment" });
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

async function runServerDeploy(project, deploymentId) {
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
        // PHASE 1: PREPARE DOCKERFILE
        // ============================================
        await prisma.deployment.update({ where: { id: deploymentId }, data: { status: "BUILDING" } });
        await updateLogs("=== SERVER DEPLOYMENT ===");
        await updateLogs(`[INFO] Project: ${project.name}`);
        await updateLogs(`[INFO] Repository: ${project.repoFullName}`);
        await updateLogs(`[INFO] Branch: ${project.branch}`);
        await updateLogs(`[INFO] Slug: ${project.slug}`);

        const projectRoot = path.join(project.workspacePath, normalizeWorkspaceRelPath(project.rootDir));
        await updateLogs(`[INFO] Workspace: ${projectRoot}`);

        // Check if Dockerfile exists, if not, generate one
        const dockerfilePath = path.join(projectRoot, "Dockerfile");
        if (!fs.existsSync(dockerfilePath)) {
            await updateLogs("Generating Dockerfile...");

            // Detect runtime and generate appropriate Dockerfile
            const runtime = project.runtime || "node";
            let startCommand = project.startCommand || "npm start";

            // Check for dev tools in start command (e.g., nodemon)
            // This helps users who accidentally set "npm run dev" as start command
            const pkgJsonPath = path.join(projectRoot, "package.json");
            let actualCommand = startCommand;

            // If start command is "npm run <script>", resolve it
            if (fs.existsSync(pkgJsonPath)) {
                const npmRunMatch = startCommand.match(/(?:npm|yarn|pnpm)\s+(?:run\s+)?(\w+)/);
                if (npmRunMatch) {
                    const scriptName = npmRunMatch[1];
                    try {
                        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                        if (pkgJson.scripts && pkgJson.scripts[scriptName]) {
                            actualCommand = pkgJson.scripts[scriptName];
                            await updateLogs(`[INFO] Resolved '${scriptName}' script: ${actualCommand}`);
                        }
                    } catch (e) {
                        await updateLogs(`[WARN] Could not read package.json: ${e.message}`);
                    }
                }
            }

            // Check if actual command uses dev tools
            if (actualCommand.includes("nodemon") || actualCommand.includes("ts-node-dev")) {
                await updateLogs("[WARN] Start command uses development tools (nodemon/ts-node-dev)");
                await updateLogs("[INFO] Auto-fixing: Replacing with production-safe alternative");

                // Replace nodemon with node, ts-node-dev with ts-node
                const fixedCommand = actualCommand.replace(/nodemon/gi, 'node').replace(/ts-node-dev/gi, 'ts-node');
                await updateLogs(`[INFO] Original: ${actualCommand}`);
                await updateLogs(`[INFO] Fixed: ${fixedCommand}`);
                startCommand = fixedCommand;
            }

            // Detect Prisma in the project
            const hasPrisma = detectPrisma(projectRoot);
            if (hasPrisma) {
                await updateLogs("[INFO] Prisma detected - will generate Prisma Client during build");
            }

            const config = {
                packageManager: project.packageManager || "npm",
                startCommand: startCommand,
                port: project.port || 3000,
                hasPrisma: hasPrisma
            };

            let dockerfileContent;
            if (runtime === "python") {
                // Pre-flight validation: Check project structure
                await updateLogs("=== VALIDATING PYTHON PROJECT ===");
                const projectValidation = validatePythonProject(projectRoot, config.startCommand);

                if (!projectValidation.valid) {
                    await updateLogs("[ERROR] Project validation failed:");
                    for (const issue of projectValidation.issues) {
                        await updateLogs(`  ✗ ${issue}`);
                    }
                    throw new Error(
                        "Python project validation failed. Please fix the issues above before deploying."
                    );
                }

                if (projectValidation.warnings.length > 0) {
                    for (const warning of projectValidation.warnings) {
                        await updateLogs(`[WARN] ${warning}`);
                    }
                }

                await updateLogs("[OK] Project structure validated");

                // Auto-detect framework and build proper start command
                const framework = detectPythonFramework(projectRoot, config.startCommand);
                await updateLogs(`[INFO] Detected framework: ${framework.framework} (${framework.server})`);

                // Build production-ready command with host and port binding
                const optimizedStartCommand = buildPythonStartCommand(config.startCommand, config.port);

                if (optimizedStartCommand !== config.startCommand) {
                    await updateLogs(`[INFO] Optimized start command: ${optimizedStartCommand}`);
                }

                // Validate the command
                const validation = validatePythonStartCommand(config.startCommand, framework.framework);
                if (!validation.valid) {
                    for (const issue of validation.issues) {
                        await updateLogs(`[WARN] ${issue}`);
                    }
                }
                if (validation.suggestions.length > 0) {
                    for (const suggestion of validation.suggestions) {
                        await updateLogs(`[TIP] ${suggestion}`);
                    }
                }

                dockerfileContent = generatePythonBackendDockerfile({
                    ...config,
                    startCommand: optimizedStartCommand
                });
            } else {
                dockerfileContent = generateNodeBackendDockerfile(config);
            }

            await writeDockerfile(dockerfileContent, projectRoot);
            await updateLogs("Dockerfile generated successfully");
        } else {
            await updateLogs("Using existing Dockerfile");
        }

        // ============================================
        // PHASE 2: BUILD IMAGE
        // ============================================
        await updateLogs("=== BUILDING IMAGE ===");
        const imageTag = `${project.slug}:latest`;

        try {
            // Stream docker build output to logs in real-time
            await streamCommand(
                `docker build -t ${imageTag} "${projectRoot}"`,
                { cwd: projectRoot },
                async (line) => {
                    // Filter out some verbose Docker messages but keep important ones
                    const trimmed = line.trim();
                    if (trimmed &&
                        !trimmed.startsWith('#') &&
                        !trimmed.startsWith('SECURITY WARNING:')) {
                        await updateLogs(trimmed);
                    }
                }
            );
            await updateLogs("[OK] Image built successfully");
        } catch (err) {
            await updateLogs("[ERROR] Docker build failed");
            if (err.stdout) await updateLogs(err.stdout);
            if (err.stderr) await updateLogs(err.stderr);
            throw new Error(`Docker build failed: ${err.message}`);
        }

        // Stop old container
        await updateLogs("Stopping old container...");
        await execPromise(`docker stop ${project.slug}`).catch(() => {});
        await execPromise(`docker rm ${project.slug}`).catch(() => {});

        // Get environment variables
        const envVars = await prisma.envVar.findMany({ where: { projectId: project.id } });

        // Log environment variables
        await updateLogs("=== ENVIRONMENT VARIABLES ===");
        if (envVars.length > 0) {
            await updateLogs(`[INFO] Injecting ${envVars.length} environment variable(s):`);
            for (const ev of envVars) {
                // Mask sensitive values (show only first 4 chars)
                const maskedValue = ev.value.length > 4 ? `${ev.value.substring(0, 4)}***` : '***';
                await updateLogs(`  ${ev.key}=${maskedValue}`);
            }
        } else {
            await updateLogs("[INFO] No environment variables defined");
        }

        // Check if user has defined PORT in env vars (env vars take priority)
        const userDefinedPort = envVars.find(ev => ev.key === 'PORT');
        const effectivePort = userDefinedPort ? parseInt(userDefinedPort.value) : (project.port || 3000);

        // Build env flags - if user defined PORT, it's already in envVars
        const envFlags = envVars.map(ev => `-e ${ev.key}="${ev.value}"`).join(' ');

        // Only inject PORT if user hasn't defined it
        const portEnv = userDefinedPort ? '' : `-e PORT=${project.port || 3000}`;
        const nodeEnv = `-e NODE_ENV=production`;

        if (userDefinedPort) {
            await updateLogs(`[INFO] Using PORT from environment variables: ${effectivePort}`);
        } else {
            await updateLogs(`[INFO] Using PORT from build settings: ${effectivePort}`);
        }

        // Run container WITHOUT port publishing
        // Add host.docker.internal to allow containers to access host services (like MySQL on host)
        await updateLogs("=== STARTING CONTAINER ===");
        const runNetwork = process.env.GATEWAY_NETWORK || "vpsbuilds_default";
        const runCmd = `docker run -d --name ${project.slug} --network ${runNetwork} --restart unless-stopped --add-host=host.docker.internal:host-gateway --memory="512m" --cpus="1.0" ${nodeEnv} ${portEnv} ${envFlags} ${imageTag}`;

        try {
            await execPromise(runCmd, { timeout: 30000 });
            await updateLogs(`Container ${project.slug} started`);
        } catch (err) {
            throw new Error(`Container start failed: ${err.message}`);
        }

        // Verify container is actually running (not crashed immediately)
        await updateLogs("Verifying container status...");
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s for startup

        try {
            const { stdout: containerStatus } = await execPromise(`docker inspect --format='{{.State.Status}}' ${project.slug}`);
            const status = containerStatus.trim();

            if (status !== 'running') {
                // Container crashed! Stop restart attempts first
                await updateLogs(`[ERROR] Container status: ${status}`);

                if (status === 'restarting') {
                    await updateLogs("Stopping restart loop to inspect logs...");
                    await execPromise(`docker update --restart=no ${project.slug}`).catch(() => {});
                    await execPromise(`docker stop ${project.slug}`).catch(() => {});
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // Get detailed container info
                try {
                    const { stdout: exitInfo } = await execPromise(
                        `docker inspect --format='ExitCode: {{.State.ExitCode}} | Error: {{.State.Error}}' ${project.slug}`
                    );
                    await updateLogs(`[INFO] ${exitInfo.trim()}`);
                } catch (infoErr) {
                    // Ignore
                }

                // Get both stdout and stderr logs
                try {
                    const { stdout: logs, stderr: errLogs } = await execPromise(`docker logs ${project.slug} 2>&1`);
                    const allLogs = (logs + errLogs).trim();

                    await updateLogs("=== CONTAINER LOGS ===");
                    if (allLogs) {
                        await updateLogs(allLogs);
                    } else {
                        await updateLogs("[WARN] No logs captured. Container may be exiting before startup.");

                        // Try to inspect the Dockerfile CMD
                        await updateLogs("\n=== TROUBLESHOOTING ===");
                        await updateLogs("Checking generated Dockerfile...");

                        const dockerfilePath = path.join(projectRoot, "Dockerfile");
                        if (fs.existsSync(dockerfilePath)) {
                            const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
                            const cmdLine = dockerfileContent.split('\n').find(line => line.startsWith('CMD'));
                            await updateLogs(`Dockerfile CMD: ${cmdLine || 'not found'}`);
                        }

                        await updateLogs("\nCommon causes:");
                        await updateLogs("1. requirements.txt missing dependencies");
                        await updateLogs("2. Start command syntax error");
                        await updateLogs("3. App module not found (check entry point)");
                        await updateLogs("4. Port already in use inside container");
                    }
                } catch (logErr) {
                    await updateLogs("[ERROR] Could not retrieve container logs: " + logErr.message);
                }

                throw new Error(
                    `Container crashed immediately after starting (status: ${status}). ` +
                    `Check the container logs and troubleshooting info above.`
                );
            }

            await updateLogs(`[OK] Container is running`);
        } catch (err) {
            if (err.message.includes('Container crashed')) {
                throw err; // Re-throw our detailed error
            }
            throw new Error(`Failed to verify container status: ${err.message}`);
        }

        // Connect to gateway network
        await updateLogs("=== CONNECTING TO GATEWAY NETWORK ===");
        const gatewayNetwork = process.env.GATEWAY_NETWORK || 'vpsbuilds_default';

        try {
            await execPromise(`docker network connect ${gatewayNetwork} ${project.slug}`, { timeout: 10000 });
            await updateLogs(`Connected to ${gatewayNetwork}`);
        } catch (err) {
            // Check if already connected
            if (err.message.includes('already exists')) {
                await updateLogs(`Already connected to ${gatewayNetwork}`);
            } else {
                throw new Error(`Network connect failed: ${err.message}`);
            }
        }

        // Wait for container to be ready
        await updateLogs("Waiting for container to be ready...");
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Health check from nginx
        await updateLogs("=== HEALTH CHECK ===");
        const healthResult = await healthCheckFromNginx(project.slug, effectivePort);

        if (!healthResult.reachable) {
            throw new Error(`Health check failed: ${healthResult.error}`);
        }

        await updateLogs(`[OK] Container reachable (HTTP ${healthResult.statusCode})`);

        // Generate nginx config with effective port (from env vars or build settings)
        await updateLogs("=== CONFIGURING GATEWAY ===");
        const projectWithEffectivePort = { ...project, port: effectivePort };
        const configPath = await writeNginxConfig(projectWithEffectivePort);
        await updateLogs(`Config created: ${configPath}`);

        // Reload nginx with validation
        await updateLogs("Reloading nginx...");
        const reloadResult = await reloadNginx(project);

        if (reloadResult.success) {
            await updateLogs("[OK] Nginx reloaded");
        }

        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { status: "DEPLOYED", finishedAt: new Date() }
        });

        await updateLogs("=== DEPLOYMENT COMPLETE ===");

        // Construct subdomain URL
        const baseDomain = process.env.BASE_DOMAIN || 'localhost';
        const port = process.env.PUBLIC_BASE_URL?.includes(':8088') ? ':8088' : '';
        const publicUrl = `http://${project.slug}.${baseDomain}${port}`;

        await updateLogs(`✓ Server live at: ${publicUrl}`);
        await updateLogs(`✓ Container: ${project.slug}`);

    } catch (err) {
        await updateLogs(`[ERROR] ${err.message}`);
        await updateLogs("Deployment failed. Please check logs above for details.");
        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { status: "FAILED", finishedAt: new Date() }
        });
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

        const workspaceRoot = path.join(project.workspacePath, normalizeWorkspaceRelPath(project.rootDir));
        await updateLogs(`[INFO] Workspace: ${workspaceRoot}`);

        const detectSingleNestedAppRoot = (rootDir) => {
            const pkgPath = path.join(rootDir, "package.json");
            if (fs.existsSync(pkgPath)) return rootDir;

            const entries = fs.readdirSync(rootDir, { withFileTypes: true });
            const candidateDirs = entries
                .filter((e) => e.isDirectory())
                .map((e) => e.name)
                .filter((name) => !name.startsWith(".") && name !== "__MACOSX" && name !== "node_modules");

            const dirsWithPackage = candidateDirs.filter((dirName) =>
                fs.existsSync(path.join(rootDir, dirName, "package.json"))
            );

            if (dirsWithPackage.length === 1) {
                return path.join(rootDir, dirsWithPackage[0]);
            }

            return rootDir;
        };

        const projectRoot = detectSingleNestedAppRoot(workspaceRoot);
        if (projectRoot !== workspaceRoot) {
            await updateLogs(`[INFO] Auto-detected app root: ${path.relative(workspaceRoot, projectRoot)}`);
        }

        // Build Pipeline
        if (project.packageManager && project.buildCommand) {
            // Preflight: if user configured "npm/yarn/pnpm build" but package.json has no build script,
            // fail with a clear message (common when uploading plain HTML or selecting the wrong root).
            try {
                const pkgPath = path.join(projectRoot, "package.json");
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                    const scripts = pkg?.scripts || {};
                    const cmd = String(project.buildCommand).trim().toLowerCase();
                    const looksLikeScriptBuild =
                        cmd === "npm run build" ||
                        cmd === "yarn build" ||
                        cmd === "pnpm build" ||
                        cmd === "pnpm run build";

                    if (looksLikeScriptBuild && !scripts.build) {
                        throw new Error(
                            `package.json is missing a "build" script. ` +
                            `Either add it, or clear Build Command and set Output Directory to "." for plain HTML, ` +
                            `or select the correct project root.`
                        );
                    }
                }
            } catch (err) {
                if (err instanceof Error && err.message.includes('missing a "build" script')) throw err;
            }

            await updateLogs(`Running install: ${project.packageManager}...`);
            const installCmd = project.packageManager === "pnpm" ? "pnpm i" : (project.packageManager === "yarn" ? "yarn install" : "npm ci");
            await execPromise(installCmd, { cwd: projectRoot });

            await updateLogs(`Running build: ${project.buildCommand}...`);
            // Inject env vars
            const env = { ...process.env };
            const projectEnvVars = await prisma.envVar.findMany({ where: { projectId: project.id } });
            projectEnvVars.forEach(ev => { env[ev.key] = ev.value; });

            try {
                await execPromise(project.buildCommand, { cwd: projectRoot, env });
                await updateLogs("Build completed successfully.");
            } catch (buildError) {
                // Check if this is a case-sensitivity issue
                const errorOutput = buildError.stderr || buildError.stdout || buildError.message || '';
                const caseIssue = detectCaseSensitivityIssue(errorOutput, projectRoot);

                if (caseIssue) {
                    // Format helpful error message
                    await updateLogs("[ERROR] Command failed: " + project.buildCommand);
                    await updateLogs(formatCaseSensitivityError(caseIssue));
                } else {
                    // Regular build error
                    await updateLogs("[ERROR] Command failed: " + project.buildCommand);
                    if (errorOutput) {
                        await updateLogs(errorOutput);
                    }
                }

                throw buildError; // Re-throw to be caught by outer try-catch
            }
        } else {
            await updateLogs("No build command specified, using workspace as-is.");
        }

        // Validate Output
        const requestedOutputDir = project.outputDir || ".";
        let outputFullPath = path.join(projectRoot, requestedOutputDir);

        if (!fs.existsSync(outputFullPath)) {
            const rootIndexHtml = path.join(projectRoot, "index.html");
            const noBuildConfigured = !project.buildCommand;

            if (noBuildConfigured && fs.existsSync(rootIndexHtml)) {
                await updateLogs(`[WARN] Output directory not found (${requestedOutputDir}); using project root (index.html detected).`);
                outputFullPath = projectRoot;
            } else if (noBuildConfigured) {
                // Common ZIP case: content is inside a single top-level folder.
                const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
                const candidateDirs = entries
                    .filter((e) => e.isDirectory())
                    .map((e) => e.name)
                    .filter((name) => !name.startsWith(".") && name !== "__MACOSX");

                const dirsWithIndex = candidateDirs.filter((dirName) =>
                    fs.existsSync(path.join(projectRoot, dirName, "index.html"))
                );

                if (dirsWithIndex.length === 1) {
                    const chosen = path.join(projectRoot, dirsWithIndex[0]);
                    await updateLogs(`[WARN] Output directory not found (${requestedOutputDir}); using nested folder (index.html detected): ${dirsWithIndex[0]}`);
                    outputFullPath = chosen;
                } else {
                    throw new Error(`Output directory not found: ${project.outputDir}`);
                }
            } else {
                throw new Error(`Output directory not found: ${project.outputDir}`);
            }
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

        // Get base domain from environment (without protocol or port)
        const baseDomain = process.env.VITE_BASE_DOMAIN || process.env.BASE_DOMAIN || 'localhost';
        const publicUrl = process.env.PUBLIC_BASE_URL || `http://${baseDomain}`;
        // Extract domain and port from PUBLIC_BASE_URL if set
        const urlMatch = publicUrl.match(/^https?:\/\/([^:\/]+)(:\d+)?/);
        const domain = urlMatch ? urlMatch[1] : baseDomain;
        const port = urlMatch && urlMatch[2] ? urlMatch[2] : '';

        await updateLogs(`✓ Your site is now live at: http://${project.slug}.${domain}${port}`);
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
