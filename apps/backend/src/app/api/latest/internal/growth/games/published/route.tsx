import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { getPublishedQuizBody } from "@/lib/growth/games/quiz-rounds";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * The quiz banner's state, above the customer's insights section: the published game (if any) and
 * their latest round.
 *
 * `{ game: null }` is the common answer — most projects have no published quiz, and the banner
 * renders nothing at all rather than an empty state, because there is nothing for the customer to
 * do about it.
 */
export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth }) => {
    requireGrowthAppEnabled(auth.tenancy);
    return { statusCode: 200, bodyType: "json", body: await getPublishedQuizBody(auth.tenancy) };
  },
});
