const fs = require("fs");
const path = require("path");

async function analyzeWorkspace(workspacePath) {
  const config = {
    runtime: "unknown",
    framework: "unknown",
    packageManager: "npm",
    buildCommand: "",
    startCommand: "",
    outputDir: "",
    port: 3000
  };

  const files = await fs.promises.readdir(workspacePath);
  const hasFile = (f) => files.includes(f);

  // 1. Check for Node.js
  if (hasFile("package.json")) {
    config.runtime = "node";
    const pkg = JSON.parse(await fs.promises.readFile(path.join(workspacePath, "package.json"), "utf8"));
    const scripts = pkg.scripts || {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Package Manager
    if (hasFile("yarn.lock")) config.packageManager = "yarn";
    else if (hasFile("pnpm-lock.yaml")) config.packageManager = "pnpm";
    else config.packageManager = "npm";

    // Framework Detection & Defaults
    if (deps["next"]) {
      config.framework = "nextjs";
      config.buildCommand = "npm run build"; // Adapter will handle runner
      config.startCommand = "npm start";
      config.outputDir = ".next";
      config.port = 3000;
    } else if (deps["vite"]) {
      config.framework = "react-vite"; // or vue-vite
      config.buildCommand = "npm run build";
      config.startCommand = "npm run preview"; // or serve dist
      config.outputDir = "dist";
      config.port = 4173; // Vite preview default
    } else if (deps["react-scripts"]) {
      config.framework = "create-react-app";
      config.buildCommand = "npm run build";
      config.startCommand = "npx serve -s build";
      config.outputDir = "build";
      config.port = 3000;
    } else if (deps["express"]) {
      config.framework = "express";
      config.buildCommand = ""; // Usually none for raw node
      config.startCommand = scripts.start || "node index.js";
      config.outputDir = "";
      config.port = process.env.PORT || 3000;
    }

    // Override if scripts exist
    if (scripts.build) {
        // preserve detected build command if it matches script name, or use generic
        if (!config.buildCommand) config.buildCommand = `${config.packageManager} run build`;
    }
    
    // Fallback start command
    if (!config.startCommand) {
        if (scripts.start) config.startCommand = `${config.packageManager} run start`;
        else if (hasFile("index.js")) config.startCommand = "node index.js";
        else if (hasFile("server.js")) config.startCommand = "node server.js";
        else if (hasFile("app.js")) config.startCommand = "node app.js";
    }

    return config;
  }

  // 2. Check for Python
  if (hasFile("requirements.txt") || hasFile("Pipfile")) {
    config.runtime = "python";
    config.packageManager = "pip";
    // TODO: deeper python analysis (flask/django)
    if (hasFile("manage.py")) {
        config.framework = "django";
        config.startCommand = "gunicorn project.wsgi";
        config.port = 8000;
    } else if (hasFile("app.py")) {
        config.framework = "flask";
        config.startCommand = "gunicorn app:app";
        config.port = 5000;
    }
    return config;
  }

  // 3. Static
  if (hasFile("index.html")) {
    config.runtime = "static";
    config.framework = "html";
    config.outputDir = ".";
    config.port = 80;
    return config;
  }

  return config;
}

module.exports = { analyzeWorkspace };
