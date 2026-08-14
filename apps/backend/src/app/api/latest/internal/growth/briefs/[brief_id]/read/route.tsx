import { markGrowthBriefReadBody } from "@/lib/growth/briefs";
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
      // Not .uuid(): non-UUID values 404 inside markGrowthBriefReadBody, keeping the miss shape
      // identical to the sibling GET route.
      brief_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    requireGrowthAppEnabled(auth.tenancy);
    await requireGrowthWorkspaceReleased(auth.tenancy);
    const result = await markGrowthBriefReadBody(auth.tenancy, params.brief_id);
    // Ack shape per the frozen dashboard contract: mutations that leave a resource behind return
    // that resource's resulting status.
    return { statusCode: 200, bodyType: "json", body: { status: result.status } };
  },
});
