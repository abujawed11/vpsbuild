const fs = require("fs");
const path = require("path");

/**
 * Detect if project uses Prisma
 * @param {string} projectPath - Path to the project directory
 * @returns {boolean} - True if Prisma is detected
 */
function detectPrisma(projectPath) {
  try {
    // Check for schema.prisma file
    const schemaPath = path.join(projectPath, "prisma", "schema.prisma");
    if (fs.existsSync(schemaPath)) {
      return true;
    }

    // Check for @prisma/client in package.json
    const packageJsonPath = path.join(projectPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      if (deps["@prisma/client"] || deps["prisma"]) {
        return true;
      }
    }

    return false;
  } catch (e) {
    return false;
  }
}

function generateNodeBackendDockerfile(config) {
  const { packageManager = "npm", port = 3000, startCommand = "npm start", hasPrisma = false } = config;

  let installCmd = "npm ci --omit=dev"; // default for npm
  let copyFiles = "COPY package*.json ./";
  let prismaGenerateCmd = "";

  if (packageManager === "yarn") {
    installCmd = "yarn install --production --frozen-lockfile";
    copyFiles = "COPY package.json yarn.lock ./";
  } else if (packageManager === "pnpm") {
    installCmd = "npm install -g pnpm && pnpm install --prod --frozen-lockfile";
    copyFiles = "COPY package.json pnpm-lock.yaml ./";
  }

  // Add Prisma schema copy and generate if Prisma is detected
  let prismaCopy = "";
  let prismaSetup = "";
  if (hasPrisma) {
    prismaCopy = "COPY prisma ./prisma\n";
    // Install OpenSSL for Prisma compatibility on Alpine
    // Generate AFTER copying source code to ensure all files are in place
    prismaSetup = `
# Install OpenSSL for Prisma
RUN apk add --no-cache openssl
RUN npx prisma generate
`;
  }

  // Ensure server listens on 0.0.0.0
  const wrappedStart = `export HOST=0.0.0.0 && ${startCommand}`;

  // If Prisma is detected, try to run migrations and regenerate client before starting
  // Use || true to continue even if migrations fail (DB might be unreachable)
  const startupCmd = hasPrisma
    ? `(npx prisma migrate deploy && npx prisma generate) || echo "Warning: Prisma migrations/generate failed, starting app anyway..."; ${wrappedStart}`
    : wrappedStart;

  return `FROM node:18-alpine

WORKDIR /app

# Install dependencies
${copyFiles}
${prismaCopy}RUN ${installCmd}

# Copy source
COPY . .
${prismaSetup}
# Environment
ENV NODE_ENV=production
ENV PORT=${port}
ENV HOST=0.0.0.0

EXPOSE ${port}

# Start (ensure binding to 0.0.0.0)
CMD sh -c "${startupCmd}"
`;
}

function generatePythonBackendDockerfile(config) {
  const { port = 5000, startCommand = "python app.py", buildCommand } = config;

  // Default install command
  let installCmd = buildCommand || "pip install -r requirements.txt";

  // Try to detect requirements file from command to COPY it
  // Look for "-r filename" or just assume requirements.txt if not found
  let reqFile = "requirements.txt";
  const match = installCmd.match(/-r\s+([^\s]+)/);
  if (match && match[1]) {
      reqFile = match[1];
  } else if (installCmd.includes("Pipfile")) {
      reqFile = "Pipfile Pipfile.lock";
  } else if (installCmd.includes("poetry")) {
      reqFile = "pyproject.toml poetry.lock";
  }

  // Use shell form for CMD to allow variable expansion
  // The start command will be pre-processed to include --host and --port
  return `FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY ${reqFile} ./
RUN ${installCmd}

# Copy source
COPY . .

# Environment
ENV PORT=${port}
ENV PYTHONUNBUFFERED=1

EXPOSE ${port}

# Start (shell form allows variable expansion)
CMD ${startCommand}
`;
}

function generateFrontendDockerfile(config) {
  const { packageManager = "npm", outputDir = "dist", buildCommand } = config;

  let installCmd = "npm ci";
  let copyFiles = "COPY package*.json ./";
  let finalBuildCmd = buildCommand;

  if (packageManager === "yarn") {
    installCmd = "yarn install --frozen-lockfile";
    copyFiles = "COPY package.json yarn.lock ./";
    // Adapt build command if it uses npm
    if (!finalBuildCmd || finalBuildCmd.startsWith("npm")) {
      finalBuildCmd = "yarn build";
    }
  } else if (packageManager === "pnpm") {
    installCmd = "npm install -g pnpm && pnpm install --frozen-lockfile";
    copyFiles = "COPY package.json pnpm-lock.yaml ./";
    // Adapt build command if it uses npm
    if (!finalBuildCmd || finalBuildCmd.startsWith("npm")) {
      finalBuildCmd = "pnpm build";
    }
  } else {
    // Default npm
    if (!finalBuildCmd) {
      finalBuildCmd = "npm run build";
    }
  }

  return `# Stage 1: Build
FROM node:18-alpine as builder
WORKDIR /app

${copyFiles}
RUN ${installCmd}

COPY . .
RUN ${finalBuildCmd}

# Stage 2: Serve
FROM nginx:alpine
COPY --from=builder /app/${outputDir} /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
}

async function writeDockerfile(content, targetDir) {
  if (!fs.existsSync(targetDir)) {
      throw new Error(`Target directory does not exist: ${targetDir}`);
  }

  const dockerfilePath = path.join(targetDir, "Dockerfile");
  const dockerIgnorePath = path.join(targetDir, ".dockerignore");

  await fs.promises.writeFile(dockerfilePath, content);
  
  // Create .dockerignore if not exists
  if (!fs.existsSync(dockerIgnorePath)) {
    const ignoreContent = "node_modules\n.git\n.env\ndist\nbuild\ncoverage\n";
    await fs.promises.writeFile(dockerIgnorePath, ignoreContent);
  }
}

module.exports = {
    generateNodeBackendDockerfile,
    generatePythonBackendDockerfile,
    generateFrontendDockerfile,
    writeDockerfile,
    detectPrisma
};
