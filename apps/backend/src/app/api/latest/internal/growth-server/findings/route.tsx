import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { createGrowthServerFindings } from "@/lib/growth/server-bridge";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, jsonSchema, serverOrHigherAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";

/**
 * Lets a customer's own scheduled Workflow (ordinary server auth — see agent-auth.ts's module
 * comment on why growth-server/** is a wider trust boundary than growth-agent/**) file findings for
 * the growth dashboard to surface, e.g. "CPA drifted above target for 3 consecutive days".
 *
 * `source` is deliberately NOT accepted from the body the way growth-agent/findings/route.tsx takes
 * it: there `source` is one of a closed set of known phase keys the shared agent secret is trusted to
 * pick from. Here it is FORCED to `workflow_id` — the id of the calling Workflow — because a server-
 * auth caller is any holder of the project's own server key, and letting it claim an arbitrary
 * `source` string would let one workflow's findings impersonate another's (or a phase's) in the UI.
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
      findings: yupArray(yupObject({
        kind: yupString().defined(),
        category: yupString().oneOf([...GROWTH_CATEGORIES]).defined(),
        tags: yupArray(yupString().defined()).max(10).default([]),
        title: yupString().max(500).defined(),
        body: yupString().defined(),
        data: jsonSchema.optional(),
      }).defined()).min(1).max(20).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      created_count: yupNumber().defined(),
      skipped_count: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await createGrowthServerFindings({
      tenancy: auth.tenancy,
      workflowId: body.workflow_id,
      findings: body.findings.map((finding) => ({
        kind: finding.kind,
        category: finding.category,
        tags: finding.tags,
        title: finding.title,
        body: finding.body,
        data: finding.data,
      })),
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { created_count: result.createdCount, skipped_count: result.skippedCount },
    };
  },
});
