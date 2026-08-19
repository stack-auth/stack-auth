import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { startQuizRound } from "@/lib/growth/games/quiz-rounds";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Starts a round of the published game — or returns the one already in progress, which is why this
 * is safe to call every time the customer opens the quiz dialog.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
      // Optional (no .defined()): admin-key requests carry no user. The id is recorded for the
      // "played by" label only and is never a query key, so its absence is not an error.
      user: adaptSchema,
    }),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const round = await startQuizRound(auth.tenancy, { playedByUserId: auth.user?.id ?? null });
    return { statusCode: 200, bodyType: "json", body: round };
  },
});
