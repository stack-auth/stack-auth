-- Keep retry cleanup outside the batched migration. Otherwise every 10,000-row
-- batch would drop and rebuild the partial index over the full source table.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS /* SCHEMA_NAME_SENTINEL */."temp_ContactChannel_contactId_backfill_idx";
-- SPLIT_STATEMENT_SENTINEL

-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY "temp_ContactChannel_contactId_backfill_idx"
  ON /* SCHEMA_NAME_SENTINEL */."ContactChannel"("tenancyId", "projectUserId", "id")
  WHERE "contactId" IS NULL;
