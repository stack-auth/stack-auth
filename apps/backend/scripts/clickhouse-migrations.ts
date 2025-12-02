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
  await client.exec({
    query: "CREATE ROW POLICY IF NOT EXISTS events_project_isolation ON events FOR SELECT USING project_id = getSetting('SQL_project_id') AND branch_id = getSetting('SQL_branch_id') TO limited_user",
  });
  const queries = [
    "GRANT SELECT ON analytics.events TO limited_user;",
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
