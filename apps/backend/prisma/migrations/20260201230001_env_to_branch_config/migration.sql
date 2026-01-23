-- Migration to transfer config from EnvironmentConfigOverride to BranchConfigOverride
-- 
-- This migration:
-- 1. Copies branch-level fields from EnvironmentConfigOverride to BranchConfigOverride
-- 2. Removes branch-level fields from EnvironmentConfigOverride (keeping only env-only fields)
--
-- Environment-only fields (kept in EnvironmentConfigOverride, NOT transferred):
-- - domains.* (all domain fields - branch level has empty domains schema)
-- - emails.server.* (server config is environment-only)
-- - payments.testMode
-- - auth.oauth.providers.<id>.{isShared, clientId, clientSecret, facebookConfigId, microsoftTenantId}
--
-- All other fields are branch-level and will be transferred.
--
-- The config can be stored in two formats:
-- 1. Top-level dotted keys: "auth.oauth.providers.google.isShared": true
-- 2. Nested objects: { "auth": { "oauth": { "providers": { "google": { "isShared": true } } } } }
-- Or a mix of both.

-- Create helper function to check if a dotted key path is environment-only
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_is_env_only_key(key_path TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- domains.* - all domain fields are environment-only (branch level has empty domains schema)
  IF key_path LIKE 'domains.%' OR key_path = 'domains' THEN
    RETURN TRUE;
  END IF;
  
  -- emails.server.* - server config is environment-only
  IF key_path LIKE 'emails.server.%' OR key_path = 'emails.server' THEN
    RETURN TRUE;
  END IF;
  
  -- payments.testMode
  IF key_path = 'payments.testMode' THEN
    RETURN TRUE;
  END IF;
  
  -- auth.oauth.providers.<id>.{isShared, clientId, clientSecret, facebookConfigId, microsoftTenantId}
  -- Pattern: auth.oauth.providers.<provider-id>.<secret-field>
  IF key_path ~ '^auth\.oauth\.providers\.[^.]+\.(isShared|clientId|clientSecret|facebookConfigId|microsoftTenantId)$' THEN
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Create helper function to check if a dotted key should be excluded
-- This checks if any prefix of the key matches an environment-only path
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_should_exclude_dotted_key(key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  parts TEXT[];
  partial_path TEXT := '';
  i INT;
BEGIN
  parts := string_to_array(key, '.');
  FOR i IN 1..array_length(parts, 1) LOOP
    IF partial_path = '' THEN
      partial_path := parts[i];
    ELSE
      partial_path := partial_path || '.' || parts[i];
    END IF;
    IF temp_is_env_only_key(partial_path) THEN
      RETURN TRUE;
    END IF;
  END LOOP;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Create recursive function to filter config JSONB for branch-level fields
-- keep_env_only = FALSE: keep branch-level fields (for BranchConfigOverride)
-- keep_env_only = TRUE: keep environment-only fields (for cleaning EnvironmentConfigOverride)
-- path_prefix is the dot-separated path to the current object (empty string for root)
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_filter_config(config JSONB, keep_env_only BOOLEAN, path_prefix TEXT DEFAULT '')
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  key TEXT;
  value JSONB;
  full_path TEXT;
  filtered_value JSONB;
  is_env_only BOOLEAN;
  should_keep BOOLEAN;
BEGIN
  IF config IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR key, value IN SELECT * FROM jsonb_each(config) LOOP
    -- Build the full path for this key
    IF path_prefix = '' THEN
      full_path := key;
    ELSE
      full_path := path_prefix || '.' || key;
    END IF;
    
    -- Determine if this key/path is environment-only
    -- For dotted keys at top level (like "auth.oauth.providers.google.isShared"), 
    -- check if any prefix matches an environment-only path
    IF path_prefix = '' AND key LIKE '%.%' THEN
      is_env_only := temp_should_exclude_dotted_key(key);
    ELSE
      is_env_only := temp_is_env_only_key(full_path);
    END IF;
    
    -- Decide whether to keep based on keep_env_only flag
    -- keep_env_only = FALSE: keep branch-level (non-env-only) fields
    -- keep_env_only = TRUE: keep environment-only fields
    IF keep_env_only THEN
      should_keep := is_env_only;
    ELSE
      should_keep := NOT is_env_only;
    END IF;
    
    IF should_keep THEN
      -- For environment-only fields, include the entire value as-is (no filtering)
      IF is_env_only THEN
        result := result || jsonb_build_object(key, value);
      -- Handle nested objects recursively (only for branch-level paths that might contain env-only children)
      ELSIF jsonb_typeof(value) = 'object' THEN
        filtered_value := temp_filter_config(value, keep_env_only, full_path);
        
        -- Only include non-empty objects
        IF filtered_value IS NOT NULL AND filtered_value != '{}'::jsonb THEN
          result := result || jsonb_build_object(key, filtered_value);
        END IF;
      ELSE
        -- Non-object values: include as-is
        result := result || jsonb_build_object(key, value);
      END IF;
    ELSIF jsonb_typeof(value) = 'object' AND keep_env_only THEN
      -- For keep_env_only mode, we need to recurse into non-env-only objects
      -- to find env-only children (e.g., auth.oauth.providers.google contains isShared)
      filtered_value := temp_filter_config(value, keep_env_only, full_path);
      
      -- Only include non-empty objects
      IF filtered_value IS NOT NULL AND filtered_value != '{}'::jsonb THEN
        result := result || jsonb_build_object(key, filtered_value);
      END IF;
    END IF;
  END LOOP;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Wrapper function for filtering branch config (keeps branch-level fields)
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_filter_branch_config(config JSONB)
RETURNS JSONB AS $$
BEGIN
  RETURN temp_filter_config(config, FALSE, '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Wrapper function for filtering to keep only env-only fields
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION temp_filter_env_only_config(config JSONB)
RETURNS JSONB AS $$
BEGIN
  RETURN temp_filter_config(config, TRUE, '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- SPLIT_STATEMENT_SENTINEL

-- Create temporary index to speed up the migration
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "temp_eco_branch_transfer_idx" 
ON /* SCHEMA_NAME_SENTINEL */."EnvironmentConfigOverride" ("projectId", "branchId");
-- SPLIT_STATEMENT_SENTINEL

-- Batch transfer configs from EnvironmentConfigOverride to BranchConfigOverride
-- and update EnvironmentConfigOverride to keep only env-only fields
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_transfer AS (
  SELECT eco."projectId", eco."branchId", eco."config", eco."createdAt"
  FROM "EnvironmentConfigOverride" eco
  WHERE NOT EXISTS (
    SELECT 1 FROM "BranchConfigOverride" bco
    WHERE bco."projectId" = eco."projectId" 
      AND bco."branchId" = eco."branchId"
  )
  LIMIT 5000
),
inserted AS (
  INSERT INTO "BranchConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config", "source")
  SELECT 
    tt."projectId",
    tt."branchId",
    tt."createdAt",
    CURRENT_TIMESTAMP,
    temp_filter_branch_config(tt."config"),
    '{"type": "unlinked"}'::jsonb
  FROM to_transfer tt
  ON CONFLICT ("projectId", "branchId") DO NOTHING
  RETURNING "projectId", "branchId"
),
updated AS (
  UPDATE "EnvironmentConfigOverride" eco
  SET "config" = temp_filter_env_only_config(eco."config"),
      "updatedAt" = CURRENT_TIMESTAMP
  FROM inserted i
  WHERE eco."projectId" = i."projectId"
    AND eco."branchId" = i."branchId"
  RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM inserted;
-- SPLIT_STATEMENT_SENTINEL

-- Clean up temporary index
DROP INDEX IF EXISTS "temp_eco_branch_transfer_idx";

-- Clean up temporary functions
DROP FUNCTION IF EXISTS temp_filter_env_only_config(JSONB);
DROP FUNCTION IF EXISTS temp_filter_branch_config(JSONB);
DROP FUNCTION IF EXISTS temp_filter_config(JSONB, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS temp_should_exclude_dotted_key(TEXT);
DROP FUNCTION IF EXISTS temp_is_env_only_key(TEXT);
