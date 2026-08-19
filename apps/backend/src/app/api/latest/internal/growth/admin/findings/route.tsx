import { createGrowthAdminFinding, requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    body: yupObject({
      target_project_id: yupString().defined(), kind: yupString().min(1).max(100).defined(), category: yupString().oneOf(GROWTH_CATEGORIES).defined(),
      tags: yupArray(yupString().min(1).max(40).defined()).max(10).default([]), title: yupString().min(1).max(500).defined(), body: yupString().min(1).max(10_000).defined(), note: yupBoolean().default(false),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({ statusCode: yupNumber().oneOf([201]).defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() }),
  handler: async ({ auth, body }) => {
    const tenancy = await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id);
    return { statusCode: 201, bodyType: "json", body: await createGrowthAdminFinding(tenancy, body) };
  },
});
