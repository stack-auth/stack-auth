import { defineTool } from "eve/tools";
import { z } from "zod";
import { growthCategoryScoresSchema } from "#lib/growth-taxonomy.ts";
import { saveCategoryScores } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

// Scores the full growth journey the customer sees on the workspace overview. Whole-journey-at-once
// by design: a partial write would leave some stages on "Not scored" while this tool reported
// success. Scores are also not run-scoped —
// they are the project's current standing, so re-running the report re-scores rather than appending.
export default defineTool({
  description: "Score all 5 growth stages 0-100 for this project, replacing any previous scores: product, reach, conversion, retention, and revenue. This drives the connected growth journey on the customer's overview. Call this exactly once, after you have read the run's findings and the founder's interview answers, and base each score on that evidence rather than on impressions. Judge each stage against what this product realistically needs now: a pre-revenue product with no billing is not a 0 on revenue if that is appropriate, and a stage with no evidence either way should get a middling score rather than a 0.",
  inputSchema: z.object({
    scores: growthCategoryScoresSchema,
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await saveCategoryScores({
      project_id: context.project_id,
      branch_id: context.branch_id,
      scores: input.scores,
    });
  },
});
