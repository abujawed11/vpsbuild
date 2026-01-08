const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const util = require("util");

const execAsync = util.promisify(exec);

/**
 * Clones a GitHub repository into a workspace directory.
 * @param {string} repoUrl - Full HTTPS URL (e.g. https://github.com/user/repo.git)
 * @param {string} branch - Branch to checkout
 * @param {string} token - GitHub Access Token
 * @param {string} targetDir - Local directory path
 */
async function cloneRepo(repoFullName, branch, token, targetDir) {
  // Construct Authenticated URL
  // Format: https://x-access-token:<TOKEN>@github.com/user/repo.git
  const authUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

  try {
    // 1. Clean existing directory if it exists
    if (fs.existsSync(targetDir)) {
      console.log(`Cleaning existing workspace: ${targetDir}`);
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }

    // 2. Create directory
    await fs.promises.mkdir(targetDir, { recursive: true });

    // 3. Clone
    // We explicitly specify the branch to avoid fetching full history if possible,
    // but for deployment, full history might be overkill. --depth 1 is good.
    const command = `git clone --depth 1 --branch ${branch} "${authUrl}" .`;

    console.log(`Cloning ${repoFullName} (branch: ${branch}) into ${targetDir}...`);

    // Execute command inside the target directory with 60 second timeout
    await execAsync(command, {
      cwd: targetDir,
      timeout: 60000, // 60 seconds
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });

    console.log("Clone successful.");
    return true;
  } catch (error) {
    // SECURITY: Do not log the error directly if it contains the token
    const safeMsg = error.message.replace(token, "***TOKEN***");
    console.error("Clone failed:", safeMsg);
    throw new Error(`Git clone failed: ${safeMsg}`);
  }
}

module.exports = { cloneRepo };
