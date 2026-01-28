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
  await client.exec({ query: EVENTS_TABLE_BASE_SQL });
  await client.exec({ query: EVENTS_VIEW_SQL });
  const queries = [
    "REVOKE ALL PRIVILEGES ON *.* FROM limited_user;",
    "REVOKE ALL FROM limited_user;",
    "GRANT SELECT ON default.events TO limited_user;",
  ];
  await client.exec({
    query: "CREATE ROW POLICY IF NOT EXISTS events_project_isolation ON default.events FOR SELECT USING project_id = getSetting('SQL_project_id') AND branch_id = getSetting('SQL_branch_id') TO limited_user",
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

const EXTERNAL_ANALYTICS_DB_SQL = `
CREATE DATABASE IF NOT EXISTS analytics_internal;
`;
