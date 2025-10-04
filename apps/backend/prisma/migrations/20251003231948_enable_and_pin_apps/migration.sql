-- Migration to enable and pin apps based on usage conditions
-- This migration updates both EnvironmentConfigOverride and Project tables

-- Update EnvironmentConfigOverride to enable apps
-- Authentication: Always enabled
UPDATE "EnvironmentConfigOverride"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{apps.installed.authentication.enabled}',
  'true'::jsonb,
  true
);

-- Emails: Always enabled
UPDATE "EnvironmentConfigOverride"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{apps.installed.emails.enabled}',
  'true'::jsonb,
  true
);

-- Teams: Always enabled
UPDATE "EnvironmentConfigOverride"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{apps.installed.teams.enabled}',
  'true'::jsonb,
  true
);

-- Webhooks: Always enabled
UPDATE "EnvironmentConfigOverride"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{apps.installed.webhooks.enabled}',
  'true'::jsonb,
  true
);

-- Launch Checklist: Always enabled
UPDATE "EnvironmentConfigOverride"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{apps.installed.launch-checklist.enabled}',
  'true'::jsonb,
  true
);

-- RBAC: Enable if at least one custom permission exists in the config
UPDATE "EnvironmentConfigOverride" eco
SET "config" = jsonb_set(
  COALESCE(eco."config", '{}'::jsonb),
  '{apps.installed.rbac.enabled}',
  'true'::jsonb,
  true
);

-- API Keys: Enable if at least one API key exists for the project
UPDATE "EnvironmentConfigOverride" eco
SET "config" = jsonb_set(
  COALESCE(eco."config", '{}'::jsonb),
  '{apps.installed.api-keys.enabled}',
  'true'::jsonb,
  true
)
FROM "Tenancy" t
WHERE eco."projectId" = t."projectId"
  AND eco."branchId" = t."branchId"
  AND EXISTS (
    SELECT 1 FROM "ProjectApiKey" pak
    WHERE pak."tenancyId" = t."id"
  );

-- Payments: Enable if Stripe account ID is available on the project
UPDATE "EnvironmentConfigOverride" eco
SET "config" = jsonb_set(
  COALESCE(eco."config", '{}'::jsonb),
  '{apps.installed.payments.enabled}',
  'true'::jsonb,
  true
)
FROM "Project" p
WHERE eco."projectId" = p."id"
  AND p."stripeAccountId" IS NOT NULL;
