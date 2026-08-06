-- If a previous run of this migration failed mid-build (eg. crash or statement timeout), the index is
-- left behind in an INVALID state, and the CREATE below would silently skip it due to IF NOT EXISTS —
-- losing the uniqueness guarantee that the external-auth race handling relies on. Drop any leftover
-- first; if the previous run actually completed the build (and only failed afterwards), this rebuilds
-- the index unnecessarily, which is just a bit slow but correct.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS /* SCHEMA_NAME_SENTINEL */."AuthMethod_tenancyId_id_projectUserId_key";

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "AuthMethod_tenancyId_id_projectUserId_key"
    ON /* SCHEMA_NAME_SENTINEL */."AuthMethod"("tenancyId", "id", "projectUserId");
