const fs = require("fs");
const path = require("path");

async function analyzeWorkspace(basePath, relativePath = "") {
  const targetPath = path.join(basePath, relativePath);
  
  const config = {
    runtime: "unknown",
    framework: "unknown",
    packageManager: "npm",
    buildCommand: "",
    startCommand: "",
    outputDir: "",
    port: 3000
  };

  const files = await fs.promises.readdir(targetPath);
  const hasFile = (f) => files.includes(f);

  // 1. Check for Node.js
  if (hasFile("package.json")) {
    config.runtime = "node";
    const pkg = JSON.parse(await fs.promises.readFile(path.join(targetPath, "package.json"), "utf8"));
    const scripts = pkg.scripts || {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Package Manager
    if (hasFile("pnpm-lock.yaml")) config.packageManager = "pnpm";
    else if (hasFile("yarn.lock")) config.packageManager = "yarn";
    else config.packageManager = "npm";

    // Helper to get command with correct package manager
    const getInstallCmd = () => {
      if (config.packageManager === "pnpm") return "pnpm i --frozen-lockfile";
      if (config.packageManager === "yarn") return "yarn install --frozen-lockfile";
      return "npm ci";
    };

    const getBuildCmd = (script) => {
      if (config.packageManager === "pnpm") return `pnpm ${script}`;
      if (config.packageManager === "yarn") return `yarn ${script}`;
      return `npm run ${script}`;
    };

    config.installCommand = getInstallCmd();

    // Framework Detection & Defaults
    if (deps["next"]) {
      config.framework = "nextjs";
      config.buildCommand = getBuildCmd("build");
      config.outputDir = ".next";
      config.isStatic = false; // Next.js usually needs SSR unless exported
    } else if (deps["vite"]) {
      config.framework = "vite";
      config.buildCommand = getBuildCmd("build");
      config.outputDir = "dist";
      config.isStatic = true;
    } else if (deps["react-scripts"]) {
      config.framework = "create-react-app";
      config.buildCommand = getBuildCmd("build");
      config.outputDir = "build";
      config.isStatic = true;
    } else if (deps["@angular/core"]) {
      config.framework = "angular";
      config.buildCommand = getBuildCmd("build");
      config.outputDir = "dist";
      config.isStatic = true;
    }

    // Override if scripts exist
    if (scripts.build && !config.buildCommand) {
        config.buildCommand = getBuildCmd("build");
    }
    
    if (!config.outputDir && config.isStatic) {
        config.outputDir = "dist";
    }

    return config;
  }

  // 3. Static (No package.json)
  if (hasFile("index.html")) {
    config.runtime = "static";
    config.framework = "static";
    config.packageManager = null;
    config.installCommand = null;
    config.buildCommand = null;
    config.outputDir = ".";
    config.isStatic = true;
    return config;
  }

  return config;
}

module.exports = { analyzeWorkspace };
