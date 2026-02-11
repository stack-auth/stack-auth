--set -a; source apps/backend/.env.development; set +a; psql "$STACK_DATABASE_CONNECTION_STRING" -v ON_ERROR_STOP=1 -f apps/e2e/tests/backend/performance/mock-external-db-sync-projects.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- NOTE:
-- - This script is intentionally heavy (1,000,000 projects + 3,000,000 users).
-- - Update BOTH settings blocks if you need a different external DB connection string.
-- - The external DB should be reachable from the backend (default uses docker postgres on port 8128).

-- =====================================================================================
-- 1) One million projects, one user each
-- =====================================================================================
WITH settings AS (
  SELECT
    'postgresql://postgres:PASSWORD-PLACEHOLDER--uqfEC1hmmv@localhost:8128/loadtest'::text AS external_connection_string,
    1000000::int AS project_count
),
config AS (
  SELECT jsonb_build_object(
    'dbSync',
    jsonb_build_object(
      'externalDatabases',
      jsonb_build_object(
        'main',
        jsonb_build_object(
          'type', 'postgres',
          'connectionString', external_connection_string
        )
      )
    )
  ) AS config_json
  FROM settings
),
small_projects AS (
  SELECT
    gen_random_uuid() AS project_id,
    gen_random_uuid() AS tenancy_id,
    gen_random_uuid() AS project_user_id,
    gen_random_uuid() AS auth_method_id,
    gen_random_uuid() AS contact_id,
    gs AS idx,
    lpad(gs::text, 7, '0') AS padded_idx,
    now() AS ts
  FROM settings
  CROSS JOIN generate_series(1, settings.project_count) AS gs
),
insert_projects AS (
  INSERT INTO "Project" ("id", "displayName", "description", "isProductionMode", "ownerTeamId", "createdAt", "updatedAt")
  SELECT
    project_id,
    'External DB Sync Project ' || padded_idx,
    'External DB sync load test project',
    FALSE,
    NULL,
    ts,
    ts
  FROM small_projects
  RETURNING "id"
),
insert_tenancies AS (
  INSERT INTO "Tenancy" ("id", "projectId", "branchId", "organizationId", "hasNoOrganization", "createdAt", "updatedAt")
  SELECT
    tenancy_id,
    project_id,
    'main',
    NULL,
    'TRUE'::"BooleanTrue",
    ts,
    ts
  FROM small_projects
  RETURNING "id"
),
insert_env_config AS (
  INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "config", "createdAt", "updatedAt")
  SELECT
    project_id,
    'main',
    (SELECT config_json FROM config),
    ts,
    ts
  FROM small_projects
  ON CONFLICT ("projectId", "branchId") DO UPDATE SET
    "config" = EXCLUDED."config",
    "updatedAt" = EXCLUDED."updatedAt"
  RETURNING "projectId"
),
insert_users AS (
  INSERT INTO "ProjectUser"
    ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId", "displayName", "projectId", "createdAt", "updatedAt")
  SELECT
    tenancy_id,
    project_user_id,
    project_id,
    'main',
    'External Sync User ' || padded_idx,
    project_id,
    ts,
    ts
  FROM small_projects
  RETURNING "tenancyId", "projectUserId"
),
insert_contacts AS (
  INSERT INTO "ContactChannel"
    ("tenancyId", "projectUserId", "id", "type", "isPrimary", "usedForAuth", "isVerified", "value", "createdAt", "updatedAt")
  SELECT
    tenancy_id,
    project_user_id,
    contact_id,
    'EMAIL',
    'TRUE'::"BooleanTrue",
    'TRUE'::"BooleanTrue",
    false,
    'external-sync-user-' || padded_idx || '@load.local',
    ts,
    ts
  FROM small_projects
  RETURNING "tenancyId", "projectUserId"
),
insert_auth_methods AS (
  INSERT INTO "AuthMethod"
    ("tenancyId", "id", "projectUserId", "createdAt", "updatedAt")
  SELECT
    tenancy_id,
    auth_method_id,
    project_user_id,
    ts,
    ts
  FROM small_projects
  RETURNING "tenancyId", "id", "projectUserId"
)
INSERT INTO "PasswordAuthMethod"
  ("tenancyId", "authMethodId", "projectUserId", "passwordHash", "createdAt", "updatedAt")
SELECT
  tenancy_id,
  auth_method_id,
  project_user_id,
  '$2a$13$TVyY/gpw9Db/w1fBeJkCgeNg2Rae2JfNqrPnSACtj.ufAO5cVF13.',
  ts,
  ts
FROM small_projects;

COMMIT;

BEGIN;

-- =====================================================================================
-- 2) Three projects, one million users each
-- =====================================================================================
SET LOCAL synchronous_commit = off;

CREATE TEMP TABLE tmp_large_projects AS
SELECT
  gen_random_uuid() AS project_id,
  gen_random_uuid() AS tenancy_id,
  gs AS project_idx,
  lpad(gs::text, 2, '0') AS padded_project_idx,
  now() AS ts
FROM generate_series(1, 3) AS gs;

INSERT INTO "Project" ("id", "displayName", "description", "isProductionMode", "ownerTeamId", "createdAt", "updatedAt")
SELECT
  project_id,
  'External DB Sync Mega Project ' || padded_project_idx,
  'External DB sync load test project (mega)',
  FALSE,
  NULL,
  ts,
  ts
FROM tmp_large_projects;

INSERT INTO "Tenancy" ("id", "projectId", "branchId", "organizationId", "hasNoOrganization", "createdAt", "updatedAt")
SELECT
  tenancy_id,
  project_id,
  'main',
  NULL,
  'TRUE'::"BooleanTrue",
  ts,
  ts
FROM tmp_large_projects;

WITH settings AS (
  SELECT
    'postgresql://postgres:PASSWORD-PLACEHOLDER--uqfEC1hmmv@localhost:8128/loadtest'::text AS external_connection_string
),
config AS (
  SELECT jsonb_build_object(
    'dbSync',
    jsonb_build_object(
      'externalDatabases',
      jsonb_build_object(
        'main',
        jsonb_build_object(
          'type', 'postgres',
          'connectionString', external_connection_string
        )
      )
    )
  ) AS config_json
  FROM settings
)
INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "config", "createdAt", "updatedAt")
SELECT
  project_id,
  'main',
  (SELECT config_json FROM config),
  ts,
  ts
FROM tmp_large_projects
ON CONFLICT ("projectId", "branchId") DO UPDATE SET
  "config" = EXCLUDED."config",
  "updatedAt" = EXCLUDED."updatedAt";

-- ALTER TABLE "ProjectUser" DISABLE TRIGGER project_user_insert_trigger;

DO $$
DECLARE
  users_per_project int := 1000000;
  batch_size int := 10000;
  batch_start int := 1;
  batch_end int;
BEGIN
  WHILE batch_start <= users_per_project LOOP
    batch_end := LEAST(batch_start + batch_size - 1, users_per_project);

    WITH mega_users AS (
      SELECT
        lp.project_id,
        lp.tenancy_id,
        lp.project_idx,
        lp.padded_project_idx,
        gs AS user_idx,
        lpad(gs::text, 7, '0') AS padded_user_idx,
        gen_random_uuid() AS project_user_id,
        lp.ts AS ts
      FROM tmp_large_projects lp
      CROSS JOIN generate_series(batch_start, batch_end) AS gs
    )
    INSERT INTO "ProjectUser"
      ("tenancyId", "projectUserId", "mirroredProjectId", "mirroredBranchId", "displayName", "projectId", "createdAt", "updatedAt")
    SELECT
      tenancy_id,
      project_user_id,
      project_id,
      'main',
      'Mega User ' || padded_project_idx || '-' || padded_user_idx,
      project_id,
      ts,
      ts
    FROM mega_users;

    RAISE NOTICE 'Inserted users %-% of % per project', batch_start, batch_end, users_per_project;

    batch_start := batch_end + 1;
  END LOOP;
END $$;

-- ALTER TABLE "ProjectUser" ENABLE TRIGGER project_user_insert_trigger;

COMMIT;
