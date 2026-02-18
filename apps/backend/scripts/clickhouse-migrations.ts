import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export async function runClickhouseMigrations() {
  console.log("[Clickhouse] Running Clickhouse migrations...");
  const client = getClickhouseAdminClient();
  const clickhouseExternalPassword = getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_PASSWORD");
  await client.exec({
    query: "CREATE USER IF NOT EXISTS limited_user IDENTIFIED WITH sha256_password BY {clickhouseExternalPassword:String}",
    query_params: { clickhouseExternalPassword },
  });
  // todo: create migration files
  await client.exec({ query: EXTERNAL_ANALYTICS_DB_SQL });
  await client.exec({ query: SYNC_METADATA_TABLE_SQL });
  await client.exec({ query: EVENTS_TABLE_BASE_SQL });
  await client.exec({ query: EVENTS_VIEW_SQL });
  await client.exec({ query: USERS_TABLE_BASE_SQL });
  await client.exec({ query: USERS_VIEW_SQL });
  await client.exec({ query: EVENTS_ADD_REPLAY_COLUMNS_SQL });
  await client.exec({ query: TOKEN_REFRESH_EVENT_ROW_FORMAT_MUTATION_SQL });
  await client.exec({ query: BACKFILL_REFRESH_TOKEN_ID_COLUMN_SQL });
  await client.exec({ query: SIGN_UP_RULE_TRIGGER_EVENT_ROW_FORMAT_MUTATION_SQL });
  const queries = [
    "REVOKE ALL PRIVILEGES ON *.* FROM limited_user;",
    "REVOKE ALL FROM limited_user;",
    "GRANT SELECT ON default.events TO limited_user;",
    "GRANT SELECT ON default.users TO limited_user;",
  ];
  await client.exec({
    query: "CREATE ROW POLICY IF NOT EXISTS events_project_isolation ON default.events FOR SELECT USING project_id = getSetting('SQL_project_id') AND branch_id = getSetting('SQL_branch_id') TO limited_user",
  });
  await client.exec({
    query: "CREATE ROW POLICY IF NOT EXISTS users_project_isolation ON default.users FOR SELECT USING project_id = getSetting('SQL_project_id') AND branch_id = getSetting('SQL_branch_id') TO limited_user",
  });
  for (const query of queries) {
    await client.exec({ query });
  }
  console.log("[Clickhouse] Clickhouse migrations complete");
  await client.close();
}

const EVENTS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.events (
    event_type       LowCardinality(String),
    event_at         DateTime64(3, 'UTC'),
    data             JSON,
    project_id       String,
    branch_id        String,
    user_id          Nullable(String),
    team_id          Nullable(String),
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE MergeTree
PARTITION BY toYYYYMM(event_at)
ORDER BY (project_id, branch_id, event_at);
`;

const EVENTS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.events 
SQL SECURITY DEFINER
AS
SELECT *
FROM analytics_internal.events;
`;

// Normalizes legacy $token-refresh rows (camelCase JSON) to the new format:
// - Row identity stays in columns (project_id/branch_id/user_id)
// - data JSON becomes { refresh_token_id, is_anonymous, ip_info } (snake_case)
// Assumption: all legacy rows have the camelCase format.
const TOKEN_REFRESH_EVENT_ROW_FORMAT_MUTATION_SQL = `
ALTER TABLE analytics_internal.events
UPDATE
  data = CAST(concat(
    '{',
      '"refresh_token_id":', toJSONString(data.refreshTokenId::String), ',',
      '"is_anonymous":', if(ifNull(data.isAnonymous::Nullable(Bool), false), 'true', 'false'), ',',
      '"ip_info":', if(
        isNull(data.ipInfo.ip::Nullable(String)),
        'null',
        concat(
          '{',
            '"ip":', toJSONString(data.ipInfo.ip::String), ',',
            '"is_trusted":', if(ifNull(data.ipInfo.isTrusted::Nullable(Bool), false), 'true', 'false'), ',',
            '"country_code":', if(isNull(data.ipInfo.countryCode::Nullable(String)), 'null', toJSONString(data.ipInfo.countryCode::String)), ',',
            '"region_code":', if(isNull(data.ipInfo.regionCode::Nullable(String)), 'null', toJSONString(data.ipInfo.regionCode::String)), ',',
            '"city_name":', if(isNull(data.ipInfo.cityName::Nullable(String)), 'null', toJSONString(data.ipInfo.cityName::String)), ',',
            '"latitude":', if(isNull(data.ipInfo.latitude::Nullable(Float64)), 'null', toString(data.ipInfo.latitude::Float64)), ',',
            '"longitude":', if(isNull(data.ipInfo.longitude::Nullable(Float64)), 'null', toString(data.ipInfo.longitude::Float64)), ',',
            '"tz_identifier":', if(isNull(data.ipInfo.tzIdentifier::Nullable(String)), 'null', toJSONString(data.ipInfo.tzIdentifier::String)),
          '}'
        )
      ),
    '}'
  ) AS JSON)
WHERE event_type = '$token-refresh'
  AND data.refreshTokenId::Nullable(String) IS NOT NULL;
`;

// Normalizes legacy $sign-up-rule-trigger rows (camelCase JSON) to the new format:
// - Row identity stays in columns (project_id/branch_id)
// - data JSON becomes { project_id, branch_id, rule_id, action, email, auth_method, oauth_provider } (snake_case)
const SIGN_UP_RULE_TRIGGER_EVENT_ROW_FORMAT_MUTATION_SQL = `
ALTER TABLE analytics_internal.events
UPDATE
  data = CAST(concat(
    '{',
      '"project_id":', toJSONString(JSONExtractString(toJSONString(data), 'projectId')), ',',
      '"branch_id":', toJSONString(JSONExtractString(toJSONString(data), 'branchId')), ',',
      '"rule_id":', toJSONString(JSONExtractString(toJSONString(data), 'ruleId')), ',',
      '"action":', toJSONString(JSONExtractString(toJSONString(data), 'action')), ',',
      '"email":', toJSONString(JSONExtract(toJSONString(data), 'email', 'Nullable(String)')), ',',
      '"auth_method":', toJSONString(JSONExtract(toJSONString(data), 'authMethod', 'Nullable(String)')), ',',
      '"oauth_provider":', toJSONString(JSONExtract(toJSONString(data), 'oauthProvider', 'Nullable(String)')),
    '}'
  ) AS JSON)
WHERE event_type = '$sign-up-rule-trigger'
  AND JSONHas(toJSONString(data), 'ruleId');
`;

const USERS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.users (
    project_id String,
    branch_id String,
    id UUID,
    display_name Nullable(String),
    profile_image_url Nullable(String),
    primary_email Nullable(String),
    primary_email_verified UInt8,
    signed_up_at DateTime64(3, 'UTC'),
    client_metadata String,
    client_read_only_metadata String,
    server_metadata String,
    is_anonymous UInt8,
    restricted_by_admin UInt8,
    restricted_by_admin_reason Nullable(String),
    restricted_by_admin_private_details Nullable(String),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(signed_up_at)
ORDER BY (project_id, branch_id, id);
`;

const USERS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.users 
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  display_name,
  profile_image_url,
  primary_email,
  primary_email_verified,
  signed_up_at,
  client_metadata,
  client_read_only_metadata,
  server_metadata,
  is_anonymous,
  restricted_by_admin,
  restricted_by_admin_reason,
  restricted_by_admin_private_details
FROM analytics_internal.users
FINAL
WHERE sync_is_deleted = 0;
`;

const SYNC_METADATA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal._stack_sync_metadata (
    tenancy_id UUID,
    mapping_name String,
    last_synced_sequence_id Int64,
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(updated_at)
ORDER BY (tenancy_id, mapping_name);
`;

const EVENTS_ADD_REPLAY_COLUMNS_SQL = `
ALTER TABLE analytics_internal.events
  ADD COLUMN IF NOT EXISTS refresh_token_id Nullable(String) AFTER team_id,
  ADD COLUMN IF NOT EXISTS session_replay_id Nullable(String) AFTER refresh_token_id,
  ADD COLUMN IF NOT EXISTS session_replay_segment_id Nullable(String) AFTER session_replay_id;
`;

// Backfill refresh_token_id from data.refresh_token_id for existing $token-refresh rows
const BACKFILL_REFRESH_TOKEN_ID_COLUMN_SQL = `
ALTER TABLE analytics_internal.events
UPDATE refresh_token_id = data.refresh_token_id::Nullable(String)
WHERE event_type = '$token-refresh'
  AND refresh_token_id IS NULL
  AND data.refresh_token_id::Nullable(String) IS NOT NULL;
`;

const EXTERNAL_ANALYTICS_DB_SQL = `
CREATE DATABASE IF NOT EXISTS analytics_internal;
`;
