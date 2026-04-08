-- AlterTable
ALTER TABLE "SessionReplay" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;
