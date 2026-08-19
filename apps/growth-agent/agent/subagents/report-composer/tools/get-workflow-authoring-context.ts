import { defineTool } from "eve/tools";
import { z } from "zod";
import { getWorkflowAuthoringContext } from "#lib/hexclave-client.ts";

// Per-subagent wrapper (ids from the task message, see get-context-bundle.ts).
export default defineTool({
  description: "Fetch everything needed to author a growth workflow: the exact TypeScript type contract (dts) workflow source is compiled against, the authoring guide, the growth-specific rules, the project's existing growth workflow ids (to avoid collisions), and the platform event types workflows can subscribe to. Call this ONCE, before writing any workflow source — never write source from memory of the contract. Use the exact project_id and branch_id you were given in your task message.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
  }),
  async execute(input) {
    return await getWorkflowAuthoringContext(input);
  },
});
