import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonObjectSchema } from "#lib/json-payload.ts";
import { growthCategorySchema, growthTagsSchema } from "#lib/growth-taxonomy.ts";
import { growthDocumentInputSchema } from "#lib/growth-document.ts";
import { saveNotes } from "#lib/hexclave-client.ts";

// Per-subagent wrapper (ids from the task message, see save-findings.ts). Notes are the trend lane
// of the customer's workspace, sitting beside findings; the distinction this tool enforces through
// its description is direction over time. The finding `kind` that marks a note is pinned server-side,
// so nothing here can drop a note into the findings lane by mistake.
export default defineTool({
  description: "Record a trend or pattern you found in the project's data (batch up to 20 per call). A note is different from a finding: a finding states something that is true right now, a note states how something has been MOVING — a metric trending up or down over weeks, a recurring weekly or seasonal shape, a channel steadily gaining or losing share, a cohort behaving differently from the ones before it, or a step change with a visible before and after. Every note must cite the actual numbers and the time window they cover, from queries you ran in this session. Put the machine-readable series or comparison in `data`. Do not write a note for a single day's value with nothing to compare it to, and do not put recommendations here — those belong in the report's action items. Use the exact project_id, branch_id, and run_id you were given in your task message.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    run_id: z.string().min(1).optional(),
    notes: z.array(z.object({
      category: growthCategorySchema,
      tags: growthTagsSchema,
      title: z.string().min(1).max(500).describe("The trend in one line, including the direction and the window, e.g. 'Organic search signups down 42% over the last 3 weeks'."),
      body: z.string().min(1).describe("The numbers behind the trend, the window they cover, and why it matters. State plainly when a cause is a hypothesis rather than something the data shows."),
      data: jsonObjectSchema.optional(),
      document: growthDocumentInputSchema,
    })).min(1).max(20),
  }),
  async execute(input) {
    return await saveNotes({
      project_id: input.project_id,
      branch_id: input.branch_id,
      ...input.run_id === undefined ? {} : { run_id: input.run_id },
      // Same trap as save-findings.ts: the backend validates `source` against PHASE KEYS, and this
      // subagent's name (`data-analyst`) is not its phase key (`data-analysis`). Sending the
      // subagent's own name would 400 on every call while the phase still reported COMPLETED.
      source: "data-analysis",
      notes: input.notes.map((note) => ({ ...note, tags: note.tags ?? [] })),
    });
  },
});
