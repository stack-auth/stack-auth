import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonObjectSchema } from "#lib/json-payload.ts";
import { saveArtifact } from "#lib/hexclave-client.ts";

// The artifact kind is pinned to "crawl_summary" here instead of being a model
// input: this subagent produces exactly one artifact kind, and hardcoding it
// keeps the model from inventing new kinds the dashboard does not render.
export default defineTool({
  description: "Save the crawl summary artifact (a markdown summary of the website crawl: pages visited, positioning, audience, features, and competitor list) to the Hexclave backend. Call this exactly once, at the end of your research.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    run_id: z.string().min(1).optional(),
    title: z.string().min(1).max(500),
    content: z.string().min(1),
    metadata: jsonObjectSchema.optional(),
  }),
  async execute(input) {
    // Wider-object pass-through for project_id/branch_id; see the comment in
    // ./save-findings.ts for why the shared client's input type lacks them.
    const payload = {
      project_id: input.project_id,
      branch_id: input.branch_id,
      ...input.run_id === undefined ? {} : { run_id: input.run_id },
      kind: "crawl_summary",
      title: input.title,
      content: input.content,
      ...input.metadata === undefined ? {} : { metadata: input.metadata },
    };
    return await saveArtifact(payload);
  },
});
