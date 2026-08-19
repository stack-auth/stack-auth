import { defineTool } from "eve/tools";
import { z } from "zod";
import { getMetricsContext } from "#lib/hexclave-client.ts";

// Thin per-subagent wrapper (declared subagents inherit no root tools); unlike the root variant,
// project/branch come from the task message rather than run context, matching this subagent's
// other tools.
export default defineTool({
  description: "Full catalog of growth metrics: what is stored in the growth_daily_metrics ClickHouse table (queryable via sql-query), ready-to-run SQL templates for on-the-fly metrics, what is not measurable, and the rules for correlating product metrics with ad metrics. Call this before doing metric analysis.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
  }),
  async execute(input) {
    return await getMetricsContext(input);
  },
});
