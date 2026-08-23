import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { getGrowthStatusBody } from "@/lib/growth/dashboard";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * The selected project's lifecycle status, for the admin workspace. Deliberately the same body the
 * customer's own `/status` returns: the admin page shows the customer's lifecycle, so a second
 * shape here would be a second source of truth about which phase a project is in.
 */
export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    query: yupObject({ project_id: yupString().defined() }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() }),
  handler: async ({ auth, query }) => ({
    statusCode: 200,
    bodyType: "json",
    body: await getGrowthStatusBody(await requireGrowthAdminTenancy(auth.project.id, auth.user, query.project_id)),
  }),
});
