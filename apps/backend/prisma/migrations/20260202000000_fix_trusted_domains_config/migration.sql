-- Migration to fix incorrectly formatted trusted domain entries in EnvironmentConfigOverride.
--
-- A previous migration sometimes generated entries like:
--   "domains.trustedDomains.<id>.<property1>": value1,
--   "domains.trustedDomains.<id>.<property2>": value2
--
-- Without the parent key:
--   "domains.trustedDomains.<id>": { ... }
--
-- This migration adds an empty object at the <id> level for any missing parent keys:
--   "domains.trustedDomains.<id>": {},
--   "domains.trustedDomains.<id>.<property1>": value1,
--   "domains.trustedDomains.<id>.<property2>": value2

-- Add temporary column to track processed rows (outside transaction so it's visible immediately)
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
ALTER TABLE /* SCHEMA_NAME_SENTINEL */."EnvironmentConfigOverride" ADD COLUMN IF NOT EXISTS "temp_trusted_domains_checked" BOOLEAN DEFAULT FALSE;
-- SPLIT_STATEMENT_SENTINEL

-- Create index on the temporary column for efficient querying
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "temp_eco_trusted_domains_checked_idx" 
ON /* SCHEMA_NAME_SENTINEL */."EnvironmentConfigOverride" ("temp_trusted_domains_checked") 
WHERE "temp_trusted_domains_checked" IS NOT TRUE;
-- SPLIT_STATEMENT_SENTINEL

-- Process rows in batches
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH rows_to_check AS (
  -- Get unchecked rows
  SELECT "projectId", "branchId", "config"
  FROM "EnvironmentConfigOverride"
  WHERE "temp_trusted_domains_checked" IS NOT TRUE
  LIMIT 10000
),
matching_keys AS (
  -- Find all keys that look like "domains.trustedDomains.<id>.<property...>"
  -- (4 or more dot-separated parts starting with domains.trustedDomains)
  SELECT
    rtc."projectId",
    rtc."branchId",
    key,
    -- Extract the parent key: domains.trustedDomains.<id>
    (string_to_array(key, '.'))[1] || '.' ||
    (string_to_array(key, '.'))[2] || '.' ||
    (string_to_array(key, '.'))[3] AS parent_key
  FROM rows_to_check rtc,
       jsonb_object_keys(rtc."config") AS key
  WHERE key ~ '^domains\.trustedDomains\.[^.]+\..+'
    -- Pattern matches: domains.trustedDomains.<id>.<anything>
    -- e.g. "domains.trustedDomains.abc123.baseUrl"
),
missing_parents AS (
  -- Find parent keys that don't exist in the config
  SELECT DISTINCT
    mk."projectId",
    mk."branchId",
    mk.parent_key
  FROM matching_keys mk
  JOIN rows_to_check rtc
    ON rtc."projectId" = mk."projectId"
    AND rtc."branchId" = mk."branchId"
  WHERE NOT (rtc."config" ? mk.parent_key)
),
parents_to_add AS (
  -- Aggregate all missing parent keys per row into a single jsonb object
  SELECT
    mp."projectId",
    mp."branchId",
    jsonb_object_agg(mp.parent_key, '{}'::jsonb) AS new_keys
  FROM missing_parents mp
  GROUP BY mp."projectId", mp."branchId"
),
updated_with_keys AS (
  -- Update rows that need new parent keys
  UPDATE "EnvironmentConfigOverride" eco
  SET
    "config" = eco."config" || pta.new_keys,
    "updatedAt" = NOW(),
    "temp_trusted_domains_checked" = TRUE
  FROM parents_to_add pta
  WHERE eco."projectId" = pta."projectId"
    AND eco."branchId" = pta."branchId"
  RETURNING eco."projectId", eco."branchId"
),
marked_as_checked AS (
  -- Mark all checked rows (including ones that didn't need fixing)
  UPDATE "EnvironmentConfigOverride" eco
  SET "temp_trusted_domains_checked" = TRUE
  FROM rows_to_check rtc
  WHERE eco."projectId" = rtc."projectId"
    AND eco."branchId" = rtc."branchId"
    AND NOT EXISTS (
      SELECT 1 FROM updated_with_keys uwk
      WHERE uwk."projectId" = eco."projectId"
        AND uwk."branchId" = eco."branchId"
    )
  RETURNING eco."projectId"
)
SELECT COUNT(*) > 0 AS should_repeat_migration
FROM rows_to_check;
-- SPLIT_STATEMENT_SENTINEL

-- Clean up: drop temporary index
DROP INDEX IF EXISTS "temp_eco_trusted_domains_checked_idx";
-- SPLIT_STATEMENT_SENTINEL

-- Clean up: drop temporary column (outside transaction)
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
ALTER TABLE /* SCHEMA_NAME_SENTINEL */."EnvironmentConfigOverride" DROP COLUMN IF EXISTS "temp_trusted_domains_checked";
