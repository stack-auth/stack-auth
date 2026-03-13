-- AlterTable: add columns with a temporary default for existing rows, then drop the default
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreBot" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreFreeTrialAbuse" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUser" ALTER COLUMN "signUpRiskScoreBot" DROP DEFAULT;
ALTER TABLE "ProjectUser" ALTER COLUMN "signUpRiskScoreFreeTrialAbuse" DROP DEFAULT;
