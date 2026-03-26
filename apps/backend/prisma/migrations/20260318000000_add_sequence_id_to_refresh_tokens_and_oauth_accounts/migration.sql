-- AlterTable
ALTER TABLE "ProjectUserRefreshToken" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserRefreshToken_sequenceId_key" ON "ProjectUserRefreshToken"("sequenceId");

-- CreateIndex
CREATE INDEX "ProjectUserRefreshToken_shouldUpdateSequenceId_idx" ON "ProjectUserRefreshToken"("shouldUpdateSequenceId", "tenancyId");

-- CreateIndex
CREATE INDEX "ProjectUserRefreshToken_tenancyId_sequenceId_idx" ON "ProjectUserRefreshToken"("tenancyId", "sequenceId");

-- AlterTable
ALTER TABLE "ProjectUserOAuthAccount" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUserOAuthAccount_sequenceId_key" ON "ProjectUserOAuthAccount"("sequenceId");

-- CreateIndex
CREATE INDEX "ProjectUserOAuthAccount_shouldUpdateSequenceId_idx" ON "ProjectUserOAuthAccount"("shouldUpdateSequenceId", "tenancyId");

-- CreateIndex
CREATE INDEX "ProjectUserOAuthAccount_tenancyId_sequenceId_idx" ON "ProjectUserOAuthAccount"("tenancyId", "sequenceId");
