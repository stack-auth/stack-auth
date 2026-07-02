import { getClickhouseExternalClient, getQueryTimingStatsForProject } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Get analytics query timing",
    description: "Returns CPU and wall-clock timing stats for a previously run analytics query.",
    tags: ["Analytics"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      query_id: yupString().defined().nonEmpty().meta({ openapiField: { description: "The query_id returned from POST /analytics/query.", exampleValue: "00000000-0000-0000-0000-000000000000:main:00000000-0000-0000-0000-000000000001" } }),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      stats: yupObject({
        cpu_time: yupNumber().defined().meta({ openapiField: { description: "ClickHouse CPU time in milliseconds.", exampleValue: 12 } }),
        wall_clock_time: yupNumber().defined().meta({ openapiField: { description: "ClickHouse wall-clock time in milliseconds.", exampleValue: 18 } }),
      }).defined(),
    }).defined(),
  }),
  async handler({ body, auth }) {
    const expectedPrefix = `${auth.tenancy.project.id}:${auth.tenancy.branchId}:`;
    if (!body.query_id.startsWith(expectedPrefix)) {
      throw new KnownErrors.ItemNotFound(body.query_id);
    }

    const client = getClickhouseExternalClient();
    const stats = await getQueryTimingStatsForProject(client, body.query_id);

    if (!stats) {
      throw new KnownErrors.ItemNotFound(body.query_id);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        stats: {
          cpu_time: stats.cpu_time_ms,
          wall_clock_time: stats.wall_clock_time_ms,
        },
      },
    };
  },
});
