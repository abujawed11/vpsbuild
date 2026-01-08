-- CreateEnum
CREATE TYPE "DeployType" AS ENUM ('BACKEND', 'FRONTEND', 'FULLSTACK');

-- CreateEnum
CREATE TYPE "DockerfileSource" AS ENUM ('GENERATED', 'USER_EDITED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deployType" "DeployType" NOT NULL DEFAULT 'BACKEND',
ADD COLUMN     "dockerfileBackendContent" TEXT,
ADD COLUMN     "dockerfileBackendSource" "DockerfileSource" NOT NULL DEFAULT 'GENERATED',
ADD COLUMN     "dockerfileFrontendContent" TEXT,
ADD COLUMN     "dockerfileFrontendSource" "DockerfileSource" NOT NULL DEFAULT 'GENERATED',
ADD COLUMN     "generatorVersion" TEXT;
