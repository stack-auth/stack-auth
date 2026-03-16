-- AlterTable
ALTER TABLE "Team" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "Team_sequenceId_key" ON "Team"("sequenceId");

-- CreateIndex
CREATE INDEX "Team_tenancyId_sequenceId_idx" ON "Team"("tenancyId", "sequenceId");

-- CreateIndex
CREATE INDEX "Team_shouldUpdateSequenceId_idx" ON "Team"("shouldUpdateSequenceId", "tenancyId");

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_sequenceId_key" ON "TeamMember"("sequenceId");

-- CreateIndex
CREATE INDEX "TeamMember_tenancyId_sequenceId_idx" ON "TeamMember"("tenancyId", "sequenceId");

-- CreateIndex
CREATE INDEX "TeamMember_shouldUpdateSequenceId_idx" ON "TeamMember"("shouldUpdateSequenceId", "tenancyId");
