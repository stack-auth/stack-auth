-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
-- Create temporary index for session backfill that matches our query exactly
-- The existing session index has branchId before userId/sessionId, which breaks index usage when we use COALESCE on branchId
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_session_backfill_temp
ON /* SCHEMA_NAME_SENTINEL */."Event" (
    (data->>'projectId'),
    (COALESCE(data->>'branchId', 'main')),
    (data->>'userId'),
    (data->>'sessionId'),
    "eventStartedAt" DESC
);
