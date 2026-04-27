-- Create the replacement status index after the status column swap has
-- committed, so CREATE INDEX CONCURRENTLY can wait outside that transaction.

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailOutbox_status_tenancy_idx" ON /* SCHEMA_NAME_SENTINEL */."EmailOutbox" ("tenancyId", "status");
