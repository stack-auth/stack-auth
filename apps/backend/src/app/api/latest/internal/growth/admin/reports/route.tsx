import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { listGrowthAdminReports } from "@/lib/growth/report-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * The Growth admin Reports card: every report this project has, published or awaiting review.
 *
 * Metadata only — report documents are long and staff read one at a time, so the body comes from
 * the sibling [report_id] route. Platform-admin auth like every other route in this directory: a
 * Hexclave staff user acting inside the `internal` project, with the customer project named in the
 * query, and `requireGrowthAdminTenancy` doing the admin check plus tenancy resolution.
 */
export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
    query: yupObject({ project_id: yupString().defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, query }) => ({
    statusCode: 200,
    bodyType: "json",
    body: await listGrowthAdminReports(await requireGrowthAdminTenancy(auth.project.id, auth.user, query.project_id)),
  }),
});
