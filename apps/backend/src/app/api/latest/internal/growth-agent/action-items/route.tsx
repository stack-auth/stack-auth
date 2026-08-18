import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { createGrowthAgentActionItem } from "@/lib/growth/agent-writes";
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
      brief_id: yupString().uuid().optional(),
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
      // (once present, every field is required). Deployed on activation, not on creation.
      workflow: yupObject({
        workflow_id: yupString().max(64).defined(),
        source: yupString().max(500_000).defined(),
        explanation: yupString().max(5_000).defined(),
        rollback_note: yupString().max(5_000).defined(),
      }).optional(),
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
    const result = await createGrowthAgentActionItem({
      tenancy,
      briefId: body.brief_id,
      item: {
        typeId: body.type_id,
        category: body.category,
        tags: body.tags,
        title: body.title,
        description: body.description,
        document: body.document,
        payload: body.payload,
        watchedMetrics: body.watched_metrics,
        workflow: body.workflow == null ? undefined : {
          workflowId: body.workflow.workflow_id,
          source: body.workflow.source,
          explanation: body.workflow.explanation,
          rollbackNote: body.workflow.rollback_note,
        },
      },
    });
    return { statusCode: 200, bodyType: "json", body: { action_item_id: result.actionItemId } };
  },
});
