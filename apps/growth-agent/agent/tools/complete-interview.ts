import { defineTool } from "eve/tools";
import { z } from "zod";
import { completeInterview } from "#lib/hexclave-client.ts";
import { readGrowthInterviewContext } from "#lib/run-context.ts";

// Marks the interview completed on the backend. The growth engine (not this tool, and not the
// stream proxy) then flips the run to COMPOSING_REPORT and dispatches the report phase on its next
// tick — completion here is purely a state write.
export default defineTool({
  description: "INTERVIEW SESSIONS ONLY — never call this during analysis phases, daily briefs, or chat sessions. Marks the founder interview as completed once every question has been answered (or the founder asked to finish). Call it exactly once, then write a brief closing message.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const context = readGrowthInterviewContext(ctx);
    return await completeInterview({
      project_id: context.project_id,
      branch_id: context.branch_id,
      run_id: context.run_id,
    });
  },
});
