-- Drop first so a failed concurrent build cannot leave an invalid index that
-- makes CREATE INDEX IF NOT EXISTS incorrectly look successful on retry.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS /* SCHEMA_NAME_SENTINEL */."ContactChannel_tenancyId_id_key_for_pk";
-- SPLIT_STATEMENT_SENTINEL

-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY "ContactChannel_tenancyId_id_key_for_pk"
  ON /* SCHEMA_NAME_SENTINEL */."ContactChannel"("tenancyId", "id");
