import { defineTool } from "eve/tools";
import { z } from "zod";
import { getContextBundle } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

// When the session belongs to an analysis run, the bundle is scoped to that
// run's findings/answers; outside a run (briefs, chat) it returns
// the project-wide latest state.
export default defineTool({
  description: "Fetch the full growth context bundle for the current project: stored project context plus accumulated findings, artifacts, interview answers, and the latest report/brief state. This is the richest single read — call it at the start of interview, report, analysis topic, and brief work.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await getContextBundle({
      project_id: context.project_id,
      branch_id: context.branch_id,
      ...context.run_id === undefined ? {} : { run_id: context.run_id },
    });
  },
});
