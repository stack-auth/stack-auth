import { getGrowthActionMetricsBody } from "@/lib/growth/actions";
import { requireGrowthInternalResourceAccess } from "@/lib/growth/customer-access";
import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
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
    params: yupObject({
      action_id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    requireGrowthAppEnabled(auth.tenancy);
    requireGrowthInternalResourceAccess(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    const body = await getGrowthActionMetricsBody(auth.tenancy, params.action_id, new Date());
    return { statusCode: 200, bodyType: "json", body };
  },
});
