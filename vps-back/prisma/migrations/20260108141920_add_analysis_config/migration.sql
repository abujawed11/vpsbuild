-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "analysisStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "buildCommand" TEXT,
ADD COLUMN     "outputDir" TEXT,
ADD COLUMN     "packageManager" TEXT,
ADD COLUMN     "port" INTEGER DEFAULT 3000,
ADD COLUMN     "runtime" TEXT,
ADD COLUMN     "startCommand" TEXT;
