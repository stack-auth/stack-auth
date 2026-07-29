import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { getSafeClickhouseErrorMessage } from "@/lib/clickhouse-errors";
import { ClickHouseError } from "@clickhouse/client";
import type { Json } from "@hexclave/shared/dist/utils/json";

export const SQL_QUERY_RESULT_MAX_CHARS = 50_000;

type SqlQueryOptions = {
  branchId: string,
  projectId: string,
  query: string,
};

export async function executeSqlQuery({ branchId, projectId, query }: SqlQueryOptions) {
  const client = getClickhouseExternalClient();
  try {
    const resultSet = await client.query({
      query,
      clickhouse_settings: {
        SQL_project_id: projectId,
        SQL_branch_id: branchId,
        max_execution_time: 5,
        readonly: "1",
        allow_ddl: 0,
        max_result_rows: "10000",
        max_result_bytes: (10 * 1024 * 1024).toString(),
        result_overflow_mode: "throw",
      },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<Record<string, Json>[]>();
    const maxRowsForAi = 50;
    const truncated = rows.length > maxRowsForAi;
    const returnedRows = truncated ? rows.slice(0, maxRowsForAi) : rows;
    const response = {
      success: true as const,
      rowCount: returnedRows.length,
      totalRows: rows.length,
      truncated,
      ...(truncated
        ? { truncationNote: `Only the first ${maxRowsForAi} of ${rows.length} rows are shown. Add LIMIT or aggregate to see the rest.` }
        : {}),
      result: returnedRows,
    };
    const serialized = JSON.stringify(response);
    if (serialized.length > SQL_QUERY_RESULT_MAX_CHARS) {
      return {
        success: false as const,
        error:
          `Result too large: ${rows.length} rows, ${serialized.length} characters (limit ${SQL_QUERY_RESULT_MAX_CHARS}). ` +
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
      error: getSafeClickhouseErrorMessage(error, query),
    };
  }
}
