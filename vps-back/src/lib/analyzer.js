const fs = require("fs");
const path = require("path");

/**
 * Detect if a command uses development tools
 */
function detectDevTools(command) {
  if (!command) return null;

  const devTools = [
    { name: "nodemon", pattern: /nodemon/i },
    { name: "ts-node-dev", pattern: /ts-node-dev/i },
    { name: "tsx --watch", pattern: /tsx\s+--watch/i },
    { name: "vite", pattern: /vite(?!\s+build)/i }, // vite but not "vite build"
    { name: "watch mode", pattern: /--watch\b/i }
  ];

  for (const tool of devTools) {
    if (tool.pattern.test(command)) {
      return tool.name;
    }
  }

  return null;
}

/**
 * Generate production-safe alternative for start command
 */
function generateProductionCommand(devCommand, packageJsonScripts) {
  if (!devCommand) return null;

  // If it's a script reference like "npm run dev", check if "start" exists
  const npmRunMatch = devCommand.match(/(?:npm|yarn|pnpm)\s+(?:run\s+)?(\w+)/);
  if (npmRunMatch && packageJsonScripts.start) {
    return {
      command: devCommand.replace(npmRunMatch[1], 'start'),
      reason: `Using 'start' script instead of '${npmRunMatch[1]}'`
    };
  }

  // Replace nodemon with node
  if (/nodemon/i.test(devCommand)) {
    return {
      command: devCommand.replace(/nodemon/gi, 'node'),
      reason: "Replaced 'nodemon' with 'node' for production"
    };
  }

  // Replace ts-node-dev with ts-node
  if (/ts-node-dev/i.test(devCommand)) {
    return {
      command: devCommand.replace(/ts-node-dev/gi, 'ts-node'),
      reason: "Replaced 'ts-node-dev' with 'ts-node' for production"
    };
  }

  // Remove --watch flags
  if (/--watch\b/i.test(devCommand)) {
    return {
      command: devCommand.replace(/\s*--watch\b/gi, ''),
      reason: "Removed '--watch' flag for production"
    };
  }

  return null;
}

/**
 * Resolve npm run script to actual command
 */
function resolveNpmScript(scriptName, packageJsonScripts) {
  if (!packageJsonScripts || !scriptName) return null;
  return packageJsonScripts[scriptName] || null;
}

async function analyzeWorkspace(basePath, relativePath = "") {
  const targetPath = path.join(basePath, relativePath);
  
  const config = {
    runtime: "unknown",
    framework: "unknown",
    packageManager: "npm",
    buildCommand: "",
    startCommand: "",
    outputDir: "",
    port: 3000,
    warnings: [], // Array to store detection warnings
    hasPrisma: false // Prisma detection flag
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

    // Detect Prisma
    const schemaPath = path.join(targetPath, "prisma", "schema.prisma");
    if (fs.existsSync(schemaPath) || deps["@prisma/client"] || deps["prisma"]) {
      config.hasPrisma = true;
      config.warnings.push({
        type: "PRISMA_DETECTED",
        message: "Prisma detected - Prisma Client will be generated automatically during deployment"
      });
    }

    // Auto-detect start command for backend projects
    // Check if this is a backend project (has Express, Fastify, etc.)
    const isBackend = deps["express"] || deps["fastify"] || deps["koa"] || deps["@nestjs/core"];

    if (isBackend && scripts.start) {
      config.startCommand = getBuildCmd("start");

      // Resolve and check the start script for dev tools
      const actualStartCommand = resolveNpmScript("start", scripts);
      if (actualStartCommand) {
        const devTool = detectDevTools(actualStartCommand);
        if (devTool) {
          config.warnings.push({
            type: "DEV_TOOL_IN_START",
            message: `Start script uses development tool '${devTool}'`,
            detectedCommand: actualStartCommand
          });

          // Try to generate production alternative
          const prodAlt = generateProductionCommand(actualStartCommand, scripts);
          if (prodAlt) {
            config.warnings.push({
              type: "AUTO_FIX_SUGGESTION",
              message: prodAlt.reason,
              suggestedCommand: prodAlt.command
            });

            // Auto-fix: Update the start command suggestion
            config.startCommand = prodAlt.command;
            config.startCommandAutoFixed = true;
          }
        }
      }
    } else if (isBackend && scripts.dev) {
      // If no start script but has dev script, check it
      const actualDevCommand = resolveNpmScript("dev", scripts);
      if (actualDevCommand) {
        const devTool = detectDevTools(actualDevCommand);
        if (devTool) {
          // Generate production command from dev script
          const prodAlt = generateProductionCommand(actualDevCommand, scripts);
          if (prodAlt) {
            config.startCommand = prodAlt.command;
            config.warnings.push({
              type: "DEV_SCRIPT_DETECTED",
              message: `Auto-converted 'dev' script for production: ${prodAlt.reason}`,
              originalCommand: actualDevCommand,
              fixedCommand: prodAlt.command
            });
          } else {
            // Fallback: suggest creating a start script
            config.warnings.push({
              type: "NO_START_SCRIPT",
              message: "No 'start' script found. Please add a production-ready start script to package.json",
              detectedDevCommand: actualDevCommand
            });
          }
        }
      }
    }

    return config;
  }

  // 2. Check for Python
  if (hasFile("requirements.txt") || hasFile("Pipfile") || hasFile("pyproject.toml") || hasFile("app.py") || hasFile("main.py") || hasFile("manage.py")) {
      config.runtime = "python";
      config.packageManager = "pip";
      config.framework = "python-generic"; // default
      config.port = 5000;
      
      // Install Command
      let requirementsContent = "";
      if (hasFile("Pipfile")) {
          config.packageManager = "pipenv";
          config.installCommand = "pipenv install --deploy --ignore-pipfile";
          config.buildCommand = config.installCommand;
      } else if (hasFile("pyproject.toml")) {
          config.packageManager = "poetry";
          config.installCommand = "poetry install --no-dev";
          config.buildCommand = config.installCommand;
      } else {
          config.installCommand = "pip install -r requirements.txt";
          config.buildCommand = config.installCommand;
          // Try to read requirements for framework detection
          if (hasFile("requirements.txt")) {
              try {
                  requirementsContent = await fs.promises.readFile(path.join(targetPath, "requirements.txt"), "utf8");
              } catch (e) {}
          }
      }

      // Framework Detection & Start Command Defaults
      const isDjango = hasFile("manage.py") || requirementsContent.includes("django");
      const isFastApi = requirementsContent.includes("fastapi");
      const isFlask = requirementsContent.includes("flask") || hasFile("app.py");

      if (isDjango) {
          config.framework = "django";
          config.port = 8000;
          config.startCommand = "python manage.py runserver 0.0.0.0:8000"; 
          // Note: In prod, users should ideally use gunicorn, but this works out of box
      } else if (isFastApi) {
          config.framework = "fastapi";
          config.port = 8000;
          // Guess entry point: main:app or app:app
          if (hasFile("main.py")) config.startCommand = "uvicorn main:app --host 0.0.0.0 --port 8000";
          else config.startCommand = "uvicorn app:app --host 0.0.0.0 --port 8000";
      } else {
          // Flask or Generic
          config.framework = "flask"; // assumption
          if (hasFile("app.py")) config.startCommand = "python app.py";
          else if (hasFile("main.py")) config.startCommand = "python main.py";
          else config.startCommand = "python app.py";
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
