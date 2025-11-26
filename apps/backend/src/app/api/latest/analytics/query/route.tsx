import { createClickhouseClient, getQueryTimingStats } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, jsonSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { randomUUID } from "crypto";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Execute analytics query",
    description: "Execute a ClickHouse query against the analytics database",
    tags: ["Analytics"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      include_all_branches: yupBoolean().default(false),
      query: yupString().defined().nonEmpty(),
      params: yupRecord(yupString().defined(), yupMixed().defined()).default({}),
      timeout_ms: yupNumber().integer().min(1).max(60000).default(1000),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      result: jsonSchema.defined(),
      stats: yupObject({
        cpu_time: yupNumber().defined(),
        wall_clock_time: yupNumber().defined(),
      }).defined(),
    }).defined(),
  }),
  async handler({ body, auth }) {
    const client = createClickhouseClient("external", body.timeout_ms);
    const queryId = randomUUID();
    const resultSet = await Result.fromPromise(client.query({
      query: body.query,
      query_id: queryId,
      query_params: body.params,
      clickhouse_settings: {
        SQL_tenancy_id: auth.tenancy.id,
      },
      format: "JSONEachRow",
    }));

    if (resultSet.status === "error") {
      const message = resultSet.error instanceof Error ? resultSet.error.message : null;
      if (message === "Timeout error.") {
        throw new KnownErrors.AnalyticsQueryTimeout(body.timeout_ms);
      }
      throw new KnownErrors.AnalyticsQueryError(message ?? "Unknown error");
    }

    const rows = await resultSet.data.json<Record<string, unknown>[]>();
    const stats = await getQueryTimingStats(client, queryId);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        result: rows,
        stats: {
          cpu_time: stats.cpu_time_ms,
          wall_clock_time: stats.wall_clock_time_ms,
        },
      },
    };
  },
});

