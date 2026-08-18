import { defineTool } from "eve/tools";
import { z } from "zod";
import { getMetrics } from "#lib/hexclave-client.ts";

export default defineTool({
  description: "Fetch the project's precomputed growth metrics (signups, activity, and related aggregates) from the Hexclave backend. Use this for baseline numbers before writing bespoke SQL. For the full metric vocabulary and the complete historical per-day store, call get-metrics-context and query growth_daily_metrics via sql-query.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
  }),
  async execute(input) {
    return await getMetrics(input);
  },
});
