-- AlterTable
ALTER TABLE "ProjectUserDirectPermission" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserDirectPermission_sequenceId_key" ON "ProjectUserDirectPermission"("sequenceId");

-- CreateIndex
CREATE INDEX "ProjectUserDirectPermission_shouldUpdateSequenceId_idx" ON "ProjectUserDirectPermission"("shouldUpdateSequenceId", "tenancyId");

-- CreateIndex
CREATE INDEX "ProjectUserDirectPermission_tenancyId_sequenceId_idx" ON "ProjectUserDirectPermission"("tenancyId", "sequenceId");

-- AlterTable
ALTER TABLE "UserNotificationPreference" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationPreference_sequenceId_key" ON "UserNotificationPreference"("sequenceId");

-- CreateIndex
CREATE INDEX "UserNotificationPreference_shouldUpdateSequenceId_idx" ON "UserNotificationPreference"("shouldUpdateSequenceId", "tenancyId");

-- CreateIndex
CREATE INDEX "UserNotificationPreference_tenancyId_sequenceId_idx" ON "UserNotificationPreference"("tenancyId", "sequenceId");
