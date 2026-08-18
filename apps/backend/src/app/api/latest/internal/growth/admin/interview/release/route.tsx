import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { releaseGrowthInterview } from "@/lib/growth/interview-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Releasing is what lets a customer start their interview — and therefore what starts the chain
 * that ends with a report on their dashboard. It is one explicit action rather than a PATCH over a
 * status field, so it can never happen as a side effect of saving an edit.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({ target_project_id: yupString().defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, body }) => ({
    statusCode: 200,
    bodyType: "json",
    body: await releaseGrowthInterview(
      await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id),
      { releasedByUserId: auth.user?.id ?? null, now: new Date() },
    ),
  }),
});
