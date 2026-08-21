import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateWorkflowSource } from "#lib/hexclave-client.ts";

// Per-subagent wrapper (ids from the task message, see get-context-bundle.ts).
export default defineTool({
  description: "Validate a candidate growth workflow before attaching it to a save-report action item. Returns { valid, error, manifest, workflow_id_available, warnings }. When `valid` is false, read `error`, fix the source, and validate again — but at most 4 attempts total for one workflow; if it still fails, drop the workflow and turn the action item into advice-only (describe the steps in its description instead). Only attach a workflow whose last validation returned `valid: true`. Also review `warnings` and address any that apply. Use the exact project_id and branch_id you were given in your task message.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    workflow_id: z.string().min(1).max(64),
    source: z.string().min(1),
  }),
  async execute(input) {
    return await validateWorkflowSource(input);
  },
});
