import { requireGrowthAdminTenancy, setGrowthAdminCategoryScore } from "@/lib/growth/admin";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const PUT = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(), body: yupObject({ target_project_id: yupString().defined(), category: yupString().oneOf(GROWTH_CATEGORIES).defined(), score: yupNumber().integer().min(0).max(100).defined() }).defined(), method: yupString().oneOf(["PUT"]).defined() }),
  response: yupObject({ statusCode: yupNumber().oneOf([200]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() }),
  handler: async ({ auth, body }) => ({ statusCode: 200, bodyType: "json", body: await setGrowthAdminCategoryScore(await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id), body.category, body.score) }),
});
