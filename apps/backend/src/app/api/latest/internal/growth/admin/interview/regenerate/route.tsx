import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { retakeGrowthInterview } from "@/lib/growth/interview";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Throws the plan away and re-runs the questions phase, for a reviewer who does not want to edit
 * their way out of a bad plan.
 *
 * Deliberately the SAME function the customer's own retake uses rather than a staff variant: the
 * work is identical (re-arm the phase, keep every research finding), and a second implementation
 * would be a second place for the "hold the new plan again" rule to be forgotten.
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
  handler: async ({ auth, body }) => {
    const result = await retakeGrowthInterview(
      await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id),
      { allowHeld: true },
    );
    // Same snake_case ack as the customer's retake route: the plan is written asynchronously, so
    // there is nothing to return but "the reset landed, keep watching this run".
    return { statusCode: 200, bodyType: "json", body: { status: result.status, run_id: result.runId } };
  },
});
