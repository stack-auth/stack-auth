import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

const clickhouseUrl = getEnvVariable("CLICKHOUSE_URL");
const clickhouseUser = getEnvVariable("CLICKHOUSE_USER");
const clickhousePassword = getEnvVariable("CLICKHOUSE_PASSWORD");
const clickhouseDatabase = getEnvVariable("CLICKHOUSE_DATABASE");

export function createClickhouseClient(timeoutMs: number) {
  return createClient({
    url: clickhouseUrl,
    username: clickhouseUser,
    password: clickhousePassword,
    database: clickhouseDatabase,
    request_timeout: timeoutMs,
  });
}


export const getQueryTimingStats = async (client: ClickHouseClient, queryId: string) => {
  // Flush logs to ensure system.query_log has latest query result.
  // Todo: research performance impact of this vs polling vs setting query_log_flush_interval_milliseconds
  await client.exec({ query: "SYSTEM FLUSH LOGS" });
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
    format: "JSON",
  });

  const stats = await profile.json<{
    cpu_time_ms: number,
    wall_clock_time_ms: number,
  }>();
  return stats.data[0];
};

