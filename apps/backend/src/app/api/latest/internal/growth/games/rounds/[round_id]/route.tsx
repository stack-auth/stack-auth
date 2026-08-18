import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { getQuizRoundBody } from "@/lib/growth/games/quiz-rounds";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Fetches (or resumes) one round. The body is redacted by toWireQuestion: questions the player has
 * not answered yet carry their prompt and options and nothing else.
 */
export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
    params: yupObject({
      // Not .uuid(): non-UUID values 404 inside getQuizRoundBody, keeping the miss shape identical
      // whether the id is malformed, absent, or another project's.
      round_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params }) => {
    requireGrowthAppEnabled(auth.tenancy);
    return { statusCode: 200, bodyType: "json", body: await getQuizRoundBody(auth.tenancy, params.round_id) };
  },
});
