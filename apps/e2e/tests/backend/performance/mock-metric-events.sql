BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Spread existing perf users across the past 30 days
WITH tenancy AS (
  SELECT id
  FROM "Tenancy"
  WHERE "projectId" = 'internal'
    AND "branchId" = 'main'
    AND "organizationId" IS NULL
  LIMIT 1
),
ranked AS (
  SELECT
    "tenancyId",
    "projectUserId",
    ROW_NUMBER() OVER (ORDER BY "createdAt", "projectUserId") - 1 AS rn
  FROM "ProjectUser"
  WHERE "tenancyId" = (SELECT id FROM tenancy)
)
UPDATE "ProjectUser" pu
SET "createdAt" = (
      (current_date - ((ranked.rn % 30) * INTERVAL '1 day'))::timestamp
      + ((ranked.rn % 12) * INTERVAL '1 hour')
      + ((ranked.rn * 7 % 60) * INTERVAL '1 minute')
    ),
    "updatedAt" = NOW()
FROM ranked
WHERE pu."tenancyId" = ranked."tenancyId"
  AND pu."projectUserId" = ranked."projectUserId";

-- Add auth-method diversity (passwords already exist)
WITH tenancy AS (
  SELECT id
  FROM "Tenancy"
  WHERE "projectId" = 'internal'
    AND "branchId" = 'main'
    AND "organizationId" IS NULL
  LIMIT 1
),
ordered_users AS (
  SELECT
    "tenancyId",
    "projectUserId",
    ROW_NUMBER() OVER (ORDER BY "createdAt" DESC, "projectUserId") AS rn
  FROM "ProjectUser"
  WHERE "tenancyId" = (SELECT id FROM tenancy)
),
passkey_candidates AS (
  SELECT ou."tenancyId", ou."projectUserId", ou.rn, gen_random_uuid() AS auth_method_id
  FROM ordered_users ou
  LEFT JOIN "PasskeyAuthMethod" existing
    ON existing."tenancyId" = ou."tenancyId"
   AND existing."projectUserId" = ou."projectUserId"
  WHERE ou.rn <= 40
    AND existing."projectUserId" IS NULL
),
otp_candidates AS (
  SELECT ou."tenancyId", ou."projectUserId", ou.rn, gen_random_uuid() AS auth_method_id
  FROM ordered_users ou
  LEFT JOIN "OtpAuthMethod" existing
    ON existing."tenancyId" = ou."tenancyId"
   AND existing."projectUserId" = ou."projectUserId"
  WHERE ou.rn > 40 AND ou.rn <= 120
    AND existing."projectUserId" IS NULL
),
oauth_candidates AS (
  SELECT
    ou."tenancyId",
    ou."projectUserId",
    ou.rn,
    gen_random_uuid() AS auth_method_id,
    CASE ((ou.rn - 121) % 3)
      WHEN 0 THEN 'github'
      WHEN 1 THEN 'google'
      ELSE 'microsoft'
    END AS provider_id,
    'acct-' || lpad(ou.rn::text, 4, '0') AS provider_account_id,
    'oauth-user-' || lpad(ou.rn::text, 4, '0') || '@internal.stack' AS email
  FROM ordered_users ou
  LEFT JOIN "OAuthAuthMethod" existing
    ON existing."tenancyId" = ou."tenancyId"
   AND existing."projectUserId" = ou."projectUserId"
  WHERE ou.rn > 120 AND ou.rn <= 240
    AND existing."projectUserId" IS NULL
),
insert_passkey_auth_methods AS (
  INSERT INTO "AuthMethod" ("tenancyId","id","projectUserId","createdAt","updatedAt")
  SELECT
    "tenancyId",
    auth_method_id,
    "projectUserId",
    NOW() - ((rn % 15) * INTERVAL '1 day'),
    NOW()
  FROM passkey_candidates
  RETURNING "tenancyId","id","projectUserId","createdAt"
),
insert_passkeys AS (
  INSERT INTO "PasskeyAuthMethod"
    ("tenancyId","authMethodId","projectUserId","createdAt","updatedAt",
     "credentialId","publicKey","userHandle","transports","credentialDeviceType","counter")
  SELECT
    p."tenancyId",
    p."id",
    p."projectUserId",
    p."createdAt",
    p."createdAt",
    'cred-' || LPAD((ROW_NUMBER() OVER (ORDER BY p."projectUserId"))::text, 4, '0'),
    encode(gen_random_bytes(24), 'base64'),
    encode(gen_random_bytes(16), 'hex'),
    ARRAY['internal','hybrid'],
    'multiDevice',
    1 + (ROW_NUMBER() OVER (ORDER BY p."projectUserId") % 100)
  FROM insert_passkey_auth_methods p
  RETURNING 1
),
insert_otp_auth_methods AS (
  INSERT INTO "AuthMethod" ("tenancyId","id","projectUserId","createdAt","updatedAt")
  SELECT
    "tenancyId",
    auth_method_id,
    "projectUserId",
    NOW() - ((rn % 10) * INTERVAL '1 day'),
    NOW()
  FROM otp_candidates
  RETURNING "tenancyId","id","projectUserId","createdAt"
),
insert_otp_methods AS (
  INSERT INTO "OtpAuthMethod" ("tenancyId","authMethodId","projectUserId","createdAt","updatedAt")
  SELECT
    "tenancyId",
    "id",
    "projectUserId",
    "createdAt",
    "createdAt"
  FROM insert_otp_auth_methods
  RETURNING 1
),
insert_oauth_auth_methods AS (
  INSERT INTO "AuthMethod" ("tenancyId","id","projectUserId","createdAt","updatedAt")
  SELECT
    "tenancyId",
    auth_method_id,
    "projectUserId",
    NOW() - ((rn % 8) * INTERVAL '1 day'),
    NOW()
  FROM oauth_candidates
  RETURNING "tenancyId","id","projectUserId","createdAt"
),
insert_oauth_accounts AS (
  INSERT INTO "ProjectUserOAuthAccount"
    ("tenancyId","id","projectUserId","configOAuthProviderId","providerAccountId",
     "email","allowConnectedAccounts","allowSignIn","createdAt","updatedAt")
  SELECT
    oc."tenancyId",
    gen_random_uuid(),
    oc."projectUserId",
    oc.provider_id,
    oc.provider_account_id,
    oc.email,
    true,
    true,
    NOW() - ((oc.rn % 8) * INTERVAL '1 day'),
    NOW()
  FROM oauth_candidates oc
  ON CONFLICT ("tenancyId","configOAuthProviderId","projectUserId","providerAccountId") DO NOTHING
),
insert_oauth_methods AS (
  INSERT INTO "OAuthAuthMethod"
    ("tenancyId","authMethodId","configOAuthProviderId","providerAccountId","projectUserId","createdAt","updatedAt")
  SELECT
    oc."tenancyId",
    oc.auth_method_id,
    oc.provider_id,
    oc.provider_account_id,
    oc."projectUserId",
    NOW(),
    NOW()
  FROM oauth_candidates oc
  ON CONFLICT DO NOTHING
  RETURNING 1
)
SELECT
  (SELECT COUNT(*) FROM insert_passkeys) AS passkeys_created,
  (SELECT COUNT(*) FROM insert_otp_methods) AS otp_created,
  (SELECT COUNT(*) FROM insert_oauth_methods) AS oauth_created;

SELECT 0 AS events_created;

COMMIT;
