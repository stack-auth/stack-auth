-- Migration to set testMode to true for existing environment config overrides
-- This is needed because testMode default is changing from true to false,
-- and we want existing projects to retain their current behavior.
--
-- The config can store testMode in two ways:
-- 1. Top-level key: "payments.testMode": true
-- 2. Nested syntax: "payments": { "testMode": true }
--
-- We need to set testMode to true only if it's not already set in either form.

-- Create temporary index to speed up the migration
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "temp_eco_testmode_idx" ON /* SCHEMA_NAME_SENTINEL */."EnvironmentConfigOverride" USING GIN ("config");
-- SPLIT_STATEMENT_SENTINEL

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_update AS (
  SELECT "projectId", "branchId", "config"
  FROM "EnvironmentConfigOverride"
  WHERE NOT "config" ? 'payments.testMode'
    AND NOT ("config" ? 'payments' AND ("config" -> 'payments') ? 'testMode')
  LIMIT 10000
)
UPDATE "EnvironmentConfigOverride" eco
SET "config" = jsonb_set(
  COALESCE(eco."config", '{}'::jsonb),
  '{payments.testMode}',
  'true'::jsonb,
  true
)
FROM to_update
WHERE eco."projectId" = to_update."projectId"
  AND eco."branchId" = to_update."branchId"
RETURNING true AS should_repeat_migration;
-- SPLIT_STATEMENT_SENTINEL

-- Clean up temporary index
DROP INDEX IF EXISTS "temp_eco_testmode_idx";

