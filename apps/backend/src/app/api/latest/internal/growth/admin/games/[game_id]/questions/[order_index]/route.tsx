import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { removeQuizQuestion, updateQuizQuestion } from "@/lib/growth/games/quiz-games";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// The order index is a path segment, so it arrives as a string. Parsed by hand (same as the list
// routes' `limit`) so a garbage value is a clean 400 rather than a NaN reaching the query.
function parseOrderIndex(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new StatusError(400, "order_index must be a non-negative integer");
  }
  return value;
}

/**
 * Rewrites one draft question's wording.
 *
 * NOTE WHAT IS NOT ACCEPTED HERE: `options`, `correct_option_id`, and the true value. They are
 * computed from the project's real rolled-up metrics, and the section's whole premise is that its
 * numbers are true — so the schema simply has no field for them, and a reviewer cannot introduce a
 * wrong fact any more than the agent can. The prose they do write runs through the same
 * answer-leak check the agent's output does.
 */
export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["PATCH"]).defined(),
    params: yupObject({ game_id: yupString().defined(), order_index: yupString().defined() }).defined(),
    body: yupObject({
      target_project_id: yupString().defined(),
      text: yupString().min(1).max(400).defined(),
      explanation: yupString().min(1).max(600).defined(),
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
    body: await updateQuizQuestion(
      await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id),
      params.game_id,
      parseOrderIndex(params.order_index),
      { text: body.text, explanation: body.explanation },
    ),
  }),
});

/** Drops a weak question from a draft, re-packing the remaining order indices. */
export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["DELETE"]).defined(),
    params: yupObject({ game_id: yupString().defined(), order_index: yupString().defined() }).defined(),
    // Carried in the body even on DELETE, matching the sibling admin findings route: the target
    // project is not inferable from the credential, which is always the internal project's.
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
    body: await removeQuizQuestion(
      await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id),
      params.game_id,
      parseOrderIndex(params.order_index),
    ),
  }),
});
