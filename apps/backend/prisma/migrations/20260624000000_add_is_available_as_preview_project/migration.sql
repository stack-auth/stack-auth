-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
ALTER TABLE /* SCHEMA_NAME_SENTINEL */."Project"
ADD COLUMN IF NOT EXISTS "isAvailableAsPreviewProject" BOOLEAN NOT NULL DEFAULT false;

-- Partial index for fast pool claiming: only indexes the (tiny) subset of rows
-- that are currently available, ordered by creation time so the oldest is claimed first.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Project_isAvailableAsPreviewProject_createdAt_idx"
ON /* SCHEMA_NAME_SENTINEL */."Project" ("createdAt" ASC)
WHERE "isAvailableAsPreviewProject" = true;
