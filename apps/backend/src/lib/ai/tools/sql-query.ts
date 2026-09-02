import { READ_ONLY_SQL_CLICKHOUSE_SETTINGS, resolveAnalyticsQueryTarget } from "@/lib/analytics-query-target";
import { getSafeClickhouseErrorMessage } from "@/lib/clickhouse-errors";
import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { ClickHouseError } from "@clickhouse/client";
import { tool } from "ai";
import { z } from "zod";

export const SQL_QUERY_RESULT_MAX_CHARS = 50_000;

export function createSqlQueryTool(targetProjectId?: string | null) {
  if (targetProjectId == null) {
    return null;
  }

  const projectId = targetProjectId;
  const branchId = "main";

  // Max rows returned to the model (backstop if LIMIT is missing).
  const MAX_ROWS_FOR_AI = 50;

  return tool({
    description: `Set and validate a ClickHouse SQL query for the analytics data grid. The grid runs the full query independently — you only receive a preview of the first ${MAX_ROWS_FOR_AI} rows to confirm correctness. Only SELECT queries are allowed. Project filtering is automatic. Always include a LIMIT clause. Use SHOW TABLES to discover available tables and DESCRIBE TABLE <table_name> to see columns with types and descriptions.`,
    inputSchema: z.object({
      query: z
        .string()
        .describe("The ClickHouse SQL query to execute. Only SELECT queries are allowed. Always include a LIMIT clause unless the system prompt tells you to do otherwise."),
    }),
    execute: async ({ query }: { query: string }) => {
      // Resolved per call rather than when the tool is built: a project can
      // provision a warehouse mid-conversation, and the answer decides which
      // database the model is even looking at.
      const tenancy = await getSoleTenancyFromProjectBranch(projectId, branchId, true);
      if (tenancy == null) {
        return { success: false as const, error: `No such project: ${projectId}` };
      }
      const target = await resolveAnalyticsQueryTarget(tenancy);
      const client = target.client;
      try {
        const resultSet = await client.query({
          query,
          clickhouse_settings: {
            ...target.scopeSettings,
            ...READ_ONLY_SQL_CLICKHOUSE_SETTINGS,
            max_execution_time: 5,
            max_result_rows: "10000",
            max_result_bytes: (10 * 1024 * 1024).toString(),
          },
          format: "JSONEachRow",
        });
        const rows = await resultSet.json<Record<string, unknown>[]>();
        const truncated = rows.length > MAX_ROWS_FOR_AI;
        const returnedRows = truncated ? rows.slice(0, MAX_ROWS_FOR_AI) : rows;
        const response = {
          success: true as const,
          rowCount: returnedRows.length,
          totalRows: rows.length,
          truncated,
          ...(truncated
            ? { truncationNote: `Only the first ${MAX_ROWS_FOR_AI} of ${rows.length} rows are shown. Add LIMIT or aggregate to see the rest.` }
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
      } finally {
        // The shared client is reused across requests; a warehouse client is
        // built per call, so close it to release its sockets.
        if (target.isWarehouse) {
          await client.close();
        }
      }
    },
  });
}
