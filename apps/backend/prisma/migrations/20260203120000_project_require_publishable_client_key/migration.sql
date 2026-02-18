-- Create temporary expression index to speed up the migration
-- (B-tree on the specific JSONB path, not GIN on the whole column,
-- so the index is actually used by the #>> WHERE clause)
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "temp_project_require_publishable_client_key_idx"
ON /* SCHEMA_NAME_SENTINEL */."Project"
USING GIN ("projectConfigOverride");
-- SPLIT_STATEMENT_SENTINEL

-- Set requirePublishableClientKey to true for existing projects when missing
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_update AS (
  SELECT "id"
  FROM "Project"
  WHERE NOT "projectConfigOverride" ? 'project.requirePublishableClientKey'
  LIMIT 10000
)
UPDATE "Project" p
SET "projectConfigOverride" = jsonb_set(
  COALESCE(p."projectConfigOverride", '{}'::jsonb),
  '{project.requirePublishableClientKey}',
  'true'::jsonb,
  true
)
FROM to_update tu
WHERE p."id" = tu."id"
RETURNING true AS should_repeat_migration;
-- SPLIT_STATEMENT_SENTINEL

-- Clean up temporary index
DROP INDEX IF EXISTS "temp_project_require_publishable_client_key_idx";
