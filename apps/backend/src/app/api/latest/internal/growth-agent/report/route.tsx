import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { upsertGrowthReport } from "@/lib/growth/agent-writes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { jsonSchema, yupArray, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Machine route: authenticated by the shared growth agent secret, not the standard project auth.
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      run_id: yupString().uuid().defined(),
      title: yupString().max(500).optional(),
      summary: yupString().defined(),
      content_md: yupString().defined(),
      document: jsonSchema.optional(),
      sections: jsonSchema.optional(),
      action_items: yupArray(yupObject({
        type_id: yupString().defined(),
        category: yupString().oneOf([...GROWTH_CATEGORIES]).defined(),
        tags: yupArray(yupString().defined()).max(10).default([]),
        title: yupString().max(500).defined(),
        description: yupString().defined(),
        document: jsonSchema.optional(),
        payload: jsonSchema.optional(),
        watched_metrics: yupArray(yupObject({
          metric_id: yupString().defined(),
          window_days: yupNumber().integer().defined(),
        }).defined()).optional(),
        // Optional agent-authored workflow; all-or-nothing enforced by the nested object shape
        // (once present, every field is required). Deployed on activation, not on report write.
        workflow: yupObject({
          workflow_id: yupString().max(64).defined(),
          source: yupString().max(500_000).defined(),
          explanation: yupString().max(5_000).defined(),
          rollback_note: yupString().max(5_000).defined(),
        }).optional(),
      }).defined()).max(20).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ headers, body }) => {
    const tenancy = await authenticateGrowthAgentRequest({
      authorizationHeader: headers.authorization?.[0],
      projectId: body.project_id,
      branchId: body.branch_id,
    });
    const result = await upsertGrowthReport({
      tenancy,
      runId: body.run_id,
      // The dashboard always renders a title; the agent's own titles are usually better, but a
      // reasonable default beats rejecting an otherwise complete report.
      title: body.title ?? "Growth analysis report",
      summary: body.summary,
      contentMd: body.content_md,
      document: body.document,
      sections: body.sections,
      actionItems: body.action_items.map((item) => ({
        typeId: item.type_id,
        category: item.category,
        tags: item.tags,
        title: item.title,
        description: item.description,
        document: item.document,
        payload: item.payload,
        watchedMetrics: item.watched_metrics,
        workflow: item.workflow == null ? undefined : {
          workflowId: item.workflow.workflow_id,
          source: item.workflow.source,
          explanation: item.workflow.explanation,
          rollbackNote: item.workflow.rollback_note,
        },
      })),
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { report_id: result.reportId, action_item_ids: result.actionItemIds },
    };
  },
});
