-- AlterTable
ALTER TABLE "ProjectUserDirectPermission" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "UserNotificationPreference" ADD COLUMN "sequenceId" BIGINT,
ADD COLUMN "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true;
