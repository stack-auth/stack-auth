import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { getAdminGamesBody } from "@/lib/growth/games/quiz-games";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * The Growth admin Games card: the draft under review, the published quiz, and how the target
 * project's customer actually did on it.
 *
 * Platform-admin auth like every other route in this directory — a Hexclave staff user acting inside
 * the `internal` project, with the customer project named in the query. `requireGrowthAdminTenancy`
 * does the platform-admin check and resolves the target tenancy.
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
    body: await getAdminGamesBody(await requireGrowthAdminTenancy(auth.project.id, auth.user, query.project_id)),
  }),
});
