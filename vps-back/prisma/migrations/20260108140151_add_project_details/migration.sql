/*
  Warnings:

  - Added the required column `repoFullName` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "branch" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN     "deploymentStatus" TEXT NOT NULL DEFAULT 'IDLE',
ADD COLUMN     "framework" TEXT,
ADD COLUMN     "repoFullName" TEXT NOT NULL;
