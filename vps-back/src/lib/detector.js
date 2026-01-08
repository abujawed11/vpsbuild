const axios = require("axios");

/**
 * Analyzes repository files to detect the framework.
 * @param {string} repoFullName - e.g. "user/repo"
 * @param {string} token - GitHub Access Token
 * @param {string} branch - Branch to check (default: main)
 * @returns {Promise<string>} - Detected framework (e.g. "react-vite", "node", "python", "static", "unknown")
 */
async function detectFramework(repoFullName, token, branch = "main") {
  try {
    // 1. Fetch root file list
    const { data: files } = await axios.get(
      `https://api.github.com/repos/${repoFullName}/contents?ref=${branch}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const fileNames = files.map((f) => f.name.toLowerCase());

    // 2. Check for key files
    const hasPackageJson = fileNames.includes("package.json");
    const hasRequirementsTxt = fileNames.includes("requirements.txt");
    const hasPipfile = fileNames.includes("pipfile");
    const hasDockerfile = fileNames.includes("dockerfile");
    const hasIndexHtml = fileNames.includes("index.html");

    // 3. Deep dive into package.json if it exists
    if (hasPackageJson) {
      try {
        const pkgFile = files.find((f) => f.name.toLowerCase() === "package.json");
        const { data: pkgContent } = await axios.get(pkgFile.url, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3.raw" } 
        });
        
        const deps = { ...pkgContent.dependencies, ...pkgContent.devDependencies };
        const scriptKeys = Object.keys(pkgContent.scripts || {});

        if (deps["react"] && deps["vite"]) return "react-vite";
        if (deps["next"]) return "nextjs";
        if (deps["react-scripts"]) return "create-react-app";
        if (deps["vue"]) return "vue";
        if (deps["express"]) return "node-express";
        
        return "node"; // Generic Node
      } catch (err) {
        console.warn("Failed to read package.json:", err.message);
        return "node";
      }
    }

    if (hasRequirementsTxt || hasPipfile) return "python";
    if (hasDockerfile) return "docker";
    if (hasIndexHtml) return "static";

    return "unknown";
  } catch (err) {
    console.error("Detection failed:", err.message);
    return "unknown";
  }
}

module.exports = { detectFramework };
