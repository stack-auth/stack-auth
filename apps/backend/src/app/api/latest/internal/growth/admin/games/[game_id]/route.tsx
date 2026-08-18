import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { archiveQuizGame, publishQuizGame } from "@/lib/growth/games/quiz-games";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Publishes a reviewed draft, or archives the live quiz.
 *
 * Modelled as one PATCH with an `action` rather than two routes because they are the two ends of the
 * same lifecycle and share the whole preamble; the lib functions enforce which statuses each is
 * legal from.
 */
export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["PATCH"]).defined(),
    params: yupObject({
      // Not .uuid(): non-UUID values 404 inside the lib, keeping the miss shape identical whether
      // the id is malformed or belongs to another project.
      game_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      target_project_id: yupString().defined(),
      action: yupString().oneOf(["publish", "archive"]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const tenancy = await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id);
    const result = body.action === "publish"
      ? await publishQuizGame(tenancy, params.game_id, { publishedByUserId: auth.user?.id ?? null, now: new Date() })
      : await archiveQuizGame(tenancy, params.game_id);
    return { statusCode: 200, bodyType: "json", body: result };
  },
});
