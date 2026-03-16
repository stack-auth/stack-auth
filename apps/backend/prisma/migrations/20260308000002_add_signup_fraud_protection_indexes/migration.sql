-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Indexes for sign-up fraud protection queries, created concurrently to avoid locking the table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProjectUser_signedUpAt_asc"
  ON "ProjectUser"("tenancyId", "signedUpAt" ASC);

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProjectUser_signUpIp_recent_idx"
  ON "ProjectUser"("tenancyId", "signUpIp", "signedUpAt");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProjectUser_signUpEmailBase_recent_idx"
  ON "ProjectUser"("tenancyId", "signUpEmailBase", "signedUpAt");
