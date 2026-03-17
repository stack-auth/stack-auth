-- AlterTable
ALTER TABLE "ProjectApiKey" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectApiKey_sequenceId_key" ON "ProjectApiKey"("sequenceId");

-- CreateIndex
CREATE INDEX "ProjectApiKey_tenancyId_sequenceId_idx" ON "ProjectApiKey"("tenancyId", "sequenceId");

-- CreateIndex
CREATE INDEX "ProjectApiKey_shouldUpdateSequenceId_idx" ON "ProjectApiKey"("shouldUpdateSequenceId", "tenancyId");
