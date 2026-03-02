-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Index on isQueued for efficient queueReadyEmails() queries.
-- Most emails have isQueued=TRUE (already processed), so filtering for FALSE is highly selective.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailOutbox_isQueued_idx" ON /* SCHEMA_NAME_SENTINEL */."EmailOutbox" ("isQueued");
