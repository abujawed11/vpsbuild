FROM node:20-bullseye

# Install system dependencies for builds (Git, Python, Make, GCC)
RUN apt-get update && apt-get install -y git python3 make g++

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
