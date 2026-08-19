import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { getGrowthAdminInterviewBody } from "@/lib/growth/interview-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * The question plan awaiting review for a customer project.
 *
 * There is no list route beside this one (unlike reports): a project has exactly one plan that
 * matters — the latest run's — and older runs' questions are history a reviewer cannot act on.
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
    body: await getGrowthAdminInterviewBody(await requireGrowthAdminTenancy(auth.project.id, auth.user, query.project_id)),
  }),
});
