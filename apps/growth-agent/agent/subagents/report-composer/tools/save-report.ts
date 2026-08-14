import { defineTool } from "eve/tools";
import { z } from "zod";
import { actionItemPayloadSchema } from "#lib/json-payload.ts";
import { growthCategorySchema, growthTagsSchema } from "#lib/growth-taxonomy.ts";
import { GROWTH_ACTION_DOCUMENT_AUTHORING_GUIDE, GROWTH_DOCUMENT_AUTHORING_GUIDE, growthActionDocumentInputSchema, growthDocumentInputSchema } from "#lib/growth-document.ts";
import { saveReport } from "#lib/hexclave-client.ts";

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

// type_id is duplicated across this file, the root create-action-item.ts / save-report.ts, and the
// backend's action item type registry — keep all four in sync.
// Per-subagent wrapper (ids from the task message, see get-context-bundle.ts).
// The 2-5 action-item bound is enforced here (not just in the instructions)
// because it is the product's quality bar: fewer reads as lazy, more dilutes
// the recommendations.
export default defineTool({
  description: `Save the final report and 2-5 actions. The report document is the primary customer UI. ${GROWTH_DOCUMENT_AUTHORING_GUIDE} For every action document: ${GROWTH_ACTION_DOCUMENT_AUTHORING_GUIDE} Nothing runs until customer review and activation.`,
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    run_id: z.string().min(1),
    title: z.string().min(1).max(500).optional(),
    summary: z.string().min(1),
    content_md: z.string().min(1),
    document: growthDocumentInputSchema,
    sections: z.array(z.object({
      kind: z.string().min(1).max(100),
      title: z.string().min(1).max(500),
      body_markdown: z.string().min(1),
    })).min(1),
    action_items: z.array(z.object({
      type_id: z.enum(["run_ads", "publish_blog", "custom"]),
      category: growthCategorySchema,
      tags: growthTagsSchema,
      title: z.string().min(1).max(500),
      description: z.string().min(1),
      document: growthActionDocumentInputSchema,
      payload: actionItemPayloadSchema.optional(),
      watched_metrics: z.array(watchedMetricSchema).max(10).optional(),
      workflow: workflowSchema.optional(),
    })).min(2).max(5),
  }),
  async execute(input) {
    return await saveReport({
      project_id: input.project_id,
      branch_id: input.branch_id,
      run_id: input.run_id,
      ...input.title === undefined ? {} : { title: input.title },
      summary: input.summary,
      content_md: input.content_md,
      document: input.document,
      sections: input.sections,
      action_items: input.action_items.map((item) => ({ ...item, tags: item.tags ?? [] })),
    });
  },
});
