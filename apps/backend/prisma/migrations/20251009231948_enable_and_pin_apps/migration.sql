-- Create temporary index to speed up the migration
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "temp_eco_config_apps_idx" ON "EnvironmentConfigOverride" USING GIN ("config");
-- SPLIT_STATEMENT_SENTINEL

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_update AS (
  SELECT "projectId", "branchId", "config"
  FROM "EnvironmentConfigOverride"
  WHERE NOT "config" ? 'apps.installed.authentication.enabled'
     OR NOT "config" ? 'apps.installed.emails.enabled'
     OR NOT "config" ? 'apps.installed.teams.enabled'
     OR NOT "config" ? 'apps.installed.webhooks.enabled'
     OR NOT "config" ? 'apps.installed.launch-checklist.enabled'
     OR NOT "config" ? 'apps.installed.rbac.enabled'
     OR NOT "config" ? 'apps.installed.api-keys.enabled'
     OR NOT "config" ? 'apps.installed.payments.enabled'
  LIMIT 1000
)
UPDATE "EnvironmentConfigOverride" eco
SET "config" = 
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(eco."config", '{}'::jsonb),
                  '{apps.installed.authentication.enabled}',
                  'true'::jsonb,
                  true
                ),
                '{apps.installed.emails.enabled}',
                'true'::jsonb,
                true
              ),
              '{apps.installed.teams.enabled}',
              'true'::jsonb,
              true
            ),
            '{apps.installed.webhooks.enabled}',
            'true'::jsonb,
            true
          ),
          '{apps.installed.launch-checklist.enabled}',
          'true'::jsonb,
          true
        ),
        '{apps.installed.rbac.enabled}',
        'true'::jsonb,
        true
      ),
      '{apps.installed.api-keys.enabled}',
      CASE 
        WHEN EXISTS (
          SELECT 1 FROM "Tenancy" t
          JOIN "ProjectApiKey" pak ON pak."tenancyId" = t."id"
          WHERE t."projectId" = eco."projectId"
            AND t."branchId" = eco."branchId"
        ) THEN 'true'::jsonb
        ELSE 'false'::jsonb
      END,
      true
    ),
    '{apps.installed.payments.enabled}',
    CASE 
      WHEN EXISTS (
        SELECT 1 FROM "Project" p
        WHERE p."id" = eco."projectId"
          AND p."stripeAccountId" IS NOT NULL
      ) THEN 'true'::jsonb
      ELSE 'false'::jsonb
    END,
    true
  )
FROM to_update
WHERE eco."projectId" = to_update."projectId"
  AND eco."branchId" = to_update."branchId"
RETURNING true AS should_repeat_migration;
-- SPLIT_STATEMENT_SENTINEL

-- Clean up temporary index
DROP INDEX IF EXISTS "temp_eco_config_apps_idx";
