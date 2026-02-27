import { getClickhouseExternalClient } from "@/lib/clickhouse";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { tool } from "ai";
import { z } from "zod";

export function createSqlQueryTool(auth: SmartRequestAuth | null) {
  if (auth == null) {
    // Return null or throw - analytics queries require authentication
    return null;
  }

  return tool({
    description: "Run a ClickHouse SQL query against the project's analytics database. Only SELECT queries are allowed. Project filtering is automatic.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The ClickHouse SQL query to execute. Only SELECT queries are allowed. Always include LIMIT clause."),
    }),
    execute: async ({ query }: { query: string }) => {
      const client = getClickhouseExternalClient();
      return await client.query({
        query,
        clickhouse_settings: {
          SQL_project_id: auth.tenancy.project.id,
          SQL_branch_id: auth.tenancy.branchId,
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
          return {
            success: true as const,
            rowCount: rows.length,
            result: rows,
          };
        })
        .catch((error: unknown) => ({
          success: false as const,
          error: error instanceof Error ? error.message : "Query failed",
        }));
    },
  });
}
