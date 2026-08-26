import { ANALYTICS_QUERY_DEFAULT_TIMEOUT_MS, ANALYTICS_QUERY_MAX_TIMEOUT_MS, runAnalyticsQuery } from "@/lib/analytics-queries";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, jsonSchema, serverOrHigherAuthTypeSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Run analytics query",
    description: "Runs a read-only ClickHouse SQL query against the current project's analytics dataset.",
    tags: ["Analytics"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      include_all_branches: yupBoolean().oneOf([false]).default(false).meta({ openapiField: { description: "Reserved for future branch-wide analytics queries. Must be false.", exampleValue: false } }),
      query: yupString().defined().nonEmpty().meta({ openapiField: { description: "A read-only ClickHouse SQL query.", exampleValue: "SELECT count() AS event_count FROM events" } }),
      params: yupRecord(yupString().defined(), yupMixed().defined()).default({}).meta({ openapiField: { description: "ClickHouse query parameters referenced by the query.", exampleValue: { event_type: "$page-view" } } }),
      timeout_ms: yupNumber().integer().min(1_000).max(ANALYTICS_QUERY_MAX_TIMEOUT_MS).default(ANALYTICS_QUERY_DEFAULT_TIMEOUT_MS).meta({ openapiField: { description: "Maximum query execution time in milliseconds. The effective timeout is also capped by the project's plan.", exampleValue: ANALYTICS_QUERY_DEFAULT_TIMEOUT_MS } }),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      result: yupArray(jsonSchema.defined()).defined().meta({ openapiField: { description: "Query result rows as plain JSON objects.", exampleValue: [{ event_count: 42 }] } }),
      query_id: yupString().defined().meta({ openapiField: { description: "The ClickHouse query ID. Use it to fetch query timing stats.", exampleValue: "00000000-0000-0000-0000-000000000000:main:00000000-0000-0000-0000-000000000001" } }),
    }).defined(),
  }),
  async handler({ body, auth }) {
    const { result, queryId } = await runAnalyticsQuery({
      tenancy: auth.tenancy,
      query: body.query,
      params: body.params,
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
