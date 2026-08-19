import { deleteGrowthAdminFinding, requireGrowthAdminTenancy, updateGrowthAdminFinding } from "@/lib/growth/admin";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined();
const paramsSchema = yupObject({ finding_id: yupString().uuid().defined() }).defined();
const responseSchema = yupObject({ statusCode: yupNumber().defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() });

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: authSchema, params: paramsSchema, body: yupObject({ target_project_id: yupString().defined(), kind: yupString().min(1).max(100).defined(), category: yupString().oneOf(GROWTH_CATEGORIES).defined(), tags: yupArray(yupString().min(1).max(40).defined()).max(10).default([]), title: yupString().min(1).max(500).defined(), body: yupString().min(1).max(10_000).defined() }).defined(), method: yupString().oneOf(["PATCH"]).defined() }),
  response: responseSchema,
  handler: async ({ auth, params, body }) => ({ statusCode: 200, bodyType: "json", body: await updateGrowthAdminFinding(await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id), params.finding_id, body) }),
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: authSchema, params: paramsSchema, body: yupObject({ target_project_id: yupString().defined() }).defined(), method: yupString().oneOf(["DELETE"]).defined() }),
  response: responseSchema,
  handler: async ({ auth, params, body }) => ({ statusCode: 200, bodyType: "json", body: await deleteGrowthAdminFinding(await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id), params.finding_id) }),
});
