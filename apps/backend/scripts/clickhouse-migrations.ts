import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export async function runClickhouseMigrations() {
  const start = performance.now();
  console.log("[Clickhouse] Running Clickhouse migrations...");
  const client = getClickhouseAdminClient();
  const clickhouseExternalPassword = getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_PASSWORD");

  // Setup — database, user, sync metadata
  await client.command({ query: EXTERNAL_ANALYTICS_DB_SQL });
  await Promise.all([
    client.command({
      query: "CREATE USER IF NOT EXISTS limited_user IDENTIFIED WITH sha256_password BY {clickhouseExternalPassword:String}",
      query_params: { clickhouseExternalPassword },
    }),
    client.command({ query: SYNC_METADATA_TABLE_SQL }),
  ]);

  // Create all tables in parallel
  await Promise.all([
    client.command({ query: EVENTS_TABLE_BASE_SQL }),
    client.command({ query: USERS_TABLE_BASE_SQL }),
    client.command({ query: CONTACT_CHANNELS_TABLE_BASE_SQL }),
    client.command({ query: TEAMS_TABLE_BASE_SQL }),
    client.command({ query: TEAM_MEMBER_PROFILES_TABLE_BASE_SQL }),
    client.command({ query: TEAM_PERMISSIONS_TABLE_BASE_SQL }),
    client.command({ query: TEAM_INVITATIONS_TABLE_BASE_SQL }),
    client.command({ query: EMAIL_OUTBOXES_TABLE_BASE_SQL }),

    client.command({ query: PROJECT_PERMISSIONS_TABLE_BASE_SQL }),
    client.command({ query: NOTIFICATION_PREFERENCES_TABLE_BASE_SQL }),
    client.command({ query: REFRESH_TOKENS_TABLE_BASE_SQL }),
    client.command({ query: CONNECTED_ACCOUNTS_TABLE_BASE_SQL }),
  ]);

  // Alter events table (must come before views that reference new columns)
  await client.command({ query: EVENTS_ADD_REPLAY_COLUMNS_SQL });

  // Create all views in parallel
  await Promise.all([
    client.command({ query: EVENTS_VIEW_SQL }),
    client.command({ query: USERS_VIEW_SQL }),
    client.command({ query: CONTACT_CHANNELS_VIEW_SQL }),
    client.command({ query: TEAMS_VIEW_SQL }),
    client.command({ query: TEAM_MEMBER_PROFILES_VIEW_SQL }),
    client.command({ query: TEAM_PERMISSIONS_VIEW_SQL }),
    client.command({ query: TEAM_INVITATIONS_VIEW_SQL }),
    client.command({ query: EMAIL_OUTBOXES_VIEW_SQL }),

    client.command({ query: PROJECT_PERMISSIONS_VIEW_SQL }),
    client.command({ query: NOTIFICATION_PREFERENCES_VIEW_SQL }),
    client.command({ query: REFRESH_TOKENS_VIEW_SQL }),
    client.command({ query: CONNECTED_ACCOUNTS_VIEW_SQL }),
  ]);

  // Data migrations (mutations)
  await Promise.all([
    client.command({ query: TOKEN_REFRESH_EVENT_ROW_FORMAT_MUTATION_SQL }),
    client.command({ query: BACKFILL_REFRESH_TOKEN_ID_COLUMN_SQL }),
    client.command({ query: SIGN_UP_RULE_TRIGGER_EVENT_ROW_FORMAT_MUTATION_SQL }),
  ]);

  // Row policies in parallel
  const tables = [
    "events", "users", "contact_channels", "teams", "team_member_profiles",
    "team_permissions", "team_invitations", "email_outboxes",
    "project_permissions", "notification_preferences", "refresh_tokens", "connected_accounts",
  ];
  await Promise.all(tables.map(table =>
    client.command({
      query: `CREATE ROW POLICY IF NOT EXISTS ${table}_project_isolation ON default.${table} FOR SELECT USING project_id = getSetting('SQL_project_id') AND branch_id = getSetting('SQL_branch_id') TO limited_user`,
    })
  ));

  // Grants
  await client.command({ query: "REVOKE ALL PRIVILEGES ON *.* FROM limited_user;" });
  await client.command({ query: "REVOKE ALL FROM limited_user;" });
  await Promise.all(tables.map(table =>
    client.command({ query: `GRANT SELECT ON default.${table} TO limited_user;` })
  ));

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`[Clickhouse] Clickhouse migrations complete (${elapsed}s)`);
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

const CONTACT_CHANNELS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.contact_channels (
    project_id String,
    branch_id String,
    id UUID,
    user_id UUID,
    type LowCardinality(String),
    value String,
    is_primary UInt8,
    is_verified UInt8,
    used_for_auth UInt8,
    created_at DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const CONTACT_CHANNELS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.contact_channels
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  user_id,
  type,
  value,
  is_primary,
  is_verified,
  used_for_auth,
  created_at
FROM analytics_internal.contact_channels
FINAL
WHERE sync_is_deleted = 0;
`;

const TEAMS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.teams (
    project_id String,
    branch_id String,
    id UUID,
    display_name String,
    profile_image_url Nullable(String),
    created_at DateTime64(3, 'UTC'),
    client_metadata String,
    client_read_only_metadata String,
    server_metadata String,
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const TEAMS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.teams
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  display_name,
  profile_image_url,
  created_at,
  client_metadata,
  client_read_only_metadata,
  server_metadata
FROM analytics_internal.teams
FINAL
WHERE sync_is_deleted = 0;
`;

const TEAM_MEMBER_PROFILES_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.team_member_profiles (
    project_id String,
    branch_id String,
    team_id UUID,
    user_id UUID,
    display_name Nullable(String),
    profile_image_url Nullable(String),
    created_at DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, team_id, user_id);
`;

const TEAM_MEMBER_PROFILES_VIEW_SQL = `
CREATE OR REPLACE VIEW default.team_member_profiles
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  team_id,
  user_id,
  display_name,
  profile_image_url,
  created_at
FROM analytics_internal.team_member_profiles
FINAL
WHERE sync_is_deleted = 0;
`;

const TEAM_PERMISSIONS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.team_permissions (
    project_id       String,
    branch_id        String,
    team_id          UUID,
    user_id          UUID,
    id               String,
    created_at       DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted  UInt8,
    sync_created_at  DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, team_id, user_id, id);
`;

const TEAM_PERMISSIONS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.team_permissions
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  team_id,
  user_id,
  id,
  created_at
FROM analytics_internal.team_permissions
FINAL
WHERE sync_is_deleted = 0;
`;

const TEAM_INVITATIONS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.team_invitations (
    project_id         String,
    branch_id          String,
    id                 UUID,
    team_id            UUID,
    team_display_name  String,
    recipient_email    String,
    expires_at_millis  Int64,
    created_at         DateTime64(3, 'UTC'),
    sync_sequence_id   Int64,
    sync_is_deleted    UInt8,
    sync_created_at    DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const TEAM_INVITATIONS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.team_invitations
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  team_id,
  team_display_name,
  recipient_email,
  expires_at_millis,
  created_at
FROM analytics_internal.team_invitations
FINAL
WHERE sync_is_deleted = 0;
`;

const EMAIL_OUTBOXES_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.email_outboxes (
    project_id String,
    branch_id String,
    id UUID,
    status LowCardinality(String),
    simple_status LowCardinality(String),
    created_with LowCardinality(String),
    email_draft_id Nullable(String),
    email_programmatic_call_template_id Nullable(String),
    theme_id Nullable(String),
    is_high_priority UInt8,
    is_transactional Nullable(UInt8),
    subject Nullable(String),
    notification_category_id Nullable(String),
    started_rendering_at Nullable(DateTime64(3, 'UTC')),
    rendered_at Nullable(DateTime64(3, 'UTC')),
    render_error Nullable(String),
    scheduled_at DateTime64(3, 'UTC'),
    created_at DateTime64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC'),
    started_sending_at Nullable(DateTime64(3, 'UTC')),
    server_error Nullable(String),
    delivered_at Nullable(DateTime64(3, 'UTC')),
    opened_at Nullable(DateTime64(3, 'UTC')),
    clicked_at Nullable(DateTime64(3, 'UTC')),
    unsubscribed_at Nullable(DateTime64(3, 'UTC')),
    marked_as_spam_at Nullable(DateTime64(3, 'UTC')),
    bounced_at Nullable(DateTime64(3, 'UTC')),
    delivery_delayed_at Nullable(DateTime64(3, 'UTC')),
    can_have_delivery_info Nullable(UInt8),
    skipped_reason LowCardinality(Nullable(String)),
    skipped_details Nullable(String),
    send_retries Int32,
    is_paused UInt8,
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const EMAIL_OUTBOXES_VIEW_SQL = `
CREATE OR REPLACE VIEW default.email_outboxes
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  status,
  simple_status,
  created_with,
  email_draft_id,
  email_programmatic_call_template_id,
  theme_id,
  is_high_priority,
  is_transactional,
  subject,
  notification_category_id,
  started_rendering_at,
  rendered_at,
  render_error,
  scheduled_at,
  created_at,
  updated_at,
  started_sending_at,
  server_error,
  delivered_at,
  opened_at,
  clicked_at,
  unsubscribed_at,
  marked_as_spam_at,
  bounced_at,
  delivery_delayed_at,
  can_have_delivery_info,
  skipped_reason,
  skipped_details,
  send_retries,
  is_paused
FROM analytics_internal.email_outboxes
FINAL
WHERE sync_is_deleted = 0;
`;


const PROJECT_PERMISSIONS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.project_permissions (
    project_id       String,
    branch_id        String,
    user_id          UUID,
    id               String,
    created_at       DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted  UInt8,
    sync_created_at  DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, user_id, id);
`;

const PROJECT_PERMISSIONS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.project_permissions
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  user_id,
  id,
  created_at
FROM analytics_internal.project_permissions
FINAL
WHERE sync_is_deleted = 0;
`;

const NOTIFICATION_PREFERENCES_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.notification_preferences (
    project_id             String,
    branch_id              String,
    user_id                UUID,
    notification_category_id String,
    enabled                UInt8,
    sync_sequence_id       Int64,
    sync_is_deleted        UInt8,
    sync_created_at        DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
ORDER BY (project_id, branch_id, user_id, notification_category_id);
`;

const NOTIFICATION_PREFERENCES_VIEW_SQL = `
CREATE OR REPLACE VIEW default.notification_preferences
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  user_id,
  notification_category_id,
  enabled
FROM analytics_internal.notification_preferences
FINAL
WHERE sync_is_deleted = 0;
`;

const REFRESH_TOKENS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.refresh_tokens (
    project_id String,
    branch_id String,
    id UUID,
    user_id UUID,
    created_at DateTime64(3, 'UTC'),
    last_used_at DateTime64(3, 'UTC'),
    is_impersonation UInt8,
    expires_at Nullable(DateTime64(3, 'UTC')),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const REFRESH_TOKENS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.refresh_tokens
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  user_id,
  created_at,
  last_used_at,
  is_impersonation,
  expires_at
FROM analytics_internal.refresh_tokens
FINAL
WHERE sync_is_deleted = 0;
`;

const CONNECTED_ACCOUNTS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.connected_accounts (
    project_id String,
    branch_id String,
    user_id UUID,
    provider String,
    provider_account_id String,
    created_at DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, user_id, provider, provider_account_id);
`;

const CONNECTED_ACCOUNTS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.connected_accounts
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  user_id,
  provider,
  provider_account_id,
  created_at
FROM analytics_internal.connected_accounts
FINAL
WHERE sync_is_deleted = 0;
`;

const EXTERNAL_ANALYTICS_DB_SQL = `
CREATE DATABASE IF NOT EXISTS analytics_internal;
`;
