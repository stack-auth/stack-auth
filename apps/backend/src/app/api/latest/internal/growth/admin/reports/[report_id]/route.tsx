import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { getGrowthAdminReport, publishGrowthReport, unpublishGrowthReport } from "@/lib/growth/report-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * One report as the reviewer reads it, and the release control itself.
 *
 * GET returns the report through the same builder the customer route uses, only with the
 * published-only filter lifted: a reviewer must approve the actual artefact, not a staff-only
 * rendering of it.
 */
export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
    params: yupObject({
      // Not .uuid(): non-UUID values 404 inside the lib, keeping the miss shape identical whether
      // the id is malformed or belongs to another project.
      report_id: yupString().defined(),
    }).defined(),
    query: yupObject({ project_id: yupString().defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, query }) => ({
    statusCode: 200,
    bodyType: "json",
    body: await getGrowthAdminReport(await requireGrowthAdminTenancy(auth.project.id, auth.user, query.project_id), params.report_id),
  }),
});

/**
 * Publishing is what unlocks the whole customer workspace for a project, so it is one explicit
 * action rather than a general PATCH over a status field. "unpublish" is the staff undo — see
 * unpublishGrowthReport for why it exists.
 */
export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["PATCH"]).defined(),
    params: yupObject({ report_id: yupString().defined() }).defined(),
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
      ? await publishGrowthReport(tenancy, params.report_id, { publishedByUserId: auth.user?.id ?? null, now: new Date() })
      : await unpublishGrowthReport(tenancy, params.report_id);
    return { statusCode: 200, bodyType: "json", body: result };
  },
});
