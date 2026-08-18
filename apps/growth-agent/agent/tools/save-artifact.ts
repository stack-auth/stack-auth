import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonObjectSchema } from "#lib/json-payload.ts";
import { saveArtifact } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

export default defineTool({
  description: "Save a standalone content artifact (a full document, not a finding): e.g. a blog post draft (kind `blog_draft`), a landing page copy proposal (kind `copy_proposal`), or an outreach template (kind `outreach_template`). `content` is the complete markdown document. Save the artifact BEFORE referencing it from a report action item or finding, and put referenced ids in `metadata`.",
  inputSchema: z.object({
    kind: z.string().min(1).max(100),
    title: z.string().min(1).max(500),
    content: z.string().min(1),
    metadata: jsonObjectSchema.optional(),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await saveArtifact({
      project_id: context.project_id,
      branch_id: context.branch_id,
      ...context.run_id === undefined ? {} : { run_id: context.run_id },
      kind: input.kind,
      title: input.title,
      content: input.content,
      ...input.metadata === undefined ? {} : { metadata: input.metadata },
    });
  },
});
