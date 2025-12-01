import { createClickhouseClient } from "@/lib/clickhouse";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export async function runClickhouseMigrations() {
  console.log("Running Clickhouse migrations...");
  const client = createClickhouseClient("admin");
  const clickhouseExternalPassword = getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_PASSWORD");
  // todo: create migration files
  await client.exec({
    query: "CREATE USER IF NOT EXISTS limited_user IDENTIFIED WITH plaintext_password BY {clickhouseExternalPassword:String}",
    query_params: { clickhouseExternalPassword },
  });
  const queries = [
    "GRANT SELECT ON analytics.allowed_table1 TO limited_user;",
    "REVOKE ALL ON system.* FROM limited_user;",
    "REVOKE CREATE, ALTER, DROP, INSERT ON *.* FROM limited_user;"
  ];
  for (const query of queries) {
    console.log(query);
    await client.exec({ query });
  }
  console.log("Clickhouse migrations complete");
  await client.close();
}



const EVENTS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS events (
    event_id    UUID DEFAULT generateUUIDv4(),
    event_type  LowCardinality(String),
    event_at    DateTime64(3, 'UTC'),
    data        JSON,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE MergeTree
PARTITION BY toYYYYMM(event_at)
ORDER BY (event_at, event_type);
`;
