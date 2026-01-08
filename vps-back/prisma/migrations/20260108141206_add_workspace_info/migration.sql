-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "cloneStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "workspacePath" TEXT;
