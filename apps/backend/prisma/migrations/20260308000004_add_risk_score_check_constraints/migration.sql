-- Add CHECK constraints for risk score columns (NOT VALID to avoid full table scan/lock).
-- Validated in a separate migration.
ALTER TABLE "ProjectUser"
  ADD CONSTRAINT "ProjectUser_risk_score_bot_range"
  CHECK ("signUpRiskScoreBot" >= 0 AND "signUpRiskScoreBot" <= 100) NOT VALID;

ALTER TABLE "ProjectUser"
  ADD CONSTRAINT "ProjectUser_risk_score_free_trial_abuse_range"
  CHECK ("signUpRiskScoreFreeTrialAbuse" >= 0 AND "signUpRiskScoreFreeTrialAbuse" <= 100) NOT VALID;
