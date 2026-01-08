const express = require("express");
const axios = require("axios");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const path = require("path");
const { cloneRepo } = require("../lib/git");
const { detectProjectStructure, getDetectionSummary } = require("../lib/project-detector");
const { analyzeProject } = require("../lib/analyzer");
const {
    generateNodeBackendDockerfile,
    generatePythonBackendDockerfile,
    generateFrontendDockerfile
} = require("../lib/docker-generator");
const {
    buildImage,
    runContainer,
    checkDockerAvailable,
    writeDockerfile,
    generatePort
} = require("../lib/docker-service");

const router = express.Router();

/**
 * POST /api/v2/projects/import
 * Simplified import: just provide repo and branch
 * Auto-detection happens automatically
 */
router.post("/import", authRequired, async (req, res) => {
  const { repoFullName, branch } = req.body;

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

    // 2. Fetch Repo Details
    const { data: repoInfo } = await axios.get(
      `https://api.github.com/repos/${repoFullName}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } }
    );

    const targetBranch = branch || repoInfo.default_branch || "main";
    const name = repoInfo.name;

    // 3. Create Project (minimal info for now)
    const project = await prisma.project.upsert({
      where: {
        userId_name: {
          userId: req.user.id,
          name: name,
        },
      },
      update: {
        repoFullName,
        productionBranch: targetBranch,
      },
      create: {
        userId: req.user.id,
        name: name,
        repoFullName,
        productionBranch: targetBranch,
      },
    });

    res.json({ success: true, project });

  } catch (err) {
    console.error("Project import failed:", err.message);
    res.status(500).json({ error: "Failed to import project" });
  }
});

/**
 * GET /api/v2/projects/:id
 * Get project details with latest deployment
 */
router.get("/:id", authRequired, async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        deployments: {
          orderBy: { createdAt: "desc" },
          take: 5
        },
        branchConfigs: true
      }
    });

    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ project });
  } catch (err) {
    console.error("Get project error:", err.message);
    res.status(500).json({ error: "Failed to get project" });
  }
});

/**
 * POST /api/v2/projects/:id/deploy
 * One-click deploy with auto-detection
 * This is the main deployment endpoint
 */
router.post("/:id/deploy", authRequired, async (req, res) => {
  const { id } = req.params;
  const { branch, deploymentType = "PRODUCTION" } = req.body;

  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: "Project not found" });
    }

    const targetBranch = branch || project.productionBranch;

    // Get GitHub token
    const account = await prisma.githubAccount.findUnique({
      where: { userId: req.user.id },
    });

    if (!account) {
      return res.status(400).json({ error: "GitHub token missing" });
    }

    // Get latest commit info
    const { data: commitData } = await axios.get(
      `https://api.github.com/repos/${project.repoFullName}/commits/${targetBranch}`,
      { headers: { Authorization: `Bearer ${account.accessToken}` } }
    );

    // Create deployment record
    const deployment = await prisma.deployment.create({
      data: {
        projectId: id,
        branch: targetBranch,
        commitHash: commitData.sha,
        commitMessage: commitData.commit.message,
        status: "QUEUED",
        deploymentType
      }
    });

    // Start deployment process asynchronously (in real app, use queue)
    performDeployment(deployment.id, project, account.accessToken, targetBranch)
      .catch(err => console.error("Deployment error:", err));

    res.json({ success: true, deployment });

  } catch (err) {
    console.error("Deploy initiation error:", err.message);
    res.status(500).json({ error: "Failed to start deployment" });
  }
});

/**
 * GET /api/v2/projects/deployments/:id
 * Get deployment status and logs
 */
router.get("/deployments/:id", authRequired, async (req, res) => {
  try {
    const deployment = await prisma.deployment.findUnique({
      where: { id: req.params.id },
      include: { project: true }
    });

    if (!deployment || deployment.project.userId !== req.user.id) {
      return res.status(404).json({ error: "Deployment not found" });
    }

    res.json({ deployment });
  } catch (err) {
    res.status(500).json({ error: "Failed to get deployment" });
  }
});

/**
 * POST /api/v2/projects/:id/change-branch
 * Change production branch
 */
router.post("/:id/change-branch", authRequired, async (req, res) => {
  const { id } = req.params;
  const { branch } = req.body;

  if (!branch) {
    return res.status(400).json({ error: "Branch name required" });
  }

  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project || project.userId !== req.user.id) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Update production branch
    await prisma.project.update({
      where: { id },
      data: { productionBranch: branch }
    });

    res.json({ success: true, branch });
  } catch (err) {
    res.status(500).json({ error: "Failed to change branch" });
  }
});

// ===== INTERNAL DEPLOYMENT LOGIC =====

/**
 * Perform the actual deployment
 * This runs in the background
 */
async function performDeployment(deploymentId, project, githubToken, branch) {
  const updateStatus = async (status, data = {}) => {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status, ...data }
    });
  };

  const logError = async (error) => {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "ERROR",
        errorMessage: error.message || error,
        buildFinished: new Date()
      }
    });
  };

  try {
    // Step 1: Clone Repository
    await updateStatus("CLONING", { buildStarted: new Date() });

    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(__dirname, "../../workspaces");
    const targetDir = path.join(workspaceRoot, project.userId, project.name, branch);

    // Delete existing directory if it exists (for clean deployments)
    const fs = require("fs");
    if (fs.existsSync(targetDir)) {
      console.log(`Removing existing directory: ${targetDir}`);
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }

    await cloneRepo(project.repoFullName, branch, githubToken, targetDir);

    // Update project workspace path (for first deployment)
    if (!project.workspacePath) {
      await prisma.project.update({
        where: { id: project.id },
        data: {
          workspacePath: targetDir,
          cloneStatus: "CLONED"
        }
      });
    }

    // Step 2: Auto-Detect Project Structure
    await updateStatus("ANALYZING");

    const detection = await detectProjectStructure(targetDir);
    const analysis = await analyzeProject(targetDir, detection);
    const summary = getDetectionSummary(detection);

    console.log("Detection:", JSON.stringify(summary, null, 2));

    // Update project with detected config
    const projectUpdate = {
      projectType: detection.projectType,
      frontendRoot: detection.frontendRoot,
      backendRoot: detection.backendRoot,
    };

    if (analysis.frontend) {
      projectUpdate.frontendFramework = analysis.frontend.framework;
      projectUpdate.frontendBuildCmd = analysis.frontend.buildCommand;
      projectUpdate.frontendOutputDir = analysis.frontend.outputDir;
      projectUpdate.frontendNodeVersion = analysis.frontend.nodeVersion;
    }

    if (analysis.backend) {
      projectUpdate.backendRuntime = analysis.backend.runtime;
      projectUpdate.backendStartCmd = analysis.backend.startCommand;
      projectUpdate.backendPort = analysis.backend.port;
      projectUpdate.backendPackageManager = analysis.backend.packageManager;
    }

    await prisma.project.update({
      where: { id: project.id },
      data: projectUpdate
    });

    // Step 3: Check Docker availability
    const dockerAvailable = await checkDockerAvailable();
    if (!dockerAvailable) {
      throw new Error("Docker is not running. Please start Docker Desktop.");
    }

    // Step 4: Generate and Write Dockerfiles
    await updateStatus("BUILDING");

    let backendDockerfile = null;
    let frontendDockerfile = null;
    let backendImageName = null;
    let frontendImageName = null;

    const projectSlug = project.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const deploymentSlug = deploymentId.substring(0, 8);

    // Backend
    if (analysis.backend) {
      const backendDir = path.join(targetDir, analysis.backend.root || "");

      if (analysis.backend.runtime === "node") {
        backendDockerfile = generateNodeBackendDockerfile({
          packageManager: analysis.backend.packageManager,
          port: analysis.backend.port,
          startCommand: analysis.backend.startCommand
        });
      } else if (analysis.backend.runtime === "python") {
        backendDockerfile = generatePythonBackendDockerfile({
          port: analysis.backend.port,
          startCommand: analysis.backend.startCommand
        });
      }

      if (backendDockerfile) {
        await writeDockerfile(backendDockerfile, backendDir);
        backendImageName = `${projectSlug}-backend:${deploymentSlug}`;

        console.log("Building backend Docker image...");
        await buildImage(backendDir, path.join(backendDir, "Dockerfile"), backendImageName);
      }
    }

    // Frontend
    if (analysis.frontend) {
      const frontendDir = path.join(targetDir, analysis.frontend.root || "");

      frontendDockerfile = generateFrontendDockerfile({
        packageManager: analysis.frontend.packageManager || "npm",
        outputDir: analysis.frontend.outputDir,
        buildCommand: analysis.frontend.buildCommand
      });

      if (frontendDockerfile) {
        await writeDockerfile(frontendDockerfile, frontendDir);
        frontendImageName = `${projectSlug}-frontend:${deploymentSlug}`;

        console.log("Building frontend Docker image...");
        await buildImage(frontendDir, path.join(frontendDir, "Dockerfile"), frontendImageName);
      }
    }

    // Save Dockerfiles to deployment record
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        dockerfileBackendContent: backendDockerfile,
        dockerfileFrontendContent: frontendDockerfile
      }
    });

    // Step 5: Deploy Containers
    await updateStatus("DEPLOYING");

    const containers = [];

    // Deploy Backend Container
    if (backendImageName && analysis.backend) {
      const backendPort = generatePort(analysis.backend.port || 3000);
      const containerName = `${projectSlug}-backend-${deploymentSlug}`;

      await runContainer(backendImageName, containerName, {
        exposedPorts: { [`${analysis.backend.port}/tcp`]: {} },
        portBindings: {
          [`${analysis.backend.port}/tcp`]: [{ HostPort: backendPort.toString() }]
        }
      });

      containers.push({
        name: containerName,
        port: backendPort,
        type: "backend"
      });

      console.log(`✓ Backend running on port ${backendPort}`);
    }

    // Deploy Frontend Container
    if (frontendImageName) {
      const frontendPort = generatePort(80);
      const containerName = `${projectSlug}-frontend-${deploymentSlug}`;

      await runContainer(frontendImageName, containerName, {
        exposedPorts: { "80/tcp": {} },
        portBindings: {
          "80/tcp": [{ HostPort: frontendPort.toString() }]
        }
      });

      containers.push({
        name: containerName,
        port: frontendPort,
        type: "frontend"
      });

      console.log(`✓ Frontend running on port ${frontendPort}`);
    }

    // Step 6: Assign URL
    // For now, use localhost URL with the actual port
    // In production, you'd setup nginx reverse proxy with SSL
    const mainContainer = containers.find(c => c.type === "frontend") || containers[0];
    const url = mainContainer
      ? `http://localhost:${mainContainer.port}`
      : `http://localhost:3000`;

    // Step 7: Mark as Ready
    const currentDeployment = await prisma.deployment.findUnique({
      where: { id: deploymentId }
    });

    const buildDuration = currentDeployment.buildStarted
      ? Math.floor((new Date() - new Date(currentDeployment.buildStarted)) / 1000)
      : 0;

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "READY",
        url,
        deployedAt: new Date(),
        buildFinished: new Date(),
        buildDuration
      }
    });

    console.log(`Deployment ${deploymentId} completed successfully!`);

  } catch (error) {
    console.error("Deployment error:", error);
    console.error("Error stack:", error.stack);
    await logError(error);
    throw error; // Re-throw so it's logged
  }
}

module.exports = router;
