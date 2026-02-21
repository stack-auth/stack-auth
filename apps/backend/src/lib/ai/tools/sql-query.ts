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
    description: `Run a ClickHouse SQL query against the project's analytics database.

**CRITICAL**: Only SELECT queries are allowed. Project filtering is automatic - do not add WHERE project_id = ... clauses.

**Available Tables:**

**events** - User activity events
- event_type: LowCardinality(String) - $token-refresh is the only valid event_type right now, it occurs whenever an access token is refreshed
- event_at: DateTime64(3, 'UTC') - When the event occurred
- data: JSON - Additional event data
- user_id: Nullable(String) - Associated user ID
- team_id: Nullable(String) - Associated team ID
- created_at: DateTime64(3, 'UTC') - When the record was created

**users** - User profiles
- id: UUID - User ID
- display_name: Nullable(String) - User's display name
- primary_email: Nullable(String) - User's primary email
- primary_email_verified: UInt8 - Whether email is verified (0/1)
- signed_up_at: DateTime64(3, 'UTC') - When user signed up
- client_metadata: JSON - Client-side metadata
- client_read_only_metadata: JSON - Read-only client metadata
- server_metadata: JSON - Server-side metadata
- is_anonymous: UInt8 - Whether user is anonymous (0/1)

**Query Guidelines:**
- Always include LIMIT clause (default to LIMIT 100)
- Use appropriate date functions: toDate(), toStartOfDay(), toStartOfWeek(), etc.
- For counting: COUNT(*) or COUNT(DISTINCT column)
- Only SELECT queries allowed - no DDL/DML

**Example Queries:**
- Count users: SELECT COUNT(*) FROM users
- Recent signups: SELECT * FROM users ORDER BY signed_up_at DESC LIMIT 10
- Events today: SELECT COUNT(*) FROM events WHERE toDate(event_at) = today()
- Event types: SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC LIMIT 10`,
    inputSchema: z.object({
      query: z
        .string()
        .describe("The ClickHouse SQL query to execute. Only SELECT queries are allowed. Always include LIMIT clause."),
    }),
    execute: async ({ query }: { query: string }) => {
      try {
        const client = getClickhouseExternalClient();
        const resultSet = await client.query({
          query,
          clickhouse_settings: {
            SQL_project_id: auth.tenancy.project.id,
            SQL_branch_id: auth.tenancy.branchId,
            max_execution_time: 5, // 5 seconds timeout
            readonly: "1",
            allow_ddl: 0,
            max_result_rows: "10000",
            max_result_bytes: (10 * 1024 * 1024).toString(), // 10MB
            result_overflow_mode: "throw",
          },
          format: "JSONEachRow",
        });

        const rows = await resultSet.json<Record<string, unknown>[]>();

        return {
          success: true,
          rowCount: rows.length,
          result: rows,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Query failed",
        };
      }
    },
  });
}
