-- AlterTable
ALTER TABLE "EmailOutbox" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_sequenceId_key" ON "EmailOutbox"("sequenceId");

-- CreateIndex
CREATE INDEX "EmailOutbox_tenancyId_sequenceId_idx" ON "EmailOutbox"("tenancyId", "sequenceId");

-- CreateIndex
CREATE INDEX "EmailOutbox_shouldUpdateSequenceId_idx" ON "EmailOutbox"("shouldUpdateSequenceId", "tenancyId");
