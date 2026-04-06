-- AlterTable
ALTER TABLE "Team" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;
