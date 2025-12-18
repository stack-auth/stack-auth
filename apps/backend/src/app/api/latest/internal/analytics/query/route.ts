import { clickhouseExternalClient, getQueryTimingStats } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, jsonSchema, adminAuthTypeSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { randomUUID } from "crypto";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
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
    if (body.include_all_branches) {
      throw new StackAssertionError("include_all_branches is not supported yet");
    }
    const client = clickhouseExternalClient;
    const queryId = randomUUID();
    const resultSet = await Result.fromPromise(client.query({
      query: body.query,
      query_id: queryId,
      query_params: body.params,
      clickhouse_settings: {
        SQL_project_id: auth.tenancy.project.id,
        SQL_branch_id: auth.tenancy.branchId,
        max_execution_time: body.timeout_ms / 1000,
      },
      format: "JSONEachRow",
    }));

    if (resultSet.status === "error") {
      const message = resultSet.error instanceof Error ? resultSet.error.message : null;
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

