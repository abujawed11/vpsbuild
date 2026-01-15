-- Managed Databases: compatibility fix for installs that already have a "Database" table (e.g. via prisma db push)

-- Ensure ERROR status exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DatabaseStatus') THEN
    BEGIN
      ALTER TYPE "DatabaseStatus" ADD VALUE IF NOT EXISTS 'ERROR';
    EXCEPTION WHEN undefined_object THEN
      -- ignore
    END;
  END IF;
END $$;

-- Add provisioning/diagnostics columns if missing (idempotent)
ALTER TABLE IF EXISTS "Database" ADD COLUMN IF NOT EXISTS "linkedProjectId" TEXT;
ALTER TABLE IF EXISTS "Database" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE IF EXISTS "Database" ADD COLUMN IF NOT EXISTS "lastProvisionLog" TEXT;
ALTER TABLE IF EXISTS "Database" ADD COLUMN IF NOT EXISTS "provisioningLog" JSONB;

-- Indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "Database_linkedProjectId_key" ON "Database"("linkedProjectId");
CREATE INDEX IF NOT EXISTS "Database_linkedProjectId_idx" ON "Database"("linkedProjectId");

-- Ensure Project.databaseId exists and FK is present (idempotent)
ALTER TABLE IF EXISTS "Project" ADD COLUMN IF NOT EXISTS "databaseId" TEXT;
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

