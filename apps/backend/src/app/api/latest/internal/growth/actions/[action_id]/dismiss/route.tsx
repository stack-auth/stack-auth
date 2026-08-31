import { dismissGrowthActionItem } from "@/lib/growth/actions";
import { requireGrowthInternalResourceAccess } from "@/lib/growth/customer-access";
import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { requireGrowthWorkspaceReleased } from "@/lib/growth/report-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
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
    requireGrowthInternalResourceAccess(auth.tenancy);
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    const result = await dismissGrowthActionItem(auth.tenancy, params.action_id);
    return { statusCode: 200, bodyType: "json", body: { status: result.status } };
  },
});
