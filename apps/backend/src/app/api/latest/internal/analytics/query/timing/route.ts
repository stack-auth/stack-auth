import { getClickhouseExternalClient, getQueryTimingStatsForProject, isClickhouseConfigured } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      query_id: yupString().defined().nonEmpty(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      stats: yupObject({
        cpu_time: yupNumber().defined(),
        wall_clock_time: yupNumber().defined(),
      }).defined(),
    }).defined(),
  }),
  async handler({ body, auth }) {
    if (!isClickhouseConfigured()) {
      throw new StackAssertionError("ClickHouse is not configured");
    }

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
