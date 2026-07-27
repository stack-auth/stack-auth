-- WorkflowEvent is introduced by an unmerged migration in this same
-- release, so this compatibility migration only upgrades development
-- databases that already applied an earlier revision of that migration.
-- There cannot be a production-scale table to backfill yet.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
ALTER TABLE /* SCHEMA_NAME_SENTINEL */."WorkflowEvent"
  ADD COLUMN IF NOT EXISTS "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
