-- DropForeignKey
ALTER TABLE "ProjectUser" DROP CONSTRAINT "ProjectUser_mirroredProjectId_fkey";

-- AlterTable
ALTER TABLE "ProjectUser" ADD COLUMN     "projectId" TEXT;

-- AddForeignKey
ALTER TABLE "ProjectUser" ADD CONSTRAINT "ProjectUser_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "VerificationCode" DROP CONSTRAINT "VerificationCode_projectId_fkey";

-- AlterTable
ALTER TABLE "VerificationCode" DROP CONSTRAINT "VerificationCode_pkey";

-- DropForeignKey
ALTER TABLE "ProjectApiKey" DROP CONSTRAINT "ProjectApiKey_projectId_fkey";

-- AlterTable
ALTER TABLE "ProjectApiKey" ALTER COLUMN "projectId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ProjectApiKey" ADD CONSTRAINT "ProjectApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "ProjectApiKey" DROP CONSTRAINT "ProjectApiKey_projectId_fkey";

-- AlterTable
ALTER TABLE "ProjectApiKey" DROP COLUMN "projectId";

-- AlterTable
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("projectId", "branchId", "id");
