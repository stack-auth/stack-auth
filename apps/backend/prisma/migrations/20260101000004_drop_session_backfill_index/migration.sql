-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- Drop the temporary session backfill index
DROP INDEX CONCURRENTLY IF EXISTS idx_event_session_backfill_temp;
