import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import {
  publishGrowthReportPresentation,
  unpublishGrowthReportPresentation,
} from "@/lib/growth/report-presentation";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({
  type: clientOrHigherAuthTypeSchema.defined(),
  project: adaptSchema.defined(),
  user: adaptSchema,
}).defined();

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    method: yupString().oneOf(["PATCH"]).defined(),
    params: yupObject({
      report_id: yupString().defined(),
      presentation_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      target_project_id: yupString().defined(),
      action: yupString().oneOf(["publish", "unpublish"]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const tenancy = await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id);
    const result = body.action === "publish"
      ? await publishGrowthReportPresentation({
        tenancy,
        reportId: params.report_id,
        presentationId: params.presentation_id,
        publishedByUserId: auth.user?.id ?? null,
      })
      : await unpublishGrowthReportPresentation({
        tenancy,
        reportId: params.report_id,
        presentationId: params.presentation_id,
      });
    return { statusCode: 200, bodyType: "json", body: result };
  },
});
