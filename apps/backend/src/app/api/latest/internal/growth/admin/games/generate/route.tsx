import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { generateQuizGame } from "@/lib/growth/games/quiz-games";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

// Generating awaits the growth agent's authoring turn, which is bounded well below this but is still
// the slowest thing on the path. Matches the blog-draft route, the other synchronous
// human-is-waiting generation in this app.
export const maxDuration = 300;

/**
 * Generates a fresh draft quiz for the target project, replacing any unreviewed draft.
 *
 * 409s when the project has too little metric history for a fair quiz — a normal state for a young
 * project, with a message written to be shown to staff verbatim.
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
    body: await generateQuizGame(
      await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id),
      { generatedByUserId: auth.user?.id ?? null, now: new Date() },
    ),
  }),
});
