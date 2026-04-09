import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { tool } from "ai";
import { z } from "zod";

export function createSqlQueryTool(auth: SmartRequestAuth | null, targetProjectId?: string | null) {
  if (auth == null) {
    return null;
  }

  const projectId = targetProjectId ?? auth.tenancy.project.id;
  const branchId = targetProjectId ? "main" : auth.tenancy.branchId;

  // Max rows returned to the model (backstop if LIMIT is missing).
  const MAX_ROWS_FOR_AI = 50;

  return tool({
    description: "Run a read-only ClickHouse SQL query against the project's analytics database for INSPECTION. Only SELECT queries are allowed. Project filtering is automatic. Results are capped at 50 rows for your context — always include a LIMIT clause and prefer aggregates (count, sum, min, max, avg, quantile, GROUP BY) over SELECT *.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The ClickHouse SQL query to execute. Only SELECT queries are allowed. Always include a LIMIT clause (≤20 for row samples)."),
    }),
    execute: async ({ query }: { query: string }) => {
      const client = getClickhouseExternalClient();
      return await client.query({
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
      })
        .then(async (resultSet) => {
          const rows = await resultSet.json<Record<string, unknown>[]>();
          const truncated = rows.length > MAX_ROWS_FOR_AI;
          const returnedRows = truncated ? rows.slice(0, MAX_ROWS_FOR_AI) : rows;
          return {
            success: true as const,
            rowCount: returnedRows.length,
            totalRows: rows.length,
            truncated,
            ...(truncated
              ? { truncationNote: `Only the first ${MAX_ROWS_FOR_AI} of ${rows.length} rows are shown. Add LIMIT or aggregate to see the rest.` }
              : {}),
            result: returnedRows,
          };
        })
        .catch((error: unknown) => ({
          success: false as const,
          error: error instanceof Error ? error.message : "Query failed",
        }));
    },
  });
}
