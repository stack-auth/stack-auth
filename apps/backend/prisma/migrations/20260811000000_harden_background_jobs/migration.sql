-- Keep poison workflow events visible without retrying them forever.
-- These nullable columns are metadata-only additions on supported PostgreSQL
-- versions. Still fail quickly rather than queueing an ACCESS EXCLUSIVE lock
-- behind production traffic for the lifetime of the deploy transaction.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "WorkflowEvent"
  ADD COLUMN IF NOT EXISTS "deadLetteredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastProcessingError" VARCHAR(2048);

ALTER TABLE "IssueAlertDelivery"
  ADD COLUMN IF NOT EXISTS "workflowPayload" JSONB;

ALTER TABLE "IssueMaterialization"
  ADD COLUMN IF NOT EXISTS "outcomes" JSONB,
  ADD COLUMN IF NOT EXISTS "webhooksDispatchedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "alertsDispatchedAt" TIMESTAMP(3);
