const fs = require("fs");
const path = require("path");

function generateNodeDockerfile(config) {
  const { packageManager, port, startCommand } = config;

  let installCmd = "npm ci --only=production";
  let copyFiles = "COPY package*.json ./";
  
  if (packageManager === "yarn") {
    installCmd = "yarn install --production --frozen-lockfile";
    copyFiles = "COPY package.json yarn.lock ./";
  } else if (packageManager === "pnpm") {
    installCmd = "npm install -g pnpm && pnpm install --prod --frozen-lockfile";
    copyFiles = "COPY package.json pnpm-lock.yaml ./";
  } else {
    // Fallback for npm if no lockfile might mean just install
    installCmd = "npm install --production"; 
  }

  // Split start command for CMD array format to handle signals better?
  // For now string format is fine: CMD npm start
  // Actually, exec form ["npm", "start"] is better but string is safer for complex commands.
  
  return `FROM node:18-alpine

WORKDIR /app

# Install dependencies
${copyFiles}
RUN ${installCmd}

# Copy source
COPY . .

# Environment
ENV PORT=${port}
ENV NODE_ENV=production

EXPOSE ${port}

# Start
CMD ${startCommand}
`;
}

function generatePythonDockerfile(config) {
  const { port, startCommand } = config;
  
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
CMD ${startCommand}
`;
}

function generateStaticDockerfile(config) {
  return `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
}

async function createDockerfile(project, targetDir) {
  let content = "";

  if (project.runtime === "node") {
    content = generateNodeDockerfile(project);
  } else if (project.runtime === "python") {
    content = generatePythonDockerfile(project);
  } else if (project.runtime === "static") {
    content = generateStaticDockerfile(project);
  } else {
    throw new Error(`Unsupported runtime: ${project.runtime}`);
  }

  const dockerfilePath = path.join(targetDir, "Dockerfile");
  const dockerIgnorePath = path.join(targetDir, ".dockerignore");

  await fs.promises.writeFile(dockerfilePath, content);
  
  // Create .dockerignore if not exists
  if (!fs.existsSync(dockerIgnorePath)) {
    const ignoreContent = "node_modules\n.git\n.env\ndist\nbuild\ncoverage\n";
    await fs.promises.writeFile(dockerIgnorePath, ignoreContent);
  }

  return content;
}

module.exports = { createDockerfile };
