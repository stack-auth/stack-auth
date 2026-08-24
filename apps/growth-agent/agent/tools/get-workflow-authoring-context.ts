import { defineTool } from "eve/tools";
import { z } from "zod";
import { getWorkflowAuthoringContext } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

export default defineTool({
  description: "Fetch everything needed to author a growth workflow: the exact TypeScript type contract (dts) workflow source is compiled against, the authoring guide, the growth-specific rules, the project's existing growth workflow ids (to avoid collisions), and the platform event types workflows can subscribe to. Call this ONCE, before writing any workflow source — never write source from memory of the contract.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await getWorkflowAuthoringContext({
      project_id: context.project_id,
      branch_id: context.branch_id,
    });
  },
});
