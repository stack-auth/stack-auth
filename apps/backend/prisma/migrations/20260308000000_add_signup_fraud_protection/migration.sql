-- Risk score columns
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreBot" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "ProjectUser" ADD COLUMN "signUpRiskScoreFreeTrialAbuse" SMALLINT NOT NULL DEFAULT 0;

-- CHECK constraints for risk scores (NOT VALID to avoid full table scan).
-- Validated in a separate migration.
ALTER TABLE "ProjectUser"
  ADD CONSTRAINT "ProjectUser_risk_score_bot_range"
  CHECK ("signUpRiskScoreBot" >= 0 AND "signUpRiskScoreBot" <= 100) NOT VALID;

ALTER TABLE "ProjectUser"
  ADD CONSTRAINT "ProjectUser_risk_score_free_trial_abuse_range"
  CHECK ("signUpRiskScoreFreeTrialAbuse" >= 0 AND "signUpRiskScoreFreeTrialAbuse" <= 100) NOT VALID;

-- Country code
ALTER TABLE "ProjectUser" ADD COLUMN "signUpCountryCode" TEXT;

-- Sign-up heuristic facts
ALTER TABLE "ProjectUser"
  ADD COLUMN "signedUpAt" TIMESTAMP(3),
  ADD COLUMN "signUpIp" TEXT,
  ADD COLUMN "signUpIpTrusted" BOOLEAN,
  ADD COLUMN "signUpEmailNormalized" TEXT,
  ADD COLUMN "signUpEmailBase" TEXT;

-- NOT NULL check for signedUpAt (NOT VALID to avoid full table scan now;
-- backfilled in migration 000001, validated + enforced in migration 000003).
ALTER TABLE "ProjectUser"
  ADD CONSTRAINT "ProjectUser_signedUpAt_not_null"
  CHECK ("signedUpAt" IS NOT NULL) NOT VALID;
