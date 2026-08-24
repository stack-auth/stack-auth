import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { submitQuizAnswer } from "@/lib/growth/games/quiz-rounds";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Grades one answer and returns the reveal.
 *
 * This is the only customer-facing endpoint that ever emits a correct_option_id, and it does so
 * strictly after the answer has been recorded — the round GET redacts it until then. Order and
 * single-use are enforced inside submitQuizAnswer against the stored answer rows, not from anything
 * the client sends.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
    params: yupObject({
      round_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      order_index: yupNumber().integer().min(0).defined(),
      option_id: yupString().min(1).max(64).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await submitQuizAnswer(auth.tenancy, params.round_id, {
      orderIndex: body.order_index,
      optionId: body.option_id,
      now: new Date(),
    });
    return { statusCode: 200, bodyType: "json", body: result };
  },
});
