-- Drop the old status index only after the replacement status column has been
-- fully backfilled. This keeps existing status-filtered reads indexed during
-- the potentially long backfill migration.

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS "EmailOutbox_status_tenancy_idx";
