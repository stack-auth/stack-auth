import { defineTool } from "eve/tools";
import { z } from "zod";
import { getProjectContext } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

export default defineTool({
  description: "Fetch the current project's stored context: onboarding answers, website URL, and product description. Use this when you need to know what the product is or who it is for; use get-context-bundle instead when you also need the run's findings and interview answers.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await getProjectContext({ project_id: context.project_id, branch_id: context.branch_id });
  },
});
