import { defineTool } from "eve/tools";
import { z } from "zod";
import { validateWorkflowSource } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

export default defineTool({
  description: "Validate a candidate growth workflow before attaching it to an action item. Returns { valid, error, manifest, workflow_id_available, warnings }. When `valid` is false, read `error`, fix the source, and validate again — but at most 4 attempts total for one workflow; if it still fails, drop the workflow and turn the action item into advice-only (describe the steps in its description instead). Only attach a workflow whose last validation returned `valid: true`. Also review `warnings` and address any that apply.",
  inputSchema: z.object({
    workflow_id: z.string().min(1).max(64),
    source: z.string().min(1),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await validateWorkflowSource({
      project_id: context.project_id,
      branch_id: context.branch_id,
      workflow_id: input.workflow_id,
      source: input.source,
    });
  },
});
