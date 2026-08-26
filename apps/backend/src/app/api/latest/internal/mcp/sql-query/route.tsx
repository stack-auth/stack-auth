import { authenticateMcpOAuthUser, ensureUserManagesProject } from "@/app/api/latest/internal/mcp/auth";
import { ANALYTICS_QUERY_DEFAULT_TIMEOUT_MS, ANALYTICS_QUERY_MAX_TIMEOUT_MS, runAnalyticsQuery } from "@/lib/analytics-queries";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { jsonSchema, yupArray, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

const MAX_SQL_QUERY_CHARS = 100_000;

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined().nonEmpty(),
      query: yupString().max(MAX_SQL_QUERY_CHARS).defined().nonEmpty(),
      timeout_ms: yupNumber().integer().min(1_000).max(ANALYTICS_QUERY_MAX_TIMEOUT_MS).default(ANALYTICS_QUERY_DEFAULT_TIMEOUT_MS),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      result: yupArray(jsonSchema.defined()).defined(),
      query_id: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ headers, body }) => {
    const user = await authenticateMcpOAuthUser(headers.authorization?.[0]);
    await ensureUserManagesProject(user, body.project_id);
    const tenancy = await getSoleTenancyFromProjectBranch(body.project_id, DEFAULT_BRANCH_ID);

    const { result, queryId } = await runAnalyticsQuery({
      tenancy,
      query: body.query,
      timeoutMs: body.timeout_ms,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        result,
        query_id: queryId,
      },
    };
  },
});
