import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonObjectSchema } from "#lib/json-payload.ts";
import { saveArtifact } from "#lib/hexclave-client.ts";

// Per-subagent wrapper (ids from the task message, see get-context-bundle.ts).
// Exists so publish_blog action items can reference a full draft: the artifact
// is saved first, then its id goes into the action item payload.
export default defineTool({
  description: "Save a standalone content artifact (a full document, not a finding): e.g. a blog post draft (kind `blog_draft`). `content` is the complete markdown document. Save the artifact BEFORE referencing its id from a report action item payload. Use the exact project_id, branch_id, and run_id you were given in your task message.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    run_id: z.string().min(1),
    kind: z.string().min(1).max(100),
    title: z.string().min(1).max(500),
    content: z.string().min(1),
    metadata: jsonObjectSchema.optional(),
  }),
  async execute(input) {
    return await saveArtifact({
      project_id: input.project_id,
      branch_id: input.branch_id,
      run_id: input.run_id,
      kind: input.kind,
      title: input.title,
      content: input.content,
      ...input.metadata === undefined ? {} : { metadata: input.metadata },
    });
  },
});
