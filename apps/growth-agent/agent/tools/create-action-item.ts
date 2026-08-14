import { defineTool } from "eve/tools";
import { z } from "zod";
import { actionItemPayloadSchema } from "#lib/json-payload.ts";
import { growthCategorySchema, growthTagsSchema } from "#lib/growth-taxonomy.ts";
import { GROWTH_DOCUMENT_AUTHORING_GUIDE, growthDocumentInputSchema } from "#lib/growth-document.ts";
import { createActionItem } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

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

// type_id is duplicated across this file, save-report.ts, the report-composer subagent's copy of
// save-report.ts, and the backend's action item type registry — keep all four in sync.
// For report action items, prefer save-report's action_items field (it links
// them to the report atomically); this tool is for standalone items created
// outside report composition — daily briefs and chat.
export default defineTool({
  description: `Create a standalone action for customer review. Its document must make the evidence, hypothesis, experiment, success metrics, and proposed change easy to scan. ${GROWTH_DOCUMENT_AUTHORING_GUIDE} Nothing runs until the customer reviews and activates it.`,
  inputSchema: z.object({
    type_id: z.enum(["run_ads", "publish_blog", "custom"]),
    category: growthCategorySchema,
    tags: growthTagsSchema,
    title: z.string().min(1).max(500),
    description: z.string().min(1),
    document: growthDocumentInputSchema,
    payload: actionItemPayloadSchema.optional(),
    watched_metrics: z.array(watchedMetricSchema).max(10).optional(),
    workflow: workflowSchema.optional(),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContext(ctx);
    return await createActionItem({
      project_id: context.project_id,
      branch_id: context.branch_id,
      type_id: input.type_id,
      category: input.category,
      tags: input.tags ?? [],
      title: input.title,
      description: input.description,
      document: input.document,
      ...input.payload === undefined ? {} : { payload: input.payload },
      ...input.watched_metrics === undefined ? {} : { watched_metrics: input.watched_metrics },
      ...input.workflow === undefined ? {} : { workflow: input.workflow },
    });
  },
});
