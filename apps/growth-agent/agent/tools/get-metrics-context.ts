import { defineTool } from "eve/tools";
import { z } from "zod";
import { getMetricsContext } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

export default defineTool({
  description: "Full catalog of growth metrics: what is stored in the growth_daily_metrics ClickHouse table (queryable via sql-query), ready-to-run SQL templates for on-the-fly metrics, what is not measurable, and the rules for correlating product metrics with ad metrics. Call this before doing metric analysis.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await getMetricsContext({ project_id: context.project_id, branch_id: context.branch_id });
  },
});
