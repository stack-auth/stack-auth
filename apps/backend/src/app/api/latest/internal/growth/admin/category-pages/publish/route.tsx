import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { publishGrowthAdminCategoryPage, unpublishGrowthAdminCategoryPage } from "@/lib/growth/category-pages";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

const authSchema = yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined();
const responseSchema = yupObject({ statusCode: yupNumber().defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() });

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    body: yupObject({
      target_project_id: yupString().defined(),
      category: yupString().oneOf(GROWTH_CATEGORIES).defined(),
      version: yupNumber().integer().min(1).defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: responseSchema,
  handler: async ({ auth, body }) => {
    const tenancy = await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id);
    const publishedByUserId = auth.user?.id ?? throwErr("requireGrowthAdminTenancy returned without an authenticated staff user.");
    return {
      statusCode: 200,
      bodyType: "json",
      body: await publishGrowthAdminCategoryPage(tenancy, { category: body.category, version: body.version, publishedByUserId }),
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    body: yupObject({ target_project_id: yupString().defined(), category: yupString().oneOf(GROWTH_CATEGORIES).defined() }).defined(),
    method: yupString().oneOf(["DELETE"]).defined(),
  }),
  response: responseSchema,
  handler: async ({ auth, body }) => ({
    statusCode: 200,
    bodyType: "json",
    body: await unpublishGrowthAdminCategoryPage(await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id), body.category),
  }),
});
