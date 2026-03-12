-- Risk score columns (NOT NULL with temporary default for backfill, then drop default)
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreBot" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreFreeTrialAbuse" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUser" ALTER COLUMN "signUpRiskScoreBot" DROP DEFAULT;
ALTER TABLE "ProjectUser" ALTER COLUMN "signUpRiskScoreFreeTrialAbuse" DROP DEFAULT;

-- Country code
ALTER TABLE "ProjectUser" ADD COLUMN "countryCode" TEXT;

-- Sign-up heuristic facts
ALTER TABLE "ProjectUser"
  ADD COLUMN "signUpAt" TIMESTAMP(3),
  ADD COLUMN "signUpIp" TEXT,
  ADD COLUMN "signUpIpTrusted" BOOLEAN,
  ADD COLUMN "signUpEmailNormalized" TEXT,
  ADD COLUMN "signUpEmailBase" TEXT;

-- Backfill signUpAt from createdAt, then enforce NOT NULL
UPDATE "ProjectUser"
SET "signUpAt" = "createdAt"
WHERE "signUpAt" IS NULL;

ALTER TABLE "ProjectUser" ALTER COLUMN "signUpAt" SET NOT NULL;

-- Indexes for pagination and risk-score lookups
CREATE INDEX "ProjectUser_signUpAt_asc"
  ON "ProjectUser"("tenancyId", "signUpAt" ASC);

CREATE INDEX "ProjectUser_signUpAt_desc"
  ON "ProjectUser"("tenancyId", "signUpAt" DESC);

CREATE INDEX "ProjectUser_signUpIp_recent_idx"
  ON "ProjectUser"("tenancyId", "signUpIp", "signUpAt");

CREATE INDEX "ProjectUser_signUpEmailBase_recent_idx"
  ON "ProjectUser"("tenancyId", "signUpEmailBase", "signUpAt");
