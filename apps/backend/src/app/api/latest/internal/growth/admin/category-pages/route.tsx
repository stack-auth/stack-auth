import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { deleteGrowthAdminCategoryPageDraft, listGrowthAdminCategoryPages, saveGrowthAdminCategoryPageDraft } from "@/lib/growth/category-pages";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

/**
 * The Growth admin stage-page editor: the draft, the live version and the version
 * history of the page a customer reads under each hexagon stage.
 *
 * Platform-admin auth like every other route in this directory — a Hexclave staff
 * user acting inside the `internal` project, with the customer project named in the
 * request. `requireGrowthAdminTenancy` does the platform-admin check and resolves
 * the target tenancy.
 */

const authSchema = yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined();
const responseSchema = yupObject({ statusCode: yupNumber().defined(), bodyType: yupString().oneOf(["json"]).defined(), body: yupMixed().defined() });

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    query: yupObject({ project_id: yupString().defined() }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: responseSchema,
  handler: async ({ auth, query }) => ({
    statusCode: 200,
    bodyType: "json",
    body: { pages: await listGrowthAdminCategoryPages(await requireGrowthAdminTenancy(auth.project.id, auth.user, query.project_id)) },
  }),
});

export const PUT = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    body: yupObject({
      target_project_id: yupString().defined(),
      category: yupString().oneOf(GROWTH_CATEGORIES).defined(),
      // The authored payload, validated by the growth-mdx-v1 compiler rather than by
      // yup: its shape is a document AST contract, and duplicating it here would give
      // us two definitions of what a valid document is.
      document: yupMixed().defined(),
      source_finding_ids: yupArray(yupString().uuid().defined()).max(100).default([]),
      source_action_ids: yupArray(yupString().uuid().defined()).max(100).default([]),
      // The draft the author started from, so a save that would silently clobber a colleague's
      // newer draft is rejected instead. null = they started from a stage with no draft.
      expected_draft_updated_at_millis: yupNumber().nullable().defined(),
    }).defined(),
    method: yupString().oneOf(["PUT"]).defined(),
  }),
  response: responseSchema,
  handler: async ({ auth, body }) => {
    const tenancy = await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id);
    const authoredByUserId = auth.user?.id ?? throwErr("requireGrowthAdminTenancy returned without an authenticated staff user.");
    return {
      statusCode: 200,
      bodyType: "json",
      body: await saveGrowthAdminCategoryPageDraft(tenancy, {
        category: body.category,
        document: body.document,
        sourceItemIds: { findings: body.source_finding_ids, actions: body.source_action_ids },
        authoredByUserId,
        expectedDraftUpdatedAtMillis: body.expected_draft_updated_at_millis,
      }),
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
    body: await deleteGrowthAdminCategoryPageDraft(await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id), body.category),
  }),
});
