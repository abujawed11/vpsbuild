FROM node:20-bullseye

# Install system dependencies for builds (Git, Python, Make, GCC)
RUN apt-get update && apt-get install -y git python3 make g++

# Install Docker CLI and Docker Compose (for container management)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin docker-buildx-plugin \
    && rm -rf /var/lib/apt/lists/*

# Create symlink for backwards compatibility (docker-compose -> docker compose)
RUN echo '#!/bin/sh\nexec docker compose "$@"' > /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

# Install global package managers
RUN npm install -g pnpm yarn --force

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install deps and generate Prisma client
RUN npm install
RUN npx prisma generate

# Copy source code
COPY . .

EXPOSE 5000
CMD ["npm", "start"]
