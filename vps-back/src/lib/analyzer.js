const fs = require("fs");
const path = require("path");

/**
 * Analyze a specific directory for build configuration
 * Used after project structure detection to get detailed build settings
 *
 * @param {string} basePath - Base workspace path
 * @param {string} relativePath - Relative path to the component (frontend/backend)
 * @param {string} componentType - "frontend" or "backend"
 */
async function analyzeComponent(basePath, relativePath = "", componentType = "frontend") {
  const targetPath = path.join(basePath, relativePath);

  const config = {
    runtime: "unknown",
    framework: "unknown",
    packageManager: "npm",
    buildCommand: "",
    startCommand: "",
    outputDir: "",
    port: componentType === "frontend" ? 80 : 3000,
    nodeVersion: "18"
  };

  try {
    const files = await fs.promises.readdir(targetPath);
    const hasFile = (f) => files.includes(f);

    // Helper to get command with correct package manager
    const getCmd = (script) => {
      if (config.packageManager === "yarn") {
        return `yarn ${script}`;
      } else if (config.packageManager === "pnpm") {
        return `pnpm ${script}`;
      } else {
        return `npm run ${script}`;
      }
    };

    // 1. Check for Node.js
    if (hasFile("package.json")) {
      config.runtime = "node";
      const pkg = JSON.parse(await fs.promises.readFile(path.join(targetPath, "package.json"), "utf8"));
      const scripts = pkg.scripts || {};
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Package Manager
      if (hasFile("yarn.lock")) config.packageManager = "yarn";
      else if (hasFile("pnpm-lock.yaml")) config.packageManager = "pnpm";
      else config.packageManager = "npm";

      if (componentType === "frontend") {
        // Frontend Framework Detection
        if (deps["next"]) {
          config.framework = "nextjs";
          config.buildCommand = getCmd("build");
          config.startCommand = getCmd("start");
          config.outputDir = ".next";
          config.port = 3000;
        } else if (deps["vite"]) {
          config.framework = "vite";
          config.buildCommand = getCmd("build");
          config.startCommand = ""; // Vite builds to static files
          config.outputDir = "dist";
          config.port = 80; // Will be served by nginx
        } else if (deps["react-scripts"]) {
          config.framework = "create-react-app";
          config.buildCommand = getCmd("build");
          config.startCommand = "";
          config.outputDir = "build";
          config.port = 80;
        } else if (deps["@angular/core"]) {
          config.framework = "angular";
          config.buildCommand = getCmd("build");
          config.startCommand = "";
          config.outputDir = "dist";
          config.port = 80;
        } else if (deps["vue"]) {
          config.framework = "vue";
          config.buildCommand = getCmd("build");
          config.startCommand = "";
          config.outputDir = "dist";
          config.port = 80;
        } else if (deps["svelte"]) {
          config.framework = "svelte";
          config.buildCommand = getCmd("build");
          config.startCommand = "";
          config.outputDir = "build";
          config.port = 80;
        }

        // Override with scripts if they exist
        if (scripts.build && !config.buildCommand) {
          config.buildCommand = getCmd("build");
        }
      } else {
        // Backend Framework Detection
        if (deps["express"]) {
          config.framework = "express";
          config.buildCommand = ""; // Usually none for Express
          config.startCommand = scripts.start || "node index.js";
          config.port = 3000;
        } else if (deps["fastify"]) {
          config.framework = "fastify";
          config.buildCommand = "";
          config.startCommand = scripts.start || "node index.js";
          config.port = 3000;
        } else if (deps["@nestjs/core"]) {
          config.framework = "nestjs";
          config.buildCommand = getCmd("build");
          config.startCommand = getCmd("start:prod");
          config.port = 3000;
        } else if (deps["koa"]) {
          config.framework = "koa";
          config.buildCommand = "";
          config.startCommand = scripts.start || "node index.js";
          config.port = 3000;
        }

        // Fallback start command for backend
        if (!config.startCommand) {
          if (scripts.start) config.startCommand = getCmd("start");
          else if (hasFile("index.js")) config.startCommand = "node index.js";
          else if (hasFile("server.js")) config.startCommand = "node server.js";
          else if (hasFile("app.js")) config.startCommand = "node app.js";
          else if (hasFile("main.js")) config.startCommand = "node main.js";
        }
      }

      return config;
    }

    // 2. Check for Python (Backend only)
    if (componentType === "backend" && (hasFile("requirements.txt") || hasFile("Pipfile"))) {
      config.runtime = "python";
      config.packageManager = "pip";

      if (hasFile("manage.py")) {
        config.framework = "django";
        config.startCommand = "gunicorn project.wsgi";
        config.port = 8000;
      } else if (hasFile("app.py")) {
        config.framework = "flask";
        config.startCommand = "gunicorn app:app";
        config.port = 5000;
      } else if (hasFile("main.py")) {
        config.framework = "fastapi";
        config.startCommand = "uvicorn main:app --host 0.0.0.0 --port 8000";
        config.port = 8000;
      }

      return config;
    }

    // 3. Static HTML (Frontend only)
    if (componentType === "frontend" && hasFile("index.html")) {
      config.runtime = "static";
      config.framework = "html";
      config.outputDir = ".";
      config.port = 80;
      return config;
    }

  } catch (e) {
    console.error(`Error analyzing ${componentType}:`, e.message);
  }

  return config;
}

/**
 * Analyze entire project with auto-detection
 * Returns complete project configuration
 */
async function analyzeProject(workspacePath, detection) {
  const result = {
    projectType: detection.projectType,
    frontend: null,
    backend: null
  };

  // Analyze frontend if detected
  if (detection.frontendRoot !== null) {
    result.frontend = await analyzeComponent(
      workspacePath,
      detection.frontendRoot,
      "frontend"
    );
    result.frontend.root = detection.frontendRoot;
  }

  // Analyze backend if detected
  if (detection.backendRoot !== null) {
    result.backend = await analyzeComponent(
      workspacePath,
      detection.backendRoot,
      "backend"
    );
    result.backend.root = detection.backendRoot;
  }

  return result;
}

module.exports = {
  analyzeComponent,
  analyzeProject
};
