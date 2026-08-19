import { getGrowthReportBody } from "@/lib/growth/actions";
import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
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
      // Not .uuid(): the sentinel "latest" resolves to the tenancy's newest report. Non-UUID,
      // non-"latest" values 404 inside getGrowthReportBody.
      report_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    requireGrowthAppEnabled(auth.tenancy);
    // No requireGrowthWorkspaceReleased here: the published-only lookup IS the gate for this route.
    // An unreviewed report 404s exactly like a report that does not exist, which is the right shape —
    // the customer has nothing to distinguish "not written yet" from "written, not released", and
    // should not.
    const body = await getGrowthReportBody(auth.tenancy, params.report_id, { publishedOnly: true });
    return { statusCode: 200, bodyType: "json", body };
  },
});
