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
    client_metadata JSON,
    client_read_only_metadata JSON,
    server_metadata JSON,
    is_anonymous UInt8,
    sequence_id Int64,
    is_deleted UInt8,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sequence_id)
PARTITION BY toYYYYMM(signed_up_at)
ORDER BY (project_id, branch_id, id);
`;

const USERS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.users 
SQL SECURITY DEFINER
AS
SELECT *
FROM analytics_internal.users
FINAL
WHERE is_deleted = 0;
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

const EXTERNAL_ANALYTICS_DB_SQL = `
CREATE DATABASE IF NOT EXISTS analytics_internal;
`;
