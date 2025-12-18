import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

const clickhouseUrl = getEnvVariable("STACK_CLICKHOUSE_URL");
const clickhouseAdminUser = getEnvVariable("STACK_CLICKHOUSE_ADMIN_USER", "stackframe");
const clickhouseExternalUser = getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_USER", "limited_user");
const clickhouseAdminPassword = getEnvVariable("STACK_CLICKHOUSE_ADMIN_PASSWORD");
const clickhouseExternalPassword = getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_PASSWORD");
const clickhouseDatabase = getEnvVariable("STACK_CLICKHOUSE_DATABASE", "analytics");

export function createClickhouseClient(authType: "admin" | "external", database?: string) {
  return createClient({
    url: clickhouseUrl,
    username: authType === "admin" ? clickhouseAdminUser : clickhouseExternalUser,
    password: authType === "admin" ? clickhouseAdminPassword : clickhouseExternalPassword,
    database,
  });
}

export const clickhouseAdminClient = createClickhouseClient("admin", clickhouseDatabase);
export const clickhouseExternalClient = createClickhouseClient("external", clickhouseDatabase);

export const getQueryTimingStats = async (client: ClickHouseClient, queryId: string) => {
  // Flush logs to ensure system.query_log has latest query result.
  // Todo: for performance we should instead poll for this row to become available asynchronously after returning result. Flushed every 7.5 seconds by default
  await client.exec({
    query: "SYSTEM FLUSH LOGS",
    auth: {
      username: clickhouseAdminUser,
      password: clickhouseAdminPassword,
    },
  });
  const profile = await client.query({
    query: `
    SELECT
      ProfileEvents['CPUTimeMicroseconds'] / 1000 AS cpu_time_ms,
      ProfileEvents['RealTimeMicroseconds'] / 1000 AS wall_clock_time_ms
    FROM system.query_log
    WHERE query_id = {query_id:String} AND type = 'QueryFinish'
    ORDER BY event_time DESC
    LIMIT 1
  `,
    query_params: { query_id: queryId },
    auth: {
      username: clickhouseAdminUser,
      password: clickhouseAdminPassword,
    },
    format: "JSON",
  });

  const stats = await profile.json<{
    cpu_time_ms: number,
    wall_clock_time_ms: number,
  }>();
  if (stats.data.length !== 1) {
    throw new StackAssertionError("Unexpected number of query log results", { data: stats.data });
  }
  return stats.data[0];
};

