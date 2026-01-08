const fs = require("fs");
const path = require("path");

/**
 * Auto-detect project structure and type
 * Returns project type and root paths for frontend/backend
 */
async function detectProjectStructure(workspacePath) {
  const result = {
    projectType: "FRONTEND_ONLY", // Default
    frontendRoot: null,
    backendRoot: null,
    detectionDetails: {}
  };

  // Common frontend folder patterns
  const frontendPatterns = [
    "frontend",
    "client",
    "web",
    "app",
    "ui",
    "apps/frontend",
    "apps/client",
    "apps/web",
    "packages/frontend",
    "packages/client",
    "packages/web"
  ];

  // Common backend folder patterns
  const backendPatterns = [
    "backend",
    "server",
    "api",
    "services",
    "apps/backend",
    "apps/server",
    "apps/api",
    "packages/backend",
    "packages/server",
    "packages/api"
  ];

  // Check for frontend folders
  for (const pattern of frontendPatterns) {
    const fullPath = path.join(workspacePath, pattern);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      // Verify it's actually a frontend by checking for signals
      const signals = await detectFrontendSignals(fullPath);
      if (signals.isFrontend) {
        result.frontendRoot = pattern;
        result.detectionDetails.frontendSignals = signals.signals;
        break;
      }
    }
  }

  // Check for backend folders
  for (const pattern of backendPatterns) {
    const fullPath = path.join(workspacePath, pattern);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      // Verify it's actually a backend by checking for signals
      const signals = await detectBackendSignals(fullPath);
      if (signals.isBackend) {
        result.backendRoot = pattern;
        result.detectionDetails.backendSignals = signals.signals;
        break;
      }
    }
  }

  // If no separate folders found, check root directory
  if (!result.frontendRoot && !result.backendRoot) {
    const rootFrontendSignals = await detectFrontendSignals(workspacePath);
    const rootBackendSignals = await detectBackendSignals(workspacePath);

    if (rootFrontendSignals.isFrontend && rootBackendSignals.isBackend) {
      // Both in root - prefer backend for monorepo detection
      // This is an edge case - usually they're separated
      result.projectType = "BACKEND_ONLY";
      result.backendRoot = "";
      result.detectionDetails.note = "Both frontend and backend signals at root, defaulting to backend";
    } else if (rootFrontendSignals.isFrontend) {
      result.projectType = "FRONTEND_ONLY";
      result.frontendRoot = "";
      result.detectionDetails.frontendSignals = rootFrontendSignals.signals;
    } else if (rootBackendSignals.isBackend) {
      result.projectType = "BACKEND_ONLY";
      result.backendRoot = "";
      result.detectionDetails.backendSignals = rootBackendSignals.signals;
    } else {
      // No clear signals - default to frontend
      result.projectType = "FRONTEND_ONLY";
      result.frontendRoot = "";
      result.detectionDetails.note = "No clear signals, defaulting to frontend";
    }
  } else if (result.frontendRoot && result.backendRoot) {
    // Found both separated folders
    result.projectType = "MONOREPO";
  } else if (result.frontendRoot) {
    result.projectType = "FRONTEND_ONLY";
  } else if (result.backendRoot) {
    result.projectType = "BACKEND_ONLY";
  }

  return result;
}

/**
 * Detect if a directory contains frontend code
 */
async function detectFrontendSignals(dirPath) {
  const signals = [];
  let isFrontend = false;

  try {
    const files = await fs.promises.readdir(dirPath);

    // Frontend framework indicators
    const frontendIndicators = {
      "package.json": async () => {
        try {
          const pkg = JSON.parse(await fs.promises.readFile(path.join(dirPath, "package.json"), "utf8"));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };

          if (deps["react"] || deps["@types/react"]) {
            signals.push("React");
            isFrontend = true;
          }
          if (deps["vue"]) {
            signals.push("Vue");
            isFrontend = true;
          }
          if (deps["next"]) {
            signals.push("Next.js");
            isFrontend = true;
          }
          if (deps["vite"]) {
            signals.push("Vite");
            isFrontend = true;
          }
          if (deps["@angular/core"]) {
            signals.push("Angular");
            isFrontend = true;
          }
          if (deps["svelte"]) {
            signals.push("Svelte");
            isFrontend = true;
          }
          if (deps["react-scripts"]) {
            signals.push("Create React App");
            isFrontend = true;
          }
        } catch (e) {
          // Invalid package.json
        }
      },
      "vite.config.js": () => {
        signals.push("Vite config");
        isFrontend = true;
      },
      "vite.config.ts": () => {
        signals.push("Vite config");
        isFrontend = true;
      },
      "next.config.js": () => {
        signals.push("Next.js config");
        isFrontend = true;
      },
      "next.config.mjs": () => {
        signals.push("Next.js config");
        isFrontend = true;
      },
      "angular.json": () => {
        signals.push("Angular config");
        isFrontend = true;
      },
      "svelte.config.js": () => {
        signals.push("Svelte config");
        isFrontend = true;
      },
      "nuxt.config.js": () => {
        signals.push("Nuxt.js config");
        isFrontend = true;
      },
      "index.html": () => {
        signals.push("HTML entry");
        // Don't set isFrontend=true just for HTML, needs more signals
      },
      "public": () => {
        if (fs.existsSync(path.join(dirPath, "public")) && fs.statSync(path.join(dirPath, "public")).isDirectory()) {
          signals.push("public/ folder");
        }
      },
      "src": () => {
        const srcPath = path.join(dirPath, "src");
        if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
          // Check for typical frontend files in src
          const srcFiles = fs.readdirSync(srcPath);
          if (srcFiles.some(f => f.match(/\.(jsx|tsx|vue|svelte)$/))) {
            signals.push("Frontend src files");
            isFrontend = true;
          }
        }
      }
    };

    // Check each indicator
    for (const [file, checker] of Object.entries(frontendIndicators)) {
      if (files.includes(file)) {
        if (checker) await checker();
      }
    }
  } catch (e) {
    console.error("Error detecting frontend:", e.message);
  }

  return { isFrontend, signals };
}

/**
 * Detect if a directory contains backend code
 */
async function detectBackendSignals(dirPath) {
  const signals = [];
  let isBackend = false;

  try {
    const files = await fs.promises.readdir(dirPath);

    // Backend framework indicators
    const backendIndicators = {
      "package.json": async () => {
        try {
          const pkg = JSON.parse(await fs.promises.readFile(path.join(dirPath, "package.json"), "utf8"));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };

          if (deps["express"]) {
            signals.push("Express.js");
            isBackend = true;
          }
          if (deps["fastify"]) {
            signals.push("Fastify");
            isBackend = true;
          }
          if (deps["koa"]) {
            signals.push("Koa");
            isBackend = true;
          }
          if (deps["@nestjs/core"]) {
            signals.push("NestJS");
            isBackend = true;
          }
          if (deps["hapi"]) {
            signals.push("Hapi");
            isBackend = true;
          }
          if (deps["@apollo/server"] || deps["apollo-server"]) {
            signals.push("Apollo GraphQL");
            isBackend = true;
          }
        } catch (e) {
          // Invalid package.json
        }
      },
      "requirements.txt": () => {
        signals.push("Python requirements");
        isBackend = true;
      },
      "Pipfile": () => {
        signals.push("Python Pipfile");
        isBackend = true;
      },
      "manage.py": () => {
        signals.push("Django");
        isBackend = true;
      },
      "app.py": () => {
        signals.push("Flask/Python app");
        isBackend = true;
      },
      "main.py": () => {
        signals.push("Python main");
        isBackend = true;
      },
      "go.mod": () => {
        signals.push("Go module");
        isBackend = true;
      },
      "Cargo.toml": () => {
        signals.push("Rust Cargo");
        isBackend = true;
      },
      "pom.xml": () => {
        signals.push("Java Maven");
        isBackend = true;
      },
      "build.gradle": () => {
        signals.push("Java Gradle");
        isBackend = true;
      }
    };

    // Check each indicator
    for (const [file, checker] of Object.entries(backendIndicators)) {
      if (files.includes(file)) {
        if (checker) await checker();
      }
    }

    // Check for common backend file patterns
    const hasServerFiles = files.some(f =>
      f.match(/^(server|index|app|main)\.(js|ts)$/) &&
      !f.includes("test") &&
      !f.includes("spec")
    );
    if (hasServerFiles && files.includes("package.json")) {
      // Additional check: look for server-like code
      signals.push("Server entry files");
      // Only set isBackend if we haven't found other signals yet
      // to avoid false positives
    }
  } catch (e) {
    console.error("Error detecting backend:", e.message);
  }

  return { isBackend, signals };
}

/**
 * Get a human-readable summary of detection
 */
function getDetectionSummary(detection) {
  const { projectType, frontendRoot, backendRoot, detectionDetails } = detection;

  const summary = {
    type: projectType,
    description: "",
    components: []
  };

  if (projectType === "MONOREPO") {
    summary.description = "Monorepo with separate frontend and backend";
    summary.components.push({
      type: "frontend",
      path: frontendRoot,
      signals: detectionDetails.frontendSignals || []
    });
    summary.components.push({
      type: "backend",
      path: backendRoot,
      signals: detectionDetails.backendSignals || []
    });
  } else if (projectType === "FRONTEND_ONLY") {
    summary.description = "Frontend-only application";
    summary.components.push({
      type: "frontend",
      path: frontendRoot || "(root)",
      signals: detectionDetails.frontendSignals || []
    });
  } else if (projectType === "BACKEND_ONLY") {
    summary.description = "Backend-only application";
    summary.components.push({
      type: "backend",
      path: backendRoot || "(root)",
      signals: detectionDetails.backendSignals || []
    });
  }

  return summary;
}

module.exports = {
  detectProjectStructure,
  detectFrontendSignals,
  detectBackendSignals,
  getDetectionSummary
};
