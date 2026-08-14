import { defineTool } from "eve/tools";
import { z } from "zod";
import { getContextBundle } from "#lib/hexclave-client.ts";

// Thin per-subagent wrapper around the shared backend client. Subagents do not
// receive the root session's auth attributes, so (unlike the root tools, which
// read ids from run-context) the ids come from the task message via the input
// schema — the same pattern as the data-analyst/website-research tools.
export default defineTool({
  description: "Fetch the full growth context bundle for the analysis run: stored project context plus accumulated findings, artifacts, interview answers, and the latest report/brief state. Call this first — the entire report must be grounded in it. Use the exact project_id, branch_id, and run_id you were given in your task message.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    run_id: z.string().min(1),
  }),
  async execute(input) {
    return await getContextBundle(input);
  },
});
