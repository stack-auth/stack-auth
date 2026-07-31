-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS /* SCHEMA_NAME_SENTINEL */."ContactChannel_tenancyId_contactId_type_identityScope_value_key";
-- SPLIT_STATEMENT_SENTINEL

-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY "ContactChannel_tenancyId_contactId_type_identityScope_value_key"
  ON /* SCHEMA_NAME_SENTINEL */."ContactChannel"("tenancyId", "contactId", "type", "identityScope", "value");
