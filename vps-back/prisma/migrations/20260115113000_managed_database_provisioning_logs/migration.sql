-- Managed Databases: base table + provisioning logs + diagnostics + denormalized link

-- Ensure enums exist (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DatabaseType') THEN
    CREATE TYPE "DatabaseType" AS ENUM ('MYSQL', 'POSTGRES', 'MONGODB');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DatabaseStatus') THEN
    CREATE TYPE "DatabaseStatus" AS ENUM ('CREATING', 'RUNNING', 'STOPPED', 'ERROR', 'FAILED', 'DELETING');
  ELSE
    -- Add ERROR status (keep FAILED for legacy)
    BEGIN
      ALTER TYPE "DatabaseStatus" ADD VALUE IF NOT EXISTS 'ERROR';
    EXCEPTION WHEN undefined_object THEN
      -- ignore
    END;
  END IF;
END $$;

-- Create Database table if missing (idempotent)
CREATE TABLE IF NOT EXISTS "Database" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,

  "containerName" TEXT NOT NULL,
  "type" "DatabaseType" NOT NULL,
  "version" TEXT NOT NULL DEFAULT '8',

  "dbName" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "rootPassword" TEXT NOT NULL,

  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL,

  "status" "DatabaseStatus" NOT NULL DEFAULT 'CREATING',
  "volumeName" TEXT NOT NULL,
  "diskUsageMB" INTEGER NOT NULL DEFAULT 0,

  "linkedProjectId" TEXT,
  "lastError" TEXT,
  "lastProvisionLog" TEXT,
  "provisioningLog" JSONB,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Database_pkey" PRIMARY KEY ("id")
);

-- Constraints/indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "Database_containerName_key" ON "Database"("containerName");
CREATE UNIQUE INDEX IF NOT EXISTS "Database_userId_name_key" ON "Database"("userId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "Database_linkedProjectId_key" ON "Database"("linkedProjectId");
CREATE INDEX IF NOT EXISTS "Database_userId_idx" ON "Database"("userId");
CREATE INDEX IF NOT EXISTS "Database_status_idx" ON "Database"("status");
CREATE INDEX IF NOT EXISTS "Database_linkedProjectId_idx" ON "Database"("linkedProjectId");

-- FKs (idempotent)
DO $$
BEGIN
  BEGIN
    ALTER TABLE "Database"
      ADD CONSTRAINT "Database_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    -- already exists
  END;
END $$;

-- Project <-> Database link (idempotent)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "databaseId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Project_databaseId_key" ON "Project"("databaseId");
DO $$
BEGIN
  BEGIN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_databaseId_fkey"
      FOREIGN KEY ("databaseId") REFERENCES "Database"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    -- already exists
  END;
END $$;
