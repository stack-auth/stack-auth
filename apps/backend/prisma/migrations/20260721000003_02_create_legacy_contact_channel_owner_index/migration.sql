-- Old generated clients continue to address channels by this compound key
-- during the rollback window even after the primary key changes.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS /* SCHEMA_NAME_SENTINEL */."ContactChannel_legacy_owner_id_key";
-- SPLIT_STATEMENT_SENTINEL

-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY "ContactChannel_legacy_owner_id_key"
  ON /* SCHEMA_NAME_SENTINEL */."ContactChannel"("tenancyId", "projectUserId", "id");
