-- Drop the old generated status column in its own short transaction after the
-- swapped plain status column has been synced, made NOT NULL, and validated.

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
SELECT set_config('lock_timeout', '5s', true);

-- SPLIT_STATEMENT_SENTINEL

ALTER TABLE "EmailOutbox"
  DROP COLUMN "status_v3";
