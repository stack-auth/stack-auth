import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { createGrowthServerActionItem } from "@/lib/growth/server-bridge";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, jsonSchema, serverOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";

/**
 * Lets a customer's own scheduled Workflow (ordinary server auth) propose a follow-up action item,
 * e.g. "CPA drifted, consider raising the bid" — but never author the bid change itself. Three
 * constraints, all load-bearing:
 *
 *   1. `type_id` is pinned to "custom" by the schema below (no `.oneOf(["custom", ...])` escape
 *      hatch) — a scheduled workflow must never be able to submit `run_ads` (or any future type with
 *      a real executor). It may only ever leave a note for a human.
 *   2. There is deliberately no `workflow` field in this schema at all (contrast
 *      growth-agent/action-items/route.tsx, which accepts one). The smart route handler's
 *      `noUnknownPathPrefixes: ["body", ...]` (see route-handlers/smart-request.tsx) rejects any
 *      extra body field, so sending `workflow` 400s rather than being silently dropped. Without this,
 *      a compromised or careless workflow could get another automation deployed unreviewed —
 *      recursion a server-auth caller must never trigger.
 *   3. `dedupe_key` is REQUIRED, not optional. A daily monitor whose trigger condition stays true
 *      would otherwise file a new action item every run forever; see server-bridge.ts's
 *      createGrowthServerActionItem for the dedupe window and how the key is stored.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      workflow_id: yupString().defined(),
      type_id: yupString().oneOf(["custom"]).defined(),
      category: yupString().oneOf([...GROWTH_CATEGORIES]).defined(),
      tags: yupArray(yupString().defined()).max(10).default([]),
      title: yupString().max(500).defined(),
      description: yupString().defined(),
      payload: jsonSchema.optional(),
      dedupe_key: yupString().max(200).defined(),
      watched_metrics: yupArray(yupObject({
        metric_id: yupString().defined(),
        window_days: yupNumber().integer().defined(),
      }).defined()).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      action_item_id: yupString().defined(),
      deduped: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await createGrowthServerActionItem({
      tenancy: auth.tenancy,
      workflowId: body.workflow_id,
      item: {
        category: body.category,
        tags: body.tags,
        title: body.title,
        description: body.description,
        payload: body.payload,
        watchedMetrics: body.watched_metrics,
        dedupeKey: body.dedupe_key,
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { action_item_id: result.actionItemId, deduped: result.deduped },
    };
  },
});
