-- AlterTable
ALTER TABLE "ProjectConfig" ADD COLUMN     "allowTeamAPIKeys" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowTenancyAPIKeys" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allowUserAPIKeys" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Group" (
    "projectId" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "tenancyId" UUID,
    "teamId" UUID,
    "projectUserId" UUID,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("projectId","id")
);

-- CreateTable
CREATE TABLE "GroupAPIKey" (
    "projectId" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "secretApiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "manuallyRevokedAt" TIMESTAMP(3),
    "description" TEXT,
    "groupId" UUID NOT NULL,

    CONSTRAINT "GroupAPIKey_pkey" PRIMARY KEY ("projectId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupAPIKey_secretApiKey_key" ON "GroupAPIKey"("secretApiKey");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAPIKey_projectId_groupId_key" ON "GroupAPIKey"("projectId", "groupId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_tenancyId_projectUserId_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_tenancyId_teamId_fkey" FOREIGN KEY ("tenancyId", "teamId") REFERENCES "Team"("tenancyId", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAPIKey" ADD CONSTRAINT "GroupAPIKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAPIKey" ADD CONSTRAINT "GroupAPIKey_projectId_groupId_fkey" FOREIGN KEY ("projectId", "groupId") REFERENCES "Group"("projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
