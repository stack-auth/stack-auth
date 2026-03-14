-- Risk score columns
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreBot" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreFreeTrialAbuse" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUser" ALTER COLUMN "signUpRiskScoreBot" DROP DEFAULT;
ALTER TABLE "ProjectUser" ALTER COLUMN "signUpRiskScoreFreeTrialAbuse" DROP DEFAULT;

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

-- Indexes
CREATE INDEX "ProjectUser_signedUpAt_asc"
  ON "ProjectUser"("tenancyId", "signedUpAt" ASC);

CREATE INDEX "ProjectUser_signedUpAt_desc"
  ON "ProjectUser"("tenancyId", "signedUpAt" DESC);

CREATE INDEX "ProjectUser_signUpIp_recent_idx"
  ON "ProjectUser"("tenancyId", "signUpIp", "signedUpAt");

CREATE INDEX "ProjectUser_signUpEmailBase_recent_idx"
  ON "ProjectUser"("tenancyId", "signUpEmailBase", "signedUpAt");
