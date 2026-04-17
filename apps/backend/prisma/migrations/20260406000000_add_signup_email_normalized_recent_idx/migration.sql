-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProjectUser_signUpEmailNormalized_recent_idx"
  ON "ProjectUser"("tenancyId", "isAnonymous", "signUpEmailNormalized", "signedUpAt");
