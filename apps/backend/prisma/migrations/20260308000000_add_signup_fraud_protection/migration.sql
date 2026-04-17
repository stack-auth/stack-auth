-- Add the sign-up metadata columns first.
-- `signedUpAt` starts nullable so we can backfill existing rows before enforcing it.
ALTER TABLE "ProjectUser"
  ADD COLUMN "signUpRiskScoreBot" SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN "signUpRiskScoreFreeTrialAbuse" SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN "signUpCountryCode" TEXT,
  ADD COLUMN "signedUpAt" TIMESTAMP(3),
  ADD COLUMN "signUpIp" TEXT,
  ADD COLUMN "signUpIpTrusted" BOOLEAN,
  ADD COLUMN "signUpEmailNormalized" TEXT,
  ADD COLUMN "signUpEmailBase" TEXT;

-- Backward compatibility during rollout: old backends omit `signedUpAt` on
-- INSERT, so set a default immediately in the first migration.
ALTER TABLE "ProjectUser" ALTER COLUMN "signedUpAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Add the risk score bounds without validating existing rows yet.
ALTER TABLE "ProjectUser"
  ADD CONSTRAINT "ProjectUser_risk_score_bot_range"
    CHECK ("signUpRiskScoreBot" >= 0 AND "signUpRiskScoreBot" <= 100) NOT VALID,
  ADD CONSTRAINT "ProjectUser_risk_score_free_trial_abuse_range"
    CHECK ("signUpRiskScoreFreeTrialAbuse" >= 0 AND "signUpRiskScoreFreeTrialAbuse" <= 100) NOT VALID;
