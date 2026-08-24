import { defineTool } from "eve/tools";
import { z } from "zod";
import { growthCategoryScoresSchema } from "#lib/growth-taxonomy.ts";
import { saveCategoryScores } from "#lib/hexclave-client.ts";

// Per-subagent wrapper (ids from the task message, see get-context-bundle.ts). Scoring lives in this
// subagent rather than the root because this is the only place that has read the whole run — every
// phase's findings plus the founder's interview answers — which is exactly what a score has to be
// grounded in. No run_id: scores are the project's current standing, not a per-run artifact, so
// re-running the report overwrites them instead of accumulating a history.
export default defineTool({
  description: "Score all 5 growth stages 0-100 for this project, replacing any previous scores: product, reach, conversion, retention, and revenue. This drives the connected growth journey on the customer's overview. Call this exactly once per report, after you have read the run's findings and the founder's interview answers, and base each score on that evidence rather than on impressions. Judge each stage against what this product realistically needs now: a pre-revenue product with no billing is not a 0 on revenue if that is appropriate, and a stage with no evidence either way should get a middling score rather than a 0. Use the exact project_id and branch_id you were given in your task message.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    scores: growthCategoryScoresSchema,
  }),
  async execute(input) {
    return await saveCategoryScores({
      project_id: input.project_id,
      branch_id: input.branch_id,
      scores: input.scores,
    });
  },
});
