import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonObjectSchema } from "#lib/json-payload.ts";
import { growthCategorySchema, growthTagsSchema } from "#lib/growth-taxonomy.ts";
import { GROWTH_DOCUMENT_AUTHORING_GUIDE, growthDocumentInputSchema } from "#lib/growth-document.ts";
import { saveNotes } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

// Notes are the workspace's trend lane, shown next to findings. The distinction the description
// leans on is direction over time: a finding is "X is true", a note is "X has been moving this way".
// `source` is pinned to the session's run context exactly like save-finding, so the model cannot
// write a note under another phase's identity, and the note `kind` is pinned server-side.
export default defineTool({
  description: `Record a measured trend or pattern. The document should lead with a chart or comparison, then explain the change and uncertainty briefly. ${GROWTH_DOCUMENT_AUTHORING_GUIDE} Do not create a note for one isolated value or put recommendations here.`,
  inputSchema: z.object({
    notes: z.array(z.object({
      category: growthCategorySchema,
      tags: growthTagsSchema,
      title: z.string().min(1).max(500).describe("The trend in one line, including the direction and the window, e.g. 'Organic search signups down 42% over the last 3 weeks'."),
      body: z.string().min(1).describe("The numbers behind the trend, the window they cover, and why it matters. State plainly when a cause is a hypothesis rather than something the data shows."),
      data: jsonObjectSchema.optional(),
      document: growthDocumentInputSchema,
    })).min(1).max(20),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await saveNotes({
      project_id: context.project_id,
      branch_id: context.branch_id,
      ...context.run_id === undefined ? {} : { run_id: context.run_id },
      source: context.finding_source,
      notes: input.notes.map((note) => ({ ...note, tags: note.tags ?? [] })),
    });
  },
});
