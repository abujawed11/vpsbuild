const Docker = require("dockerode");
const fs = require("fs");
const path = require("path");
const tar = require("tar-fs");
const { Readable } = require("stream");

const docker = new Docker();

/**
 * Build a Docker image from a directory containing a Dockerfile
 */
async function buildImage(buildContext, dockerfilePath, imageName, onProgress) {
  return new Promise((resolve, reject) => {
    console.log(`Building Docker image: ${imageName}`);
    console.log(`Build context: ${buildContext}`);
    console.log(`Dockerfile: ${dockerfilePath}`);

    // Create tar stream of build context
    const tarStream = tar.pack(buildContext);

    const buildOptions = {
      t: imageName,
      dockerfile: path.relative(buildContext, dockerfilePath),
    };

    docker.buildImage(tarStream, buildOptions, (err, stream) => {
      if (err) {
        console.error("Build image error:", err);
        return reject(err);
      }

      let buildLogs = "";

      // Follow the build progress
      docker.modem.followProgress(
        stream,
        (err, res) => {
          if (err) {
            console.error("Build failed:", err);
            return reject(new Error(`Docker build failed: ${err.message}`));
          }
          console.log(`✓ Image built successfully: ${imageName}`);
          resolve({ imageName, logs: buildLogs });
        },
        (event) => {
          // Capture logs
          if (event.stream) {
            buildLogs += event.stream;
            console.log(event.stream.trim());

            if (onProgress) {
              onProgress(event.stream);
            }
          }
          if (event.error) {
            console.error("Build error:", event.error);
          }
        }
      );
    });
  });
}

/**
 * Run a container from an image
 */
async function runContainer(imageName, containerName, options = {}) {
  console.log(`Starting container: ${containerName} from ${imageName}`);

  try {
    // Check if container already exists
    const existingContainer = docker.getContainer(containerName);
    try {
      const info = await existingContainer.inspect();
      console.log(`Container ${containerName} already exists, removing...`);

      if (info.State.Running) {
        await existingContainer.stop();
      }
      await existingContainer.remove();
    } catch (e) {
      // Container doesn't exist, that's fine
    }

    // Create and start container
    const container = await docker.createContainer({
      Image: imageName,
      name: containerName,
      ExposedPorts: options.exposedPorts || {},
      HostConfig: {
        PortBindings: options.portBindings || {},
        RestartPolicy: { Name: "unless-stopped" },
      },
      Env: options.env || [],
    });

    await container.start();
    console.log(`✓ Container started: ${containerName}`);

    return {
      containerId: container.id,
      containerName,
    };
  } catch (error) {
    console.error("Run container error:", error);
    throw new Error(`Failed to run container: ${error.message}`);
  }
}

/**
 * Stop and remove a container
 */
async function stopContainer(containerName) {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();

    if (info.State.Running) {
      await container.stop();
    }
    await container.remove();
    console.log(`✓ Container stopped and removed: ${containerName}`);
  } catch (error) {
    console.error(`Error stopping container ${containerName}:`, error.message);
  }
}

/**
 * Get container logs
 */
async function getContainerLogs(containerName) {
  try {
    const container = docker.getContainer(containerName);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 100,
    });
    return logs.toString();
  } catch (error) {
    console.error(`Error getting logs for ${containerName}:`, error.message);
    return "";
  }
}

/**
 * Check if Docker is available
 */
async function checkDockerAvailable() {
  try {
    await docker.ping();
    console.log("✓ Docker is available");
    return true;
  } catch (error) {
    console.error("✗ Docker is not available:", error.message);
    return false;
  }
}

/**
 * Write Dockerfile to disk
 */
async function writeDockerfile(content, targetDir) {
  const dockerfilePath = path.join(targetDir, "Dockerfile");
  await fs.promises.writeFile(dockerfilePath, content, "utf8");
  console.log(`✓ Dockerfile written: ${dockerfilePath}`);
  return dockerfilePath;
}

/**
 * Generate unique port for container
 */
function generatePort(basePort = 3000) {
  // In production, you'd want to track used ports
  // For now, use a random port between 3000-9000
  return Math.floor(Math.random() * 6000) + 3000;
}

module.exports = {
  buildImage,
  runContainer,
  stopContainer,
  getContainerLogs,
  checkDockerAvailable,
  writeDockerfile,
  generatePort,
  docker,
};
