import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { getGrowthAdminReport, unpublishGrowthReport } from "@/lib/growth/report-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * One report as the customer reads it, and the pull-it-back control.
 *
 * GET returns the report through the same builder the customer route uses, only with the
 * published-only filter lifted, so staff can still read a report they have unpublished.
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
 * Unpublishing is staff error recovery, not part of any lifecycle — see unpublishGrowthReport. It
 * stays one explicit named action rather than a general PATCH over a status field, so that nothing
 * can arrive here as a side effect of editing something else.
 *
 * There is no "publish" counterpart: reports publish the moment the report phase writes them.
 */
export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["PATCH"]).defined(),
    params: yupObject({ report_id: yupString().defined() }).defined(),
    body: yupObject({
      target_project_id: yupString().defined(),
      action: yupString().oneOf(["unpublish"]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const tenancy = await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id);
    return { statusCode: 200, bodyType: "json", body: await unpublishGrowthReport(tenancy, params.report_id) };
  },
});
