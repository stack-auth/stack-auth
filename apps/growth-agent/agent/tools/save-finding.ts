import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonObjectSchema } from "#lib/json-payload.ts";
import { growthCategorySchema, growthTagsSchema } from "#lib/growth-taxonomy.ts";
import { GROWTH_DOCUMENT_AUTHORING_GUIDE, growthDocumentInputSchema } from "#lib/growth-document.ts";
import { saveFindings } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

// Singular tool name ("save-finding") but batched input: the backend endpoint
// takes 1-20 findings per call, and batching related findings into one call
// keeps them atomic and saves round trips. The `source` is pinned to the
// session's run context (the current phase key, or daily-brief/chat)
// so the model cannot write findings under another phase's identity.
export default defineTool({
  description: `Save grounded growth findings. Each document is the customer-facing explanation and should show the evidence, takeaway, and any honest data gap without long prose. ${GROWTH_DOCUMENT_AUTHORING_GUIDE} Every claim must come from tool results in this session.`,
  inputSchema: z.object({
    findings: z.array(z.object({
      kind: z.string().min(1).max(100),
      category: growthCategorySchema,
      tags: growthTagsSchema,
      title: z.string().min(1).max(500),
      body: z.string().min(1),
      document: growthDocumentInputSchema,
      data: jsonObjectSchema.optional(),
    })).min(1).max(20),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await saveFindings({
      project_id: context.project_id,
      branch_id: context.branch_id,
      ...context.run_id === undefined ? {} : { run_id: context.run_id },
      source: context.finding_source,
      findings: input.findings.map((finding) => ({ ...finding, tags: finding.tags ?? [] })),
    });
  },
});
