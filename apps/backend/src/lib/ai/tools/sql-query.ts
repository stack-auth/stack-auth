import { tool } from "ai";
import { z } from "zod";
import { executeSqlQuery, SQL_QUERY_RESULT_MAX_CHARS } from "./sql-query-executor";

export { SQL_QUERY_RESULT_MAX_CHARS } from "./sql-query-executor";

export function createSqlQueryTool(targetProjectId?: string | null) {
  if (targetProjectId == null) {
    return null;
  }

  const projectId = targetProjectId;
  return tool({
    description: "Set and validate a ClickHouse SQL query for the analytics data grid. The grid runs the full query independently — you only receive a preview to confirm correctness. Only SELECT queries are allowed. Project filtering is automatic. Always include a LIMIT clause. Use SHOW TABLES to discover available tables and DESCRIBE TABLE <table_name> to see columns with types and descriptions.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The ClickHouse SQL query to execute. Only SELECT queries are allowed. Always include a LIMIT clause unless the system prompt tells you to do otherwise."),
    }),
    execute: async ({ query }: { query: string }) => await executeSqlQuery({ branchId: "main", projectId, query }),
  });
}
