BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

WITH internal_tenancy AS (
  SELECT id
  FROM "Tenancy"
  WHERE "projectId" = 'internal'
    AND "branchId" = 'main'
  LIMIT 1
),
generated AS (
  SELECT
    t.id                       AS tenancy_id,
    gen_random_uuid()          AS project_user_id,
    gen_random_uuid()          AS auth_method_id,
    gen_random_uuid()          AS contact_id,
    gs                         AS idx,
    lpad(gs::text, 5, '0')     AS padded_idx,
    now()                      AS ts
  FROM internal_tenancy t
  CROSS JOIN generate_series(10001, 20000) AS gs
),
insert_users AS (
  INSERT INTO "ProjectUser"
    ("tenancyId","projectUserId","mirroredProjectId","mirroredBranchId","displayName",
     "projectId","createdAt","updatedAt")
  SELECT
    tenancy_id,
    project_user_id,
    'internal',
    'main',
    'Perf Test User ' || idx,
    'internal',
    ts,
    ts
  FROM generated
  RETURNING "tenancyId","projectUserId"
),
insert_contacts AS (
  INSERT INTO "ContactChannel"
    ("tenancyId","projectUserId","id","type","isPrimary","usedForAuth",
     "isVerified","value","createdAt","updatedAt")
  SELECT
    g.tenancy_id,
    g.project_user_id,
    g.contact_id,
    'EMAIL',
    'TRUE'::"BooleanTrue",
    'TRUE'::"BooleanTrue",
    false,
    'perf-user-' || g.padded_idx || '@internal.stack',
    g.ts,
    g.ts
  FROM generated g
  RETURNING "tenancyId","projectUserId"
),
insert_auth_methods AS (
  INSERT INTO "AuthMethod"
    ("tenancyId","id","projectUserId","createdAt","updatedAt")
  SELECT
    tenancy_id,
    auth_method_id,
    project_user_id,
    ts,
    ts
  FROM generated
  RETURNING "tenancyId","id","projectUserId"
)
INSERT INTO "PasswordAuthMethod"
  ("tenancyId","authMethodId","projectUserId","passwordHash","createdAt","updatedAt")
SELECT
  g.tenancy_id,
  g.auth_method_id,
  g.project_user_id,
  '$2a$13$TVyY/gpw9Db/w1fBeJkCgeNg2Rae2JfNqrPnSACtj.ufAO5cVF13.', -- swap in your own bcrypt hash if desired
  g.ts,
  g.ts
FROM generated g;

COMMIT;
