-- AlterTable
ALTER TABLE "ProjectUserRefreshToken" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ProjectUserOAuthAccount" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;
