-- Keep this in its own migration: an earlier transactional ALTER in the
-- same file would retain a table lock and deadlock this concurrent drop.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS /* SCHEMA_NAME_SENTINEL */."WorkflowEvent_outbox_idx";
