import { getPlanUsageForProject } from "@/lib/plan-usage";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const planUsageRowSchema = yupObject({
  item_id: yupString().oneOf(Object.values(ITEM_IDS)).defined(),
  display_name: yupString().defined(),
  kind: yupString().oneOf(["current", "metered", "capability"]).defined(),
  used: yupNumber().integer().nullable().defined(),
  limit: yupNumber().integer().nullable().defined(),
  remaining: yupNumber().integer().nullable().defined(),
  overage: yupNumber().integer().nullable().defined(),
  is_unlimited: yupBoolean().defined(),
}).defined();

const planUsageResponseSchema = yupObject({
  owner_team_id: yupString().uuid().defined(),
  owner_team_display_name: yupString().defined(),
  plan_id: yupString().oneOf(["free", "team", "growth"]).defined(),
  plan_display_name: yupString().defined(),
  period_start_millis: yupNumber().integer().defined(),
  period_end_millis: yupNumber().integer().defined(),
  next_plan_id: yupString().oneOf(["team", "growth"]).nullable().defined(),
  rows: yupArray(planUsageRowSchema).defined(),
}).defined();

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: planUsageResponseSchema,
  }),
  handler: async (req) => {
    return {
      statusCode: 200,
      bodyType: "json",
      body: await getPlanUsageForProject(req.auth.tenancy.project),
    };
  },
});
