import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

function getAdminAuth() {
  return {
    username: getEnvVariable("STACK_CLICKHOUSE_ADMIN_USER", "stackframe"),
    password: getEnvVariable("STACK_CLICKHOUSE_ADMIN_PASSWORD"),
  };
}

export function createClickhouseClient(authType: "admin" | "external", database?: string) {
  return createClient({
    url: getEnvVariable("STACK_CLICKHOUSE_URL"),
    ...authType === "admin" ? getAdminAuth() : {
      username: "limited_user",
      password: getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_PASSWORD"),
    },
    database,
  });
}

export function getClickhouseAdminClient() {
  return createClickhouseClient("admin", getEnvVariable("STACK_CLICKHOUSE_DATABASE", "default"));
}

export function getClickhouseExternalClient() {
  return createClickhouseClient("external", getEnvVariable("STACK_CLICKHOUSE_DATABASE", "default"));
}

export const getQueryTimingStats = async (client: ClickHouseClient, queryId: string) => {
  // Flush logs to ensure system.query_log has latest query result.
  // Todo: for performance we should instead poll for this row to become available asynchronously after returning result. Flushed every 7.5 seconds by default
  await client.exec({
    query: "SYSTEM FLUSH LOGS",
    auth: getAdminAuth(),
  });
  const queryProfile = async () => {
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
      auth: getAdminAuth(),
      format: "JSON",
    });

    return await profile.json<{
      cpu_time_ms: number,
      wall_clock_time_ms: number,
    }>();
  };

  const retryDelaysMs = [75, 150, 300, 600, 1200];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const stats = await queryProfile();
    if (stats.data.length === 1) {
      return stats.data[0];
    }
    if (stats.data.length > 1) {
      throw new StackAssertionError(`Unexpected number of query log results: ${stats.data.length}`, { data: stats.data });
    }
    if (attempt < retryDelaysMs.length) {
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }

  throw new StackAssertionError("Unexpected number of query log results: 0", { data: [] });
};

export const getQueryTimingStatsForProject = async (
  client: ClickHouseClient,
  queryId: string,
) => {
  const queryProfile = async () => {
    const profile = await client.query({
      query: `
      SELECT
        ProfileEvents['CPUTimeMicroseconds'] / 1000 AS cpu_time_ms,
        ProfileEvents['RealTimeMicroseconds'] / 1000 AS wall_clock_time_ms
      FROM system.query_log
      WHERE query_id = {query_id:String}
        AND type = 'QueryFinish'
      ORDER BY event_time DESC
      LIMIT 1
    `,
      query_params: {
        query_id: queryId,
      },
      auth: getAdminAuth(),
      format: "JSON",
    });

    return await profile.json<{
      cpu_time_ms: number,
      wall_clock_time_ms: number,
    }>();
  };

  const retryDelaysMs = [75, 150, 300, 600, 1200, 2400, 4800];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const stats = await queryProfile();
    if (stats.data.length === 1) {
      return stats.data[0];
    }
    if (stats.data.length > 1) {
      throw new StackAssertionError(`Unexpected number of query log results: ${stats.data.length}`, { data: stats.data });
    }
    if (attempt < retryDelaysMs.length) {
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }

  return null;
};
