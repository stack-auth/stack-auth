import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { createGrowthUserMilestone, listGrowthMilestonesBody } from "@/lib/growth/milestones";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const body = await listGrowthMilestonesBody(auth.tenancy);
    return { statusCode: 200, bodyType: "json", body };
  },
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      // Validated against GROWTH_METRIC_IDS (and threshold positivity) in the lib function, so the
      // errors read the same whichever entry point performs the write.
      metric_id: yupString().defined(),
      threshold: yupNumber().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const item = await createGrowthUserMilestone(auth.tenancy, {
      metricId: body.metric_id,
      threshold: body.threshold,
    });
    return { statusCode: 200, bodyType: "json", body: item };
  },
});
