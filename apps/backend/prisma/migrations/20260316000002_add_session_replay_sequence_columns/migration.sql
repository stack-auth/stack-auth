-- AlterTable
ALTER TABLE "SessionReplay" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "SessionReplay_sequenceId_key" ON "SessionReplay"("sequenceId");

-- CreateIndex
CREATE INDEX "SessionReplay_tenancyId_sequenceId_idx" ON "SessionReplay"("tenancyId", "sequenceId");

-- CreateIndex
CREATE INDEX "SessionReplay_shouldUpdateSequenceId_idx" ON "SessionReplay"("shouldUpdateSequenceId", "tenancyId");
