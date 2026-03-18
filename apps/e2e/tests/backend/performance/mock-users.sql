BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

WITH internal_tenancy AS (
  SELECT id
  FROM "Tenancy"
  WHERE "projectId" = 'internal'
    AND "branchId" = 'main'
  LIMIT 1
),
params AS (
  -- How many users to insert per run.
  -- Edit the numeric literal below before running the script.
  SELECT 50000::bigint AS batch_size
),
existing_max AS (
  SELECT
    COALESCE(
      MAX((regexp_match(cc."value", '^perf-user-([0-9]+)@internal\.stack$'))[1]::bigint),
      0
    ) AS max_idx
  FROM internal_tenancy t
  LEFT JOIN "ContactChannel" cc
    ON cc."tenancyId" = t.id
   AND cc."type" = 'EMAIL'
   AND cc."usedForAuth" = 'TRUE'::"BooleanTrue"
   AND cc."value" ~ '^perf-user-[0-9]+@internal\.stack$'
),
next_range AS (
  SELECT
    GREATEST(1, max_idx + 1) AS start_idx,
    GREATEST(1, max_idx + 1) + p.batch_size - 1 AS end_idx
  FROM existing_max
  CROSS JOIN params p
),
generated AS (
  SELECT
    gs                         AS idx,
    t.id                       AS tenancy_id,
    ('perf-user-' || gs::text || '@internal.stack') AS email_value,
    (
      substr(md5(t.id::text || ':project_user:' || gs::text), 1, 8) || '-' ||
      substr(md5(t.id::text || ':project_user:' || gs::text), 9, 4) || '-' ||
      substr(md5(t.id::text || ':project_user:' || gs::text), 13, 4) || '-' ||
      substr(md5(t.id::text || ':project_user:' || gs::text), 17, 4) || '-' ||
      substr(md5(t.id::text || ':project_user:' || gs::text), 21, 12)
    )::uuid AS project_user_id,
    (
      substr(md5(t.id::text || ':auth_method:' || gs::text), 1, 8) || '-' ||
      substr(md5(t.id::text || ':auth_method:' || gs::text), 9, 4) || '-' ||
      substr(md5(t.id::text || ':auth_method:' || gs::text), 13, 4) || '-' ||
      substr(md5(t.id::text || ':auth_method:' || gs::text), 17, 4) || '-' ||
      substr(md5(t.id::text || ':auth_method:' || gs::text), 21, 12)
    )::uuid AS auth_method_id,
    (
      substr(md5(t.id::text || ':contact:' || gs::text), 1, 8) || '-' ||
      substr(md5(t.id::text || ':contact:' || gs::text), 9, 4) || '-' ||
      substr(md5(t.id::text || ':contact:' || gs::text), 13, 4) || '-' ||
      substr(md5(t.id::text || ':contact:' || gs::text), 17, 4) || '-' ||
      substr(md5(t.id::text || ':contact:' || gs::text), 21, 12)
    )::uuid AS contact_id,
    now()                      AS ts
  FROM internal_tenancy t
  CROSS JOIN next_range r
  CROSS JOIN generate_series(r.start_idx, r.end_idx) AS gs
  -- Ensure re-running this script can't error due to the unique constraint on
  -- (tenancyId, type, value, usedForAuth). If a perf-user email already exists
  -- and is used for auth, skip generating that row entirely.
  WHERE NOT EXISTS (
    SELECT 1
    FROM "ContactChannel" cc
    WHERE cc."tenancyId" = t.id
      AND cc."type" = 'EMAIL'
      AND cc."value" = ('perf-user-' || gs::text || '@internal.stack')
      AND cc."usedForAuth" = 'TRUE'::"BooleanTrue"
  )
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
  ON CONFLICT ("tenancyId", "projectUserId") DO NOTHING
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
    g.email_value,
    g.ts,
    g.ts
  FROM generated g
  ON CONFLICT DO NOTHING
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
  ON CONFLICT ("tenancyId", "id") DO NOTHING
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
FROM generated g

-- A user can only have one password auth method.
-- If this was already inserted by a previous run, skip it.
ON CONFLICT DO NOTHING;

COMMIT;
