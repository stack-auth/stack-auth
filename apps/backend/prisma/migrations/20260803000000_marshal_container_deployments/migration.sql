/*
  Deployments move from Vercel to Marshal (the Fly.io-backed container
  runtime). No data migration: there are no backwards-compatible deployments
  projects, and upload rows are ephemeral (cleared below so the new reference
  column can be NOT NULL).

  Warnings:

  - You are about to drop the column `buildCommand` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `framework` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `installCommand` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `outputDirectory` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `vercelProjectId` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `vercelDeploymentId` on the `DeploymentRun` table. All the data in the column will be lost.
  - You are about to drop the column `vercelDeploymentUrl` on the `DeploymentRun` table. All the data in the column will be lost.
  - You are about to drop the column `objectKey` on the `DeploymentSourceUpload` table. All the data in the column will be lost.
*/

-- AlterTable
ALTER TABLE "DeploymentService" DROP COLUMN "buildCommand",
DROP COLUMN "framework",
DROP COLUMN "installCommand",
DROP COLUMN "outputDirectory",
DROP COLUMN "vercelProjectId",
ADD COLUMN "maxInstances" INTEGER,
ADD COLUMN "minInstances" INTEGER,
ADD COLUMN "port" INTEGER,
ADD COLUMN "provisionedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DeploymentRun" DROP COLUMN "vercelDeploymentId",
DROP COLUMN "vercelDeploymentUrl",
ADD COLUMN "marshalBuildId" TEXT,
ADD COLUMN "revision" TEXT,
ADD COLUMN "serviceUrl" TEXT;

-- Upload slots are short-lived references; clearing them lets marshalUploadId
-- be NOT NULL without a default.
DELETE FROM "DeploymentSourceUpload";

-- AlterTable
ALTER TABLE "DeploymentSourceUpload" DROP COLUMN "objectKey",
ADD COLUMN "marshalUploadId" TEXT NOT NULL;
