-- AlterEnum
ALTER TYPE "TeamSystemPermission" ADD VALUE 'MANAGE_API_KEYS';

-- AlterTable
ALTER TABLE "ProjectConfig" ADD COLUMN     "allowTeamAPIKeys" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowTenancyAPIKeys" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowUserAPIKeys" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProjectAPIKey" (
    "projectId" TEXT NOT NULL,
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "secretApiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "manuallyRevokedAt" TIMESTAMP(3),
    "description" TEXT,
    "teamId" UUID,
    "projectUserId" UUID,

    CONSTRAINT "ProjectAPIKey_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAPIKey_secretApiKey_key" ON "ProjectAPIKey"("secretApiKey");

-- AddForeignKey
ALTER TABLE "ProjectAPIKey" ADD CONSTRAINT "ProjectAPIKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAPIKey" ADD CONSTRAINT "ProjectAPIKey_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAPIKey" ADD CONSTRAINT "ProjectAPIKey_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAPIKey" ADD CONSTRAINT "ProjectAPIKey_tenancyId_teamId_fkey" FOREIGN KEY ("tenancyId", "teamId") REFERENCES "Team"("tenancyId", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;
