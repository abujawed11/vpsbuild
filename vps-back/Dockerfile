FROM node:20-bullseye

RUN apt-get update && apt-get install -y git python3 make g++ sqlite3

RUN apt-get update && apt-get install -y \
    ca-certificates curl gnupg lsb-release \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin docker-buildx-plugin \
    && rm -rf /var/lib/apt/lists/*

RUN echo '#!/bin/sh\nexec docker compose "$@"' > /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

RUN npm install -g pnpm yarn --force

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY . .

EXPOSE 5000

# Run prisma db push on startup (applies schema changes), then start app
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
