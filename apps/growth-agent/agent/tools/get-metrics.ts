import { defineTool } from "eve/tools";
import { z } from "zod";
import { getMetrics } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

export default defineTool({
  description: "Fetch the current project's precomputed growth metric series (new signups, returning users, transactions, emails sent, total users, revenue). Use this first for baseline numbers before writing bespoke SQL with sql-query. For the full metric vocabulary and the complete historical per-day store, call get-metrics-context and query growth_daily_metrics via sql-query.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await getMetrics({ project_id: context.project_id, branch_id: context.branch_id });
  },
});
