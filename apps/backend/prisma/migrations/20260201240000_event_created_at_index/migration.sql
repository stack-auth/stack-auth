-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Add index on createdAt for efficient range queries (used by ClickHouse migration and similar count queries).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Event_createdAt_idx" ON /* SCHEMA_NAME_SENTINEL */."Event" ("createdAt");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Add composite index (createdAt, id) for cursor-based pagination queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Event_createdAt_id_idx" ON /* SCHEMA_NAME_SENTINEL */."Event" ("createdAt", "id");
