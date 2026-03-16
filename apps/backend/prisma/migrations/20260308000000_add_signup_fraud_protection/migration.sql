-- Risk score columns
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreBot" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreFreeTrialAbuse" SMALLINT NOT NULL DEFAULT 0;

-- Country code
ALTER TABLE "ProjectUser" ADD COLUMN "signUpCountryCode" TEXT;

-- Sign-up heuristic facts
ALTER TABLE "ProjectUser"
  ADD COLUMN "signedUpAt" TIMESTAMP(3),
  ADD COLUMN "signUpIp" TEXT,
  ADD COLUMN "signUpIpTrusted" BOOLEAN,
  ADD COLUMN "signUpEmailNormalized" TEXT,
  ADD COLUMN "signUpEmailBase" TEXT;

-- Backfill signedUpAt from createdAt
UPDATE "ProjectUser"
SET "signedUpAt" = "createdAt"
WHERE "signedUpAt" IS NULL;

ALTER TABLE "ProjectUser" ALTER COLUMN "signedUpAt" SET NOT NULL;

