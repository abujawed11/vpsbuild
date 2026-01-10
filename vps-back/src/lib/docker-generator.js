const fs = require("fs");
const path = require("path");

function generateNodeBackendDockerfile(config) {
  const { packageManager = "npm", port = 3000, startCommand = "npm start" } = config;

  let installCmd = "npm ci --omit=dev"; // default for npm
  let copyFiles = "COPY package*.json ./";

  if (packageManager === "yarn") {
    installCmd = "yarn install --production --frozen-lockfile";
    copyFiles = "COPY package.json yarn.lock ./";
  } else if (packageManager === "pnpm") {
    installCmd = "npm install -g pnpm && pnpm install --prod --frozen-lockfile";
    copyFiles = "COPY package.json pnpm-lock.yaml ./";
  }

  // Ensure server listens on 0.0.0.0
  const wrappedStart = `export HOST=0.0.0.0 && ${startCommand}`;

  return `FROM node:18-alpine

WORKDIR /app

# Install dependencies
${copyFiles}
RUN ${installCmd}

# Copy source
COPY . .

# Environment
ENV NODE_ENV=production
ENV PORT=${port}
ENV HOST=0.0.0.0

EXPOSE ${port}

# Start (ensure binding to 0.0.0.0)
CMD sh -c "${wrappedStart}"
`;
}

function generatePythonBackendDockerfile(config) {
  const { port = 5000, startCommand = "python app.py" } = config;

  return `FROM python:3.9-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Environment
ENV PORT=${port}

EXPOSE ${port}

# Start
CMD ["sh", "-c", "${startCommand}"]
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
    writeDockerfile 
};
