import { createClient, type ClickHouseClient, type ClickHouseSettings } from "@clickhouse/client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { mapWithConcurrency } from "@hexclave/shared/dist/utils/promises";

// Re-exported so other modules can hold a typed ClickHouse client (e.g. to
// thread a single warmed client through helpers) without taking a direct
// dependency on the @clickhouse/client package.
export type { ClickHouseClient } from "@clickhouse/client";

/** Keep each encoded query parameter comfortably below ClickHouse's 128 KiB field limit. */
export const CLICKHOUSE_STRING_ID_PARAM_BYTE_BUDGET = 96 * 1024;
const CLICKHOUSE_STRING_ID_CHUNK_CONCURRENCY = 4;
type ClickHouseJsonQueryClient<Row> = {
  query: (params: {
    query: string,
    query_params: Record<string, unknown>,
    format: "JSONEachRow",
  }) => Promise<{
    json: () => Promise<Row[]>,
  }>,
};

function escapeClickhouseString(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    switch (character) {
      case "\t": {
        escaped += "\\t";
        break;
      }
      case "\n": {
        escaped += "\\n";
        break;
      }
      case "\r": {
        escaped += "\\r";
        break;
      }
      case "'": {
        escaped += "\\'";
        break;
      }
      case "\\": {
        escaped += "\\\\";
        break;
      }
      default: {
        escaped += character;
      }
    }
  }
  return escaped;
}

/** Mirrors clickhouse-js's Array(String) query-param serialization for byte budgeting. */
export function serializeClickHouseStringArrayParam(ids: readonly string[]): string {
  return `[${ids.map((id) => `'${escapeClickhouseString(id)}'`).join(",")}]`;
}

/**
 * Sort before chunking so each chunk is a contiguous project_id range in the
 * ClickHouse primary key. This keeps the chunks close to one ordered pass
 * instead of making every request scan unrelated primary-key ranges.
 */
export function chunkClickHouseStringIds(
  ids: readonly string[],
  parameterName: string,
): string[][] {
  if (parameterName.length === 0) {
    throw new HexclaveAssertionError("ClickHouse query parameter name must not be empty");
  }
  const sortedUniqueIds = [...new Set(ids)].sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentSerializedLength = 2;

  for (const id of sortedUniqueIds) {
    const serializedIdLength = Buffer.byteLength(`'${escapeClickhouseString(id)}'`, "utf8");
    const separatorLength = currentChunk.length === 0 ? 0 : 1;
    const nextLength = currentSerializedLength + separatorLength + serializedIdLength;
    if (currentChunk.length > 0 && nextLength > CLICKHOUSE_STRING_ID_PARAM_BYTE_BUDGET) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSerializedLength = 2;
    }
    currentChunk.push(id);
    currentSerializedLength += (currentChunk.length === 1 ? 0 : 1) + serializedIdLength;
    if (currentSerializedLength > CLICKHOUSE_STRING_ID_PARAM_BYTE_BUDGET) {
      throw new HexclaveAssertionError(
        `ClickHouse query parameter ${parameterName} exceeds its byte budget for one ID`,
        { parameterName, id, serializedParamLength: currentSerializedLength, byteBudget: CLICKHOUSE_STRING_ID_PARAM_BYTE_BUDGET },
      );
    }
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);
  for (const chunk of chunks) {
    const serializedParamLength = Buffer.byteLength(serializeClickHouseStringArrayParam(chunk), "utf8");
    if (serializedParamLength > CLICKHOUSE_STRING_ID_PARAM_BYTE_BUDGET) {
      throw new HexclaveAssertionError(
        `ClickHouse query parameter ${parameterName} exceeds its byte budget`,
        { parameterName, serializedParamLength, byteBudget: CLICKHOUSE_STRING_ID_PARAM_BYTE_BUDGET },
      );
    }
  }
  return chunks;
}

export async function queryClickHouseByStringIdChunks<Row>(
  client: ClickHouseJsonQueryClient<Row>,
  options: {
    query: string,
    parameterName: string,
    chunks: readonly (readonly string[])[],
    queryParams?: Record<string, unknown>,
  },
): Promise<Row[]> {
  const chunkRows = await mapWithConcurrency(options.chunks, CLICKHOUSE_STRING_ID_CHUNK_CONCURRENCY, async (ids) => {
    const result = await client.query({
      query: options.query,
      query_params: {
        ...options.queryParams,
        [options.parameterName]: ids,
      },
      format: "JSONEachRow",
    });
    return await result.json();
  });
  return chunkRows.flat();
}

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

// Safety net for heavy analytical reads against `analytics_internal.events`:
// GROUP BY spills to disk at ~50% of the per-query cap (leaving headroom for
// the post-spill merge), grace_hash partitions large join build sides instead
// of allocating one giant hash table, and the per-user cap bounds total
// concurrent memory against the cluster's 10.8 GiB OvercommitTracker. Values
// are decimal bytes (how ClickHouse parses digit strings).
//
// Note: max_memory_usage_for_user is enforced ClickHouse-side per *connecting
// user* (the shared `stackframe` admin), so all admin queries — not just this
// client's — count toward the same 9 GB budget. With the 30-day bounds each
// metrics query peaks well under 100 MiB, so practical interference is low.
export const METRICS_CLICKHOUSE_SETTINGS: ClickHouseSettings = {
  max_bytes_before_external_group_by: "256000000",
  max_memory_usage: "512000000",
  max_memory_usage_for_user: "9000000000",
  // SDK type narrows to a single algorithm; the server accepts a fallback list.
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
      throw new HexclaveAssertionError(`Unexpected number of query log results: ${stats.data.length}`, { data: stats.data });
    }
    if (attempt < retryDelaysMs.length) {
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }

  throw new HexclaveAssertionError("Unexpected number of query log results: 0", { data: [] });
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
      throw new HexclaveAssertionError(`Unexpected number of query log results: ${stats.data.length}`, { data: stats.data });
    }
    if (attempt < retryDelaysMs.length) {
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }

  return null;
};
