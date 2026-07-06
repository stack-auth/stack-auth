-- Split OAuth provider config across the branch and environment layers.
--
-- Target model (single-sourced in packages/shared/src/config/oauth-providers.ts):
--   - BRANCH owns the provider ROSTER + enabled state: `type`, `allowSignIn`,
--     `allowConnectedAccounts`.
--   - ENVIRONMENT owns CREDENTIALS only: `isShared`, `clientId`, `clientSecret`,
--     `customCallbackUrl`, `facebookConfigId`, `microsoftTenantId`, `appleBundles`.
--
-- A prior migration (20260201230004_env_to_branch_config) already moved these
-- enable fields to the branch layer once, but project creation kept writing the
-- whole `auth.oauth.providers` object (including `type`) into the environment
-- layer, re-introducing the problem for every project created since. This
-- migration backfills those stragglers.
--
-- For each EnvironmentConfigOverride that still carries provider enable fields:
--   1. Collect the provider subtree as FIELD-level entries
--      (`auth.oauth.providers.<id>.<field>` = whole field value). Record-typed fields like
--      `appleBundles` stay whole objects (NOT deep-flattened, which would vanish at render).
--   2. Move the enable fields (`type`/`allowSignIn`/`allowConnectedAccounts`) into
--      the BranchConfigOverride. ENV WINS: for a provider present in both layers we
--      overwrite the branch enable fields with the environment's effective values,
--      so the rendered roster is identical before and after this migration (env
--      already wins at render today). The provider's entire prior branch entry is
--      dropped first, which also clears stale disable markers like
--      `{"auth.oauth.providers.spotify": null}`.
--   3. Rewrite the environment provider subtree as CREDENTIAL leaf keys only. Leaf
--      keys (never a whole `auth.oauth.providers.<id>` object) are required so the
--      environment layer doesn't clobber the branch roster at render.
--
-- Everything outside the `auth.oauth.providers` subtree is preserved BY VALUE: record
-- entries (e.g. `domains.trustedDomains.<id>`, `payments.products.<id>`) keep their
-- whole-object shape so they still render. We must NOT flatten those into dotted leaf
-- keys — function-default records render their container to `{}`, so a leaf like
-- `domains.trustedDomains.<id>.baseUrl` with no surviving `<id>` object is dropped at
-- render (the same vanishing bug we fix for providers). The only structural rewrite
-- outside providers is lifting the `auth` -> `auth.oauth` spine (the ancestors of
-- `auth.oauth.providers`) to dotted keys, since an `auth`/`auth.oauth`/
-- `auth.oauth.providers` OBJECT in the env layer would clobber the branch roster.

-- Build a nested object from dotted path segments, e.g. (['a','b'], 1) -> {"a":{"b":1}}.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_build_nested(segs TEXT[], value JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB := value;
  i INT;
BEGIN
  FOR i IN REVERSE array_length(segs, 1)..1 LOOP
    result := jsonb_build_object(segs[i], result);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Recursive deep merge of two JSONB objects (b wins on scalar conflicts; objects merge).
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_deep_merge(a JSONB, b JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  key TEXT;
  bval JSONB;
BEGIN
  IF a IS NULL OR jsonb_typeof(a) <> 'object' THEN RETURN b; END IF;
  IF b IS NULL OR jsonb_typeof(b) <> 'object' THEN RETURN b; END IF;
  result := a;
  FOR key, bval IN SELECT * FROM jsonb_each(b) LOOP
    IF (result ? key) AND jsonb_typeof(result -> key) = 'object' AND jsonb_typeof(bval) = 'object' THEN
      result := jsonb_set(result, ARRAY[key], temp_oauth_deep_merge(result -> key, bval));
    ELSE
      result := jsonb_set(result, ARRAY[key], bval, true);
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Canonicalize a mixed dotted/nested config into fully NESTED form (like the app's
-- normalize). Dotted keys at any depth are expanded and deep-merged; empty objects are
-- preserved. Lets us read provider fields uniformly regardless of how env stored them.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_to_nested(config JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  key TEXT;
  value JSONB;
  nested_value JSONB;
BEGIN
  IF config IS NULL OR jsonb_typeof(config) <> 'object' THEN
    RETURN config;
  END IF;

  FOR key, value IN SELECT * FROM jsonb_each(config) LOOP
    IF jsonb_typeof(value) = 'object' THEN
      nested_value := temp_oauth_to_nested(value);
    ELSE
      nested_value := value;
    END IF;
    result := temp_oauth_deep_merge(result, temp_oauth_build_nested(string_to_array(key, '.'), nested_value));
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- TRUE for a dotted path that is a provider enable field (branch-owned).
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_is_enable_path(key_path TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN key_path ~ '^auth\.oauth\.providers\.[^.]+\.(type|allowSignIn|allowConnectedAccounts)$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Provider subtree as FIELD-level leaf keys: `auth.oauth.providers.<id>.<field>` mapped to
-- the field's WHOLE value. Crucially we stop at the field level (depth 5) — record-typed
-- fields like `appleBundles` are emitted as a single whole-object leaf (matching
-- splitOAuthProvider), NOT deep-flattened into `...appleBundles.<id>.bundleId` leaves which
-- would vanish at render (appleBundles has no container default). Works for any input
-- representation (nested, dotted, or whole-object) thanks to temp_oauth_to_nested.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_collect_provider_leaf(config JSONB)
RETURNS JSONB AS $$
DECLARE
  providers JSONB;
  result JSONB := '{}'::jsonb;
  provider_id TEXT;
  entry JSONB;
  field TEXT;
  field_value JSONB;
BEGIN
  providers := temp_oauth_to_nested(config) #> '{auth,oauth,providers}';
  IF providers IS NULL OR jsonb_typeof(providers) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR provider_id, entry IN SELECT * FROM jsonb_each(providers) LOOP
    -- Skip non-object entries (e.g. a `auth.oauth.providers.<id>: null` disable marker).
    IF jsonb_typeof(entry) <> 'object' THEN
      CONTINUE;
    END IF;
    FOR field, field_value IN SELECT * FROM jsonb_each(entry) LOOP
      result := result || jsonb_build_object('auth.oauth.providers.' || provider_id || '.' || field, field_value);
    END LOOP;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Subset of collected provider leaf keys that are enable fields.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_enable_leaf(provider_leaf JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  key TEXT;
  value JSONB;
BEGIN
  FOR key, value IN SELECT * FROM jsonb_each(provider_leaf) LOOP
    IF temp_oauth_is_enable_path(key) THEN
      result := result || jsonb_build_object(key, value);
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- The BRANCH enable fields as a WHOLE OBJECT per provider, keyed at
-- `auth.oauth.providers.<id>` = {type, allowSignIn, allowConnectedAccounts}. the renderer drops dotted leaf keys (e.g.
-- `auth.oauth.providers.<id>.type`) whose parent `<id>` object doesn't exist, so the
-- enable fields MUST be a single object value (matching the dashboard's
-- splitProviderConfig and the env credential leaf keys that merge into it). Writing
-- them as leaf keys would make every migrated provider vanish at render.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_enable_object(provider_leaf JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  key TEXT;
  value JSONB;
  provider_id TEXT;
  field TEXT;
  obj_key TEXT;
BEGIN
  FOR key, value IN SELECT * FROM jsonb_each(provider_leaf) LOOP
    IF temp_oauth_is_enable_path(key) THEN
      provider_id := (string_to_array(key, '.'))[4];
      field := (string_to_array(key, '.'))[5];
      obj_key := 'auth.oauth.providers.' || provider_id;
      result := result || jsonb_build_object(
        obj_key,
        COALESCE(result -> obj_key, '{}'::jsonb) || jsonb_build_object(field, value)
      );
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- The new ENVIRONMENT config. Built SURGICALLY (NOT by flattening the whole config,
-- which would shred non-provider record entries into dotted leaves that vanish at
-- render — see header):
--   base := remove the provider subtree, preserving everything else by value;
--   base := lift only the `auth`/`auth.oauth`/`auth.oauth.providers` spine to dotted
--           keys so no ancestor OBJECT of the providers map clobbers the branch roster;
--   creds := provider CREDENTIAL leaf keys (enable fields + empty container leaves
--            dropped) that merge into the branch-provided provider objects at render.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_env_without_enable(config JSONB)
RETURNS JSONB AS $$
DECLARE
  base JSONB;
  provider_leaf JSONB;
  creds JSONB := '{}'::jsonb;
  key TEXT;
  value JSONB;
BEGIN
  -- Everything except the provider subtree, preserved by value (records stay whole).
  base := temp_oauth_remove_providers(config, NULL);
  -- Lift the providers-ancestor spine so the env layer carries no clobbering ancestor.
  base := temp_oauth_explode_provider_spine(base, '');

  -- Provider credentials as FIELD-level leaf keys (`auth.oauth.providers.<id>.<field>`,
  -- with record fields like appleBundles kept whole). Only the enable fields are dropped;
  -- everything else is a credential that merges into the branch-provided provider object.
  provider_leaf := temp_oauth_collect_provider_leaf(config);
  FOR key, value IN SELECT * FROM jsonb_each(provider_leaf) LOOP
    IF temp_oauth_is_enable_path(key) THEN
      CONTINUE;
    END IF;
    creds := creds || jsonb_build_object(key, value);
  END LOOP;

  RETURN base || creds;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Provider ids that have at least one enable field (i.e. that must be migrated).
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_migrated_ids(enable_leaf JSONB)
RETURNS TEXT[] AS $$
DECLARE
  ids TEXT[] := ARRAY[]::TEXT[];
  key TEXT;
BEGIN
  FOR key IN SELECT jsonb_object_keys(enable_leaf) LOOP
    ids := array_append(ids, (string_to_array(key, '.'))[4]);
  END LOOP;
  SELECT array_agg(DISTINCT id) INTO ids FROM unnest(ids) AS id;
  RETURN COALESCE(ids, ARRAY[]::TEXT[]);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Remove provider subtrees from a config, preserving everything else verbatim
-- (including empty objects). `ids` selects which providers to drop; NULL drops all
-- providers. Handles dotted keys, nested objects, the whole-object form, and the
-- `auth.oauth.providers.<id>: null` disable marker.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_remove_providers(config JSONB, ids TEXT[], path_prefix TEXT DEFAULT '')
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  key TEXT;
  value JSONB;
  full_path TEXT;
  segs TEXT[];
  filtered_value JSONB;
BEGIN
  IF config IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR key, value IN SELECT * FROM jsonb_each(config) LOOP
    IF path_prefix = '' THEN
      full_path := key;
    ELSE
      full_path := path_prefix || '.' || key;
    END IF;
    segs := string_to_array(full_path, '.');

    -- Drop the whole subtree once the path reaches a targeted provider.
    IF array_length(segs, 1) >= 4
       AND segs[1] = 'auth' AND segs[2] = 'oauth' AND segs[3] = 'providers'
       AND (ids IS NULL OR segs[4] = ANY(ids)) THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(value) = 'object' AND value <> '{}'::jsonb THEN
      filtered_value := temp_oauth_remove_providers(value, ids, full_path);
      -- Prune containers that removal emptied (e.g. an `auth.oauth.providers` map
      -- whose only entries were migrated providers). Pre-existing empty objects go
      -- through the ELSE branch and are preserved.
      IF filtered_value <> '{}'::jsonb THEN
        result := result || jsonb_build_object(key, filtered_value);
      END IF;
    ELSE
      result := result || jsonb_build_object(key, value);
    END IF;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Lift ONLY the providers-ancestor spine (`auth`, `auth.oauth`, `auth.oauth.providers`)
-- into dotted keys. An OBJECT stored at any of those paths in the env layer would, via
-- `override(branch, env)`, remove the branch's `auth.oauth.providers.<id>` entries
-- (env key is an ancestor of them) and clobber the roster. Exploding the spine emits
-- the off-spine children as dotted keys (e.g. `auth.oauth.accountMergeStrategy`,
-- `auth.password`) so no clobbering ancestor object remains. Everything not on the
-- spine — including record subtrees like `auth.signUpRules` — is kept WHOLE (by value),
-- so function-default records still render. (After temp_oauth_remove_providers the
-- providers subtree is already gone; recursing an emptied spine node contributes
-- nothing, which also drops a stray `auth.oauth.providers: {}` container.)
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_explode_provider_spine(config JSONB, path_prefix TEXT DEFAULT '')
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  key TEXT;
  value JSONB;
  full_path TEXT;
BEGIN
  IF config IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR key, value IN SELECT * FROM jsonb_each(config) LOOP
    IF path_prefix = '' THEN
      full_path := key;
    ELSE
      full_path := path_prefix || '.' || key;
    END IF;

    IF jsonb_typeof(value) = 'object'
       AND full_path IN ('auth', 'auth.oauth', 'auth.oauth.providers') THEN
      -- Spine ancestor of the providers map: explode it (recurse) rather than keep the object.
      result := result || temp_oauth_explode_provider_spine(value, full_path);
    ELSE
      -- Off-spine: keep the value whole at its (now possibly dotted) path.
      result := result || jsonb_build_object(full_path, value);
    END IF;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- TRUE if a config still has provider enable fields (used to find rows to migrate).
-- Kept cheap: a single-pass scan that stops at the first enable field and only walks the
-- `auth -> oauth -> providers` path, so it's fast to run over many rows.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_oauth_has_enable(config JSONB, path_prefix TEXT DEFAULT '')
RETURNS BOOLEAN AS $$
DECLARE
  key TEXT;
  value JSONB;
  full_path TEXT;
BEGIN
  IF config IS NULL OR jsonb_typeof(config) <> 'object' THEN
    RETURN FALSE;
  END IF;

  FOR key, value IN SELECT * FROM jsonb_each(config) LOOP
    IF path_prefix = '' THEN
      full_path := key;
    ELSE
      full_path := path_prefix || '.' || key;
    END IF;

    -- Enable field found (works for dotted keys at any depth).
    IF temp_oauth_is_enable_path(full_path) THEN
      RETURN TRUE;
    END IF;

    -- Descend ONLY where an enable field could still appear: the providers spine
    -- (`auth`, `auth.oauth`, `auth.oauth.providers`, `auth.oauth.providers.<id>`).
    IF jsonb_typeof(value) = 'object'
       AND full_path ~ '^auth(\.oauth(\.providers(\.[^.]+)?)?)?$'
       AND temp_oauth_has_enable(value, full_path) THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- WORKLIST: list the rows to migrate ONCE, then work through them in chunks by primary key.
-- This avoids re-scanning the whole table on every batch. The scan only runs to fill the
-- worklist when it's empty: once at the start, and once at the end to confirm nothing's left
-- (which also picks up any rows written mid-migration). An empty refill ends the migration.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE TABLE IF NOT EXISTS "temp_oauth_worklist" (
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  PRIMARY KEY ("projectId", "branchId")
);
-- SPLIT_STATEMENT_SENTINEL

-- Refill: only scans when the worklist is empty. The `NOT EXISTS (worklist)` check is
-- evaluated once, so while the worklist still has rows this skips the scan entirely.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
INSERT INTO "temp_oauth_worklist" ("projectId", "branchId")
SELECT eco."projectId", eco."branchId"
FROM "EnvironmentConfigOverride" eco
WHERE NOT EXISTS (SELECT 1 FROM "temp_oauth_worklist")
  AND temp_oauth_has_enable(eco."config")
ON CONFLICT DO NOTHING;
-- SPLIT_STATEMENT_SENTINEL

-- Batch: take <=2000 worklist rows, move their enable fields env -> branch (env wins), keep
-- credential leaf keys in env, and remove them from the worklist. Repeats until none are left.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH chunk AS (
  DELETE FROM "temp_oauth_worklist"
  WHERE ctid IN (SELECT ctid FROM "temp_oauth_worklist" LIMIT 2000)
  RETURNING "projectId", "branchId"
),
to_process AS (
  SELECT
    eco."projectId",
    eco."branchId",
    eco."config" AS env_config,
    eco."createdAt",
    temp_oauth_collect_provider_leaf(eco."config") AS provider_leaf
  FROM "EnvironmentConfigOverride" eco
  JOIN chunk ch ON ch."projectId" = eco."projectId" AND ch."branchId" = eco."branchId"
),
computed AS (
  SELECT
    tp."projectId",
    tp."branchId",
    tp."env_config",
    tp."createdAt",
    temp_oauth_enable_object(tp.provider_leaf) AS enable_object,
    temp_oauth_migrated_ids(temp_oauth_enable_leaf(tp.provider_leaf)) AS migrated_ids
  FROM to_process tp
),
branch_upsert AS (
  INSERT INTO "BranchConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config", "source")
  SELECT
    c."projectId",
    c."branchId",
    c."createdAt",
    CURRENT_TIMESTAMP,
    -- env wins: drop the providers' prior branch entries, then add the enable fields
    -- as a whole object per provider (`auth.oauth.providers.<id>` = {...})
    temp_oauth_remove_providers(
      COALESCE(
        (SELECT bco."config" FROM "BranchConfigOverride" bco
         WHERE bco."projectId" = c."projectId" AND bco."branchId" = c."branchId"),
        '{}'::jsonb
      ),
      c.migrated_ids
    ) || c.enable_object,
    '{"type": "unlinked"}'::jsonb
  FROM computed c
  ON CONFLICT ("projectId", "branchId") DO UPDATE
    SET "config" = EXCLUDED."config",
        "updatedAt" = CURRENT_TIMESTAMP
  RETURNING "projectId", "branchId"
),
env_update AS (
  UPDATE "EnvironmentConfigOverride" eco
  SET
    -- keep credentials as leaf keys + non-provider content by value; drop enable fields
    "config" = temp_oauth_env_without_enable(eco."config"),
    "updatedAt" = CURRENT_TIMESTAMP
  FROM computed c
  WHERE eco."projectId" = c."projectId" AND eco."branchId" = c."branchId"
  RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM chunk;
-- SPLIT_STATEMENT_SENTINEL

-- Clean up.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DROP TABLE IF EXISTS "temp_oauth_worklist";
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_has_enable(JSONB, TEXT);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_remove_providers(JSONB, TEXT[], TEXT);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_explode_provider_spine(JSONB, TEXT);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_migrated_ids(JSONB);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_env_without_enable(JSONB);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_enable_object(JSONB);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_enable_leaf(JSONB);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_collect_provider_leaf(JSONB);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_is_enable_path(TEXT);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_to_nested(JSONB);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_deep_merge(JSONB, JSONB);
-- SPLIT_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS temp_oauth_build_nested(TEXT[], JSONB);
