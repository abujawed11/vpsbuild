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
