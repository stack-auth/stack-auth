import { createClient, type ClickHouseClient, type ClickHouseSettings } from "@clickhouse/client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

function getAdminAuth() {
  return {
    username: getEnvVariable("STACK_CLICKHOUSE_ADMIN_USER", "stackframe"),
    password: getEnvVariable("STACK_CLICKHOUSE_ADMIN_PASSWORD"),
  };
}

export function createClickhouseClient(
  authType: "admin" | "external",
  database?: string,
  clickhouse_settings?: ClickHouseSettings,
) {
  return createClient({
    url: getEnvVariable("STACK_CLICKHOUSE_URL"),
    ...authType === "admin" ? getAdminAuth() : {
      username: "limited_user",
      password: getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_PASSWORD"),
    },
    database,
    request_timeout: 10 * 60 * 1000, // 10 minutes
    clickhouse_settings,
  });
}

export function getClickhouseAdminClient() {
  return createClickhouseClient("admin", getEnvVariable("STACK_CLICKHOUSE_DATABASE", "default"));
}

export function getClickhouseExternalClient() {
  return createClickhouseClient("external", getEnvVariable("STACK_CLICKHOUSE_DATABASE", "default"));
}

// Safety net against the ClickHouse OvercommitTracker killing heavy analytical
// reads (Sentry STACK-BACKEND-16H). Use this client for any handler that fans
// out multiple `GROUP BY user_id`-style queries against `analytics_internal.events`.
// Values are decimal bytes (ClickHouse's native interpretation of digit strings);
// 1 GB = 1_000_000_000.
//
//   max_bytes_before_external_group_by (6 GB ≈ 5.59 GiB)
//     GROUP BY hash tables spill to disk when they exceed this size instead of
//     growing without bound. Targets the unbounded `GROUP BY user_id` patterns
//     (analyticsUserJoin, loadUsersByCountry, the splits) which were
//     materializing one row per ever-seen user.
//
//   max_memory_usage (8 GB ≈ 7.45 GiB)
//     Hard per-query ceiling.
//
//   max_memory_usage_for_user (9 GB ≈ 8.38 GiB)
//     Per-user aggregate across concurrent queries — the bound that actually
//     protects against the OvercommitTracker. /internal/metrics fans out to
//     ~12 ClickHouse queries via nested Promise.all; a per-query cap alone
//     (12 × 8 GB = 96 GB theoretical) doesn't prevent the cluster-wide kill.
//     This per-user cap forces the fan-out to share a single 9 GB budget
//     against the cluster's 10.8 GiB ceiling. The trade vs no-cap: a single
//     query above 9 GB now fails with a clean "memory limit exceeded" error
//     rather than triggering an OvercommitTracker kill of a random concurrent
//     query.
//
//   join_algorithm = 'grace_hash,parallel_hash,hash'
//     ClickHouse picks the first applicable algorithm from this list. For our
//     analyticsUserJoin shape (LEFT JOIN with a GROUP BY subquery as the
//     build side), grace_hash partitions the build side instead of building
//     one giant hash table — measured ~48% memory reduction vs the default
//     parallel_hash, at zero latency cost (benchmark: BENCH_JOIN_ALGO_COMPARE=1
//     in scripts/benchmark-internal-metrics.ts). parallel_hash and hash are
//     fallbacks for join shapes grace_hash doesn't support; ClickHouse falls
//     back automatically.
//
// These are belt-and-suspenders. The actual fix for the OOM is bounding the
// `event_at` scans (option A) and eventually backfilling `is_anonymous` onto
// page-view/click events (option C) — see /internal/metrics/route.tsx for the
// long-form discussion.
export const METRICS_CLICKHOUSE_SETTINGS: ClickHouseSettings = {
  max_bytes_before_external_group_by: "6000000000",
  max_memory_usage: "8000000000",
  max_memory_usage_for_user: "9000000000",
  // The @clickhouse/client-common JoinAlgorithm type is a union of single
  // algorithm names, but the ClickHouse server accepts a comma-separated
  // fallback list (tries each in order). The cast widens the SDK type so we
  // can use the fallback form, which is what we actually want for safety.
  join_algorithm: "grace_hash,parallel_hash,hash" as ClickHouseSettings["join_algorithm"],
};

export function getClickhouseAdminClientForMetrics() {
  return createClickhouseClient(
    "admin",
    getEnvVariable("STACK_CLICKHOUSE_DATABASE", "default"),
    METRICS_CLICKHOUSE_SETTINGS,
  );
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
