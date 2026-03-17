-- AlterTable
ALTER TABLE "TeamMemberDirectPermission" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "TeamMemberDirectPermission_sequenceId_key" ON "TeamMemberDirectPermission"("sequenceId");

-- CreateIndex
CREATE INDEX "TeamMemberDirectPermission_shouldUpdateSequenceId_idx" ON "TeamMemberDirectPermission"("shouldUpdateSequenceId", "tenancyId");

-- CreateIndex
CREATE INDEX "TeamMemberDirectPermission_tenancyId_sequenceId_idx" ON "TeamMemberDirectPermission"("tenancyId", "sequenceId");

-- AlterTable
ALTER TABLE "VerificationCode" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCode_sequenceId_key" ON "VerificationCode"("sequenceId");

-- CreateIndex
CREATE INDEX "VerificationCode_shouldUpdateSequenceId_type_idx" ON "VerificationCode"("shouldUpdateSequenceId", "type");
