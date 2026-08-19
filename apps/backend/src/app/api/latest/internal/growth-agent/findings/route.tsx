import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { createGrowthFindings } from "@/lib/growth/agent-writes";
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
      run_id: yupString().uuid().optional(),
      source: yupString().defined(),
      findings: yupArray(yupObject({
        kind: yupString().defined(),
        category: yupString().oneOf([...GROWTH_CATEGORIES]).defined(),
        tags: yupArray(yupString().defined()).max(10).default([]),
        title: yupString().max(500).defined(),
        body: yupString().defined(),
        data: jsonSchema.optional(),
        document: jsonSchema.optional(),
      }).defined()).min(1).max(20).defined(),
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
    const result = await createGrowthFindings({
      tenancy,
      runId: body.run_id,
      source: body.source,
      findings: body.findings.map((finding) => ({
        kind: finding.kind,
        category: finding.category,
        tags: finding.tags,
        title: finding.title,
        body: finding.body,
        data: finding.data,
        document: finding.document,
      })),
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { created_count: result.createdCount, skipped_count: result.skippedCount },
    };
  },
});
