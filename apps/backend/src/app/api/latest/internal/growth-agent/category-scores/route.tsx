import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { saveGrowthCategoryScores } from "@/lib/growth/agent-writes";
import { GROWTH_CATEGORIES, GROWTH_CATEGORY_SCORE_MAX, GROWTH_CATEGORY_SCORE_MIN } from "@/lib/growth/categories";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupArray, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Machine route: authenticated by the shared growth agent secret, not the standard project auth.
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      // The whole radar in one call — `min`/`max` are pinned to the category count because a partial
      // set renders as an unscored radar. saveGrowthCategoryScores re-checks completeness and
      // duplicates; the bounds here only stop an obviously malformed payload at the edge.
      scores: yupArray(yupObject({
        category: yupString().oneOf([...GROWTH_CATEGORIES]).defined(),
        score: yupNumber().integer().min(GROWTH_CATEGORY_SCORE_MIN).max(GROWTH_CATEGORY_SCORE_MAX).defined(),
      }).defined()).min(GROWTH_CATEGORIES.length).max(GROWTH_CATEGORIES.length).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ headers, body }) => {
    const tenancy = await authenticateGrowthAgentRequest({
      authorizationHeader: headers.authorization?.[0],
      projectId: body.project_id,
      branchId: body.branch_id,
    });
    const result = await saveGrowthCategoryScores({
      tenancy,
      scores: body.scores.map((entry) => ({ category: entry.category, score: entry.score })),
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { scores: result.scores.map((entry) => ({ category: entry.category, score: entry.score })) },
    };
  },
});
