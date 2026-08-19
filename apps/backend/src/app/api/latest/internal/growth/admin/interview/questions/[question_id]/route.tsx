import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { deleteGrowthAdminInterviewQuestion, updateGrowthAdminInterviewQuestion } from "@/lib/growth/interview-release";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

// Mirrors the machine route that writes these rows
// (internal/growth-agent/interview-questions): a reviewer must not be able to save a question the
// agent could not have generated, or the plan stops round-tripping through the same validation.
const FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH = 300;

/**
 * Rewrites one held question's wording and answer options.
 *
 * NOTE WHAT IS NOT ACCEPTED HERE: `kind`, `question_key`, `origin`, and any answer field. The first
 * three are the question's identity — the report phase joins answers back on the key, and changing
 * it would silently orphan them — and answers belong to the customer, who by definition has not
 * given any yet (the lib refuses to edit a released plan at all).
 */
export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["PATCH"]).defined(),
    params: yupObject({
      // Not .uuid(): non-UUID values 404 inside the lib, keeping the miss shape identical whether
      // the id is malformed or belongs to another project.
      question_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      target_project_id: yupString().defined(),
      prompt: yupString().min(1).max(FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH).defined(),
      options: yupArray(yupObject({
        id: yupString().min(1).max(100).defined(),
        label: yupString().min(1).max(80).defined(),
        description: yupString().max(120).optional(),
      }).defined()).min(1).max(9).defined(),
      allow_skip: yupBoolean().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => ({
    statusCode: 200,
    bodyType: "json",
    body: await updateGrowthAdminInterviewQuestion(
      await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id),
      params.question_id,
      { prompt: body.prompt, options: body.options, allowSkip: body.allow_skip },
    ),
  }),
});

/** Drops a weak question from a held plan, re-packing the remaining order indices. */
export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["DELETE"]).defined(),
    params: yupObject({ question_id: yupString().defined() }).defined(),
    // Carried in the body even on DELETE, matching the sibling admin routes: the target project is
    // not inferable from the credential, which is always the internal project's.
    body: yupObject({ target_project_id: yupString().defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => ({
    statusCode: 200,
    bodyType: "json",
    body: await deleteGrowthAdminInterviewQuestion(
      await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id),
      params.question_id,
    ),
  }),
});
