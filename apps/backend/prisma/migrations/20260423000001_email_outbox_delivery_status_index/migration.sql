-- Create the replacement status index in a follow-up migration so the prior
-- EmailOutbox table rewrite has committed before CREATE INDEX CONCURRENTLY
-- waits for conflicting transactions.

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailOutbox_status_tenancy_idx" ON /* SCHEMA_NAME_SENTINEL */."EmailOutbox" ("tenancyId", "status");
