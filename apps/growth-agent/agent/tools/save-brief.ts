import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonObjectSchema } from "#lib/json-payload.ts";
import { GROWTH_DOCUMENT_AUTHORING_GUIDE, growthDocumentInputSchema } from "#lib/growth-document.ts";
import { saveBrief } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

// The brief's date comes from the dispatch (the backend pre-created the brief
// row for that UTC day), never from the model — a model-supplied date could
// fill the wrong day's row or race the day lock.
export default defineTool({
  description: `Save today's daily growth brief. The document is the primary customer UI: lead with the most important movement, show its evidence, and include at most one focus for today. ${GROWTH_DOCUMENT_AUTHORING_GUIDE} Call exactly once.`,
  inputSchema: z.object({
    summary: z.string().min(1),
    content_md: z.string().min(1),
    document: growthDocumentInputSchema,
    data: jsonObjectSchema.optional(),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContext(ctx);
    if (context.brief_date == null) {
      throw new Error("This tool is only available during a daily-brief session, and the current session is not one (it is an analysis run or chat session)");
    }
    return await saveBrief({
      project_id: context.project_id,
      branch_id: context.branch_id,
      date: context.brief_date,
      summary: input.summary,
      content_md: input.content_md,
      document: input.document,
      ...input.data === undefined ? {} : { data: input.data },
    });
  },
});
