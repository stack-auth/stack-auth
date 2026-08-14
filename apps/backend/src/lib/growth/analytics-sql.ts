import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { getSafeClickhouseErrorMessage } from "@/lib/clickhouse-errors";
import { ClickHouseError } from "@clickhouse/client";

/**
 * Read-only, project/branch-scoped analytics SQL execution for the growth agent.
 *
 * This is a DELIBERATE COPY of the execution body inside the dashboard AI's `sql-query` tool
 * (lib/ai/tools/sql-query.ts), not a shared extraction. An earlier draft hoisted that body into a
 * common `lib/analytics-sql.ts` that both called, but that rewrote a tool growth does not own to
 * serve a growth feature. Growth is a bolt-on: the dashboard AI tool must behave exactly as it did
 * before growth existed, and deleting growth must not require putting anything back.
 *
 * The duplication is real and the settings block below is the important half of it — `SQL_project_id`
 * and `SQL_branch_id` are the tenant isolation boundary, and `readonly`/`allow_ddl` are what make it
 * safe to pass an agent-authored SELECT straight through. Those are pinned by analytics-sql.test.ts
 * so a copy that silently loses one fails a test instead of leaking across tenants. If you harden
 * the scoping in the AI tool, harden it here too.
 *
 * Note this helper does NOT restrict which COLUMNS may be selected. That belongs to the growth
 * agent route, not to project-scoped analytics in general, and lives in sql-privacy.ts.
 */

export const GROWTH_SQL_QUERY_RESULT_MAX_CHARS = 50_000;

// Max rows returned to the caller (backstop if the agent omits LIMIT).
const DEFAULT_MAX_ROWS = 50;

export type GrowthAnalyticsQueryResult =
  | {
    success: true,
    rowCount: number,
    totalRows: number,
    truncated: boolean,
    truncationNote?: string,
    result: Record<string, unknown>[],
  }
  | {
    success: false,
    error: string,
    rowCount?: number,
    characters?: number,
    columnsReturned?: string[],
  };

/**
 * The ClickHouse settings that make an untrusted SELECT safe to run. Split out as a named constant
 * so the test can assert on it directly rather than by scraping the query call.
 */
export function getGrowthAnalyticsClickhouseSettings(projectId: string, branchId: string) {
  return {
    SQL_project_id: projectId,
    SQL_branch_id: branchId,
    max_execution_time: 5,
    readonly: "1",
    allow_ddl: 0,
    max_result_rows: "10000",
    max_result_bytes: (10 * 1024 * 1024).toString(),
    result_overflow_mode: "throw",
  } as const;
}

export async function executeGrowthAnalyticsQuery(options: {
  query: string,
  projectId: string,
  branchId: string,
  maxRows?: number,
  maxChars?: number,
}): Promise<GrowthAnalyticsQueryResult> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxChars = options.maxChars ?? GROWTH_SQL_QUERY_RESULT_MAX_CHARS;
  const client = getClickhouseExternalClient();
  try {
    const resultSet = await client.query({
      query: options.query,
      clickhouse_settings: getGrowthAnalyticsClickhouseSettings(options.projectId, options.branchId),
      format: "JSONEachRow",
    });
    // The generic is the ROW type, not the array type: for JSONEachRow the client's
    // `ResultJSONType<T, F>` already resolves to `T[]`. Passing the array type here yields
    // `Record<string, unknown>[][]`, which is wrong on paper and right at runtime, and it makes
    // every consumer's row type a lie. (The AI tool still spells it the old way; not fixing that
    // here is the point — this file does not touch it.)
    const rows = await resultSet.json<Record<string, unknown>>();
    const truncated = rows.length > maxRows;
    const returnedRows = truncated ? rows.slice(0, maxRows) : rows;
    const response = {
      success: true as const,
      rowCount: returnedRows.length,
      totalRows: rows.length,
      truncated,
      ...(truncated
        ? { truncationNote: `Only the first ${maxRows} of ${rows.length} rows are shown. Add LIMIT or aggregate to see the rest.` }
        : {}),
      result: returnedRows,
    };
    const serialized = JSON.stringify(response);
    if (serialized.length > maxChars) {
      return {
        success: false as const,
        error:
          `Result too large: ${rows.length} rows, ${serialized.length} characters (limit ${maxChars}). ` +
          `To fix: ` +
          `(1) Use aggregation (COUNT, uniqExact, GROUP BY, topK, quantile) instead of fetching rows. ` +
          `(2) If you need rows, add a WHERE clause or reduce LIMIT. ` +
          `(3) Select only the columns you need — avoid the 'data' column on events unless essential.`,
        rowCount: rows.length,
        characters: serialized.length,
        columnsReturned: rows.length > 0 ? Object.keys(rows[0]) : [],
      };
    }
    return response;
  } catch (error) {
    if (!(error instanceof ClickHouseError)) {
      throw error;
    }
    return {
      success: false as const,
      error: getSafeClickhouseErrorMessage(error, options.query),
    };
  }
}
