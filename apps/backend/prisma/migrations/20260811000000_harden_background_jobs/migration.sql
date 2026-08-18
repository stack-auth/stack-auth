-- Keep poison workflow events visible without retrying them forever.
-- WorkflowEvent predates this release, so unlike the issue tables (which
-- create these dead-letter-adjacent fields directly in 20260731000000_add_issues)
-- it needs an ALTER. These nullable columns are metadata-only additions on
-- supported PostgreSQL versions. Still fail quickly rather than queueing an
-- ACCESS EXCLUSIVE lock behind production traffic for the lifetime of the
-- deploy transaction.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "WorkflowEvent"
  ADD COLUMN IF NOT EXISTS "deadLetteredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastProcessingError" VARCHAR(2048);
