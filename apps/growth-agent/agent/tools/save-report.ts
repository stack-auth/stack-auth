import { defineTool } from "eve/tools";
import { z } from "zod";
import { actionItemPayloadSchema } from "#lib/json-payload.ts";
import { growthCategorySchema, growthTagsSchema } from "#lib/growth-taxonomy.ts";
import { GROWTH_DOCUMENT_AUTHORING_GUIDE, growthDocumentInputSchema } from "#lib/growth-document.ts";
import { saveReport } from "#lib/hexclave-client.ts";
import { readGrowthRunContextWithRunId } from "#lib/run-context.ts";

const watchedMetricSchema = z.object({
  metric_id: z.enum(["new_signups", "returning_users", "transactions", "emails_sent", "total_users", "revenue"]),
  window_days: z.number().int().min(1).max(90),
});

// Mirrors the backend's nested `workflow` body schema (all-or-nothing once present).
const workflowSchema = z.object({
  workflow_id: z.string().min(1).max(64),
  source: z.string().min(1),
  explanation: z.string().min(1).max(5_000),
  rollback_note: z.string().min(1).max(5_000),
});

// type_id is duplicated across this file, create-action-item.ts, the report-composer subagent's
// copy of this file, and the backend's action item type registry — keep all four in sync.
export default defineTool({
  description: `Save the final growth report and action items. The document is the primary customer UI. ${GROWTH_DOCUMENT_AUTHORING_GUIDE} Every action also needs its own document covering evidence, hypothesis, experiment, metrics, and the exact proposed change. Keep titles and descriptions in simple English. Put ready-to-paste coding prompts or blog ideas in payload. Attach workflows only after validate-workflow succeeds; nothing is activated until the customer reviews it.`,
  inputSchema: z.object({
    title: z.string().min(1).max(500).optional(),
    summary: z.string().min(1),
    content_md: z.string().min(1),
    document: growthDocumentInputSchema,
    sections: z.array(z.object({
      kind: z.string().min(1).max(100),
      title: z.string().min(1).max(500),
      body_markdown: z.string().min(1),
    })).min(1).optional(),
    action_items: z.array(z.object({
      type_id: z.enum(["run_ads", "publish_blog", "custom"]),
      category: growthCategorySchema,
      tags: growthTagsSchema,
      title: z.string().min(1).max(500),
      description: z.string().min(1),
      document: growthDocumentInputSchema,
      payload: actionItemPayloadSchema.optional(),
      watched_metrics: z.array(watchedMetricSchema).max(10).optional(),
      workflow: workflowSchema.optional(),
    })).max(20),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContextWithRunId(ctx);
    return await saveReport({
      project_id: context.project_id,
      branch_id: context.branch_id,
      run_id: context.run_id,
      ...input.title === undefined ? {} : { title: input.title },
      summary: input.summary,
      content_md: input.content_md,
      document: input.document,
      ...input.sections === undefined ? {} : { sections: input.sections },
      action_items: input.action_items.map((item) => ({ ...item, tags: item.tags ?? [] })),
    });
  },
});
