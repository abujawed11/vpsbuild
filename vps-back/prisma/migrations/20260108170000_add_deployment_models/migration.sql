-- CreateEnum for ProjectType
CREATE TYPE "ProjectType" AS ENUM ('MONOREPO', 'FRONTEND_ONLY', 'BACKEND_ONLY');

-- CreateEnum for DeploymentStatus
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'CLONING', 'ANALYZING', 'BUILDING', 'DEPLOYING', 'READY', 'ERROR', 'CANCELLED');

-- CreateEnum for DeploymentType
CREATE TYPE "DeploymentType" AS ENUM ('PRODUCTION', 'PREVIEW');

-- CreateEnum for CloneStatus (converting from TEXT)
CREATE TYPE "CloneStatus" AS ENUM ('PENDING', 'CLONING', 'CLONED', 'FAILED');

-- Drop default before altering type
ALTER TABLE "Project" ALTER COLUMN "cloneStatus" DROP DEFAULT;

-- Convert TEXT column to enum
ALTER TABLE "Project" ALTER COLUMN "cloneStatus" TYPE "CloneStatus" USING (
  CASE "cloneStatus"
    WHEN 'PENDING' THEN 'PENDING'::"CloneStatus"
    WHEN 'CLONED' THEN 'CLONED'::"CloneStatus"
    WHEN 'FAILED' THEN 'FAILED'::"CloneStatus"
    ELSE 'PENDING'::"CloneStatus"
  END
);

-- Add default back
ALTER TABLE "Project" ALTER COLUMN "cloneStatus" SET DEFAULT 'PENDING'::"CloneStatus";

-- AlterTable Project - Rename branch to productionBranch
ALTER TABLE "Project" RENAME COLUMN "branch" TO "productionBranch";

-- AlterTable Project - Add new columns
ALTER TABLE "Project" ADD COLUMN "projectType" "ProjectType" NOT NULL DEFAULT 'MONOREPO';
ALTER TABLE "Project" ADD COLUMN "frontendFramework" TEXT;
ALTER TABLE "Project" ADD COLUMN "frontendBuildCmd" TEXT;
ALTER TABLE "Project" ADD COLUMN "frontendOutputDir" TEXT;
ALTER TABLE "Project" ADD COLUMN "frontendNodeVersion" TEXT DEFAULT '18';
ALTER TABLE "Project" ADD COLUMN "backendRuntime" TEXT;
ALTER TABLE "Project" ADD COLUMN "backendStartCmd" TEXT;
ALTER TABLE "Project" ADD COLUMN "backendPort" INTEGER;
ALTER TABLE "Project" ADD COLUMN "backendPackageManager" TEXT;
ALTER TABLE "Project" ADD COLUMN "autoDeployEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable Project - Drop old columns (keep data temporarily by moving to new columns first)
-- Migrate data before dropping
UPDATE "Project" SET "frontendFramework" = "framework";
UPDATE "Project" SET "frontendBuildCmd" = "buildCommand";
UPDATE "Project" SET "frontendOutputDir" = "outputDir";
UPDATE "Project" SET "backendStartCmd" = "startCommand";
UPDATE "Project" SET "backendPort" = "port";
UPDATE "Project" SET "backendRuntime" = "runtime";
UPDATE "Project" SET "backendPackageManager" = "packageManager";

-- Now drop old columns
ALTER TABLE "Project" DROP COLUMN "analysisStatus";
ALTER TABLE "Project" DROP COLUMN "buildCommand";
ALTER TABLE "Project" DROP COLUMN "deployType";
ALTER TABLE "Project" DROP COLUMN "deploymentStatus";
ALTER TABLE "Project" DROP COLUMN "dockerfileBackendSource";
ALTER TABLE "Project" DROP COLUMN "dockerfileFrontendContent";
ALTER TABLE "Project" DROP COLUMN "dockerfileFrontendSource";
ALTER TABLE "Project" DROP COLUMN "dockerfileGenerated";
ALTER TABLE "Project" DROP COLUMN "dockerfileBackendContent";
ALTER TABLE "Project" DROP COLUMN "framework";
ALTER TABLE "Project" DROP COLUMN "generatorVersion";
ALTER TABLE "Project" DROP COLUMN "outputDir";
ALTER TABLE "Project" DROP COLUMN "packageManager";
ALTER TABLE "Project" DROP COLUMN "port";
ALTER TABLE "Project" DROP COLUMN "runtime";
ALTER TABLE "Project" DROP COLUMN "startCommand";

-- DropEnum - Remove old enums
DROP TYPE "DeployType";
DROP TYPE "DockerfileSource";

-- CreateTable Deployment
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "commitHash" TEXT NOT NULL,
    "commitMessage" TEXT,
    "branch" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "url" TEXT,
    "buildStarted" TIMESTAMP(3),
    "buildFinished" TIMESTAMP(3),
    "buildDuration" INTEGER,
    "buildLogs" TEXT,
    "deployedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "deploymentType" "DeploymentType" NOT NULL DEFAULT 'PREVIEW',
    "dockerfileBackendContent" TEXT,
    "dockerfileFrontendContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable BranchConfig
CREATE TABLE "BranchConfig" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "autoDeployEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isProduction" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable EnvVariable
CREATE TABLE "EnvVariable" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvVariable_pkey" PRIMARY KEY ("id")
);

-- CreateTable Domain
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchConfig_projectId_branchName_key" ON "BranchConfig"("projectId", "branchName");

-- CreateIndex
CREATE UNIQUE INDEX "EnvVariable_projectId_key_key" ON "EnvVariable"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_domain_key" ON "Domain"("domain");

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchConfig" ADD CONSTRAINT "BranchConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvVariable" ADD CONSTRAINT "EnvVariable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
