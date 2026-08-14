import { executeProjectScopedAnalyticsQuery } from "@/lib/analytics-sql";
import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { buildIdentifyingColumnsError, findIdentifyingColumns } from "@/lib/growth/sql-privacy";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

// Growth-agent machine route: auth is a shared machine secret checked inside
// authenticateGrowthAgentRequest, so the smart handler's own auth is opted out (like
// internal/workflow-engine-step). The authorization tuple is optional so a missing header falls
// through to the helper's clean 401 instead of a schema validation error.
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      // 100k chars comfortably fits any sane analytical SELECT while bounding request abuse.
      query: yupString().max(100_000).defined(),
      max_rows: yupNumber().integer().min(1).max(200).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ headers, body }) => {
    await authenticateGrowthAgentRequest({
      authorizationHeader: headers.authorization?.[0],
      projectId: body.project_id,
      branchId: body.branch_id,
    });
    const result = await executeProjectScopedAnalyticsQuery({
      query: body.query,
      projectId: body.project_id,
      branchId: body.branch_id,
      maxRows: body.max_rows,
    });
    // Personal identifiers never leave for the model, however the query was phrased. Checked on the
    // RESULT rather than the query text because that is the only place aliases, expressions, and
    // `SELECT *` all resolve to the same thing — see lib/growth/sql-privacy.ts. Returned in the
    // existing `success: false` shape so the agent rewrites the query rather than hitting a wall.
    if (result.success) {
      const identifyingColumns = findIdentifyingColumns(result.result);
      if (identifyingColumns.length > 0) {
        return {
          statusCode: 200,
          bodyType: "json",
          body: { success: false, error: buildIdentifyingColumnsError(identifyingColumns) },
        } as const;
      }
    }
    // Query failures (syntax errors, too-large results, ...) are agent feedback, not HTTP failures:
    // the agent reads the error string and adjusts its query, so both variants are a 200. Field
    // names are the snake_case mirror of ProjectScopedAnalyticsQueryResult.
    return {
      statusCode: 200,
      bodyType: "json",
      body: result.success
        ? {
          success: true,
          row_count: result.rowCount,
          total_rows: result.totalRows,
          truncated: result.truncated,
          ...(result.truncationNote != null ? { truncation_note: result.truncationNote } : {}),
          rows: result.result,
        }
        : {
          success: false,
          error: result.error,
          ...(result.rowCount != null ? { row_count: result.rowCount } : {}),
          ...(result.characters != null ? { characters: result.characters } : {}),
          ...(result.columnsReturned != null ? { columns_returned: result.columnsReturned } : {}),
        },
    };
  },
});
