import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { runGrowthDailyRollupForDate } from "@/lib/growth/orchestration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Runs the daily metrics rollup + brief creation for one UTC day of this branch. The lib enforces
 * the [today - 3d, yesterday] date window (400 outside it) and is idempotent: the brief's unique
 * (project, branch, date) is the day's claim, so repeated calls return the existing brief with
 * created: false.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      date: yupString().matches(/^\d{4}-\d{2}-\d{2}$/).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      brief_id: yupString().defined(),
      brief_status: yupString().defined(),
      created: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await runGrowthDailyRollupForDate({ tenancy: auth.tenancy, date: body.date });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        brief_id: result.briefId,
        brief_status: result.briefStatus,
        created: result.created,
      },
    };
  },
});
