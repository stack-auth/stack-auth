-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SessionReplayChunk_tenancyId_sessionReplayId_segment_idx"
  ON /* SCHEMA_NAME_SENTINEL */."SessionReplayChunk"("tenancyId", "sessionReplayId", "sessionReplaySegmentId");
