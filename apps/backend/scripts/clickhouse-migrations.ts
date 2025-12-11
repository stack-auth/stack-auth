import { createClickhouseClient } from "@/lib/clickhouse";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export async function runClickhouseMigrations() {
  console.log("Running Clickhouse migrations...");
  const client = createClickhouseClient("admin");
  const clickhouseExternalPassword = getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_PASSWORD");
  await client.exec({
    query: "CREATE USER IF NOT EXISTS limited_user IDENTIFIED WITH plaintext_password BY {clickhouseExternalPassword:String}",
    query_params: { clickhouseExternalPassword },
  });
  // todo: create migration files
  await client.exec({ query: EVENTS_TABLE_BASE_SQL });
  await client.exec({ query: USERS_TABLE_BASE_SQL });
  await client.exec({
    query: "CREATE ROW POLICY IF NOT EXISTS events_project_isolation ON events FOR SELECT USING project_id = getSetting('SQL_project_id') AND branch_id = getSetting('SQL_branch_id') TO limited_user",
  });
  await client.exec({
    query: "CREATE ROW POLICY IF NOT EXISTS users_project_isolation ON users FOR SELECT USING project_id = getSetting('SQL_project_id') AND branch_id = getSetting('SQL_branch_id') TO limited_user",
  });
  const queries = [
    "GRANT SELECT ON analytics.events TO limited_user;",
    "GRANT SELECT ON analytics.users TO limited_user;",
    "REVOKE ALL ON system.* FROM limited_user;",
    "REVOKE CREATE, ALTER, DROP, INSERT ON *.* FROM limited_user;"
  ];
  for (const query of queries) {
    await client.exec({ query });
  }
  console.log("Clickhouse migrations complete");
  await client.close();
}

const EVENTS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS events (
    event_type  LowCardinality(String),
    event_at    DateTime64(3, 'UTC'),
    data        JSON,
    project_id  String,
    branch_id   String,
    user_id     String,
    team_id     String,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE MergeTree
PARTITION BY toYYYYMM(event_at)
ORDER BY (project_id, branch_id, event_at);
`;

const USERS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id UUID,
    display_name Nullable(String),
    profile_image_url Nullable(String),
    primary_email Nullable(String),
    primary_email_verified Bool,
    signed_up_at DateTime64(3, 'UTC'),
    client_metadata String,
    client_read_only_metadata String,
    server_metadata String,
    is_anonymous Bool,
    project_id String,
    branch_id String,
    sequence_id Int64,
    is_deleted Bool
)
ENGINE ReplacingMergeTree(sequence_id)
ORDER BY (project_id, branch_id, id)
SETTINGS allow_nullable_key = 1;
`;
