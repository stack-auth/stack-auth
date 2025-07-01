-- DropForeignKey
ALTER TABLE "ProjectUser" DROP CONSTRAINT "ProjectUser_mirroredProjectId_fkey";

-- AlterTable
ALTER TABLE "ProjectUser" ADD COLUMN     "projectId" TEXT;

-- AddForeignKey
ALTER TABLE "ProjectUser" ADD CONSTRAINT "ProjectUser_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- DropForeignKey
ALTER TABLE "VerificationCode" DROP CONSTRAINT "VerificationCode_projectId_fkey";

-- DropIndex
DROP INDEX "VerificationCode_projectId_branchId_code_key";

-- AlterTable
ALTER TABLE "VerificationCode" DROP CONSTRAINT "VerificationCode_pkey";

-- AlterTable
ALTER TABLE "VerificationCode" RENAME COLUMN "projectId" TO "mirroredProjectId";

-- AlterTable
ALTER TABLE "VerificationCode" ADD COLUMN "projectId" TEXT;

-- AlterTable
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("mirroredProjectId", "branchId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCode_mirroredProjectId_branchId_code_key" ON "VerificationCode"("mirroredProjectId", "branchId", "code");

-- AlterTable
ALTER TABLE "VerificationCode" DROP COLUMN "projectId";

-- DropForeignKey
ALTER TABLE "ProjectApiKey" DROP CONSTRAINT "ProjectApiKey_projectId_fkey";

-- AlterTable
ALTER TABLE "ProjectApiKey" ALTER COLUMN "projectId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ProjectApiKey" ADD CONSTRAINT "ProjectApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
