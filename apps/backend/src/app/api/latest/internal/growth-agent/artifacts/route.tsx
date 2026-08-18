import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { upsertGrowthArtifact } from "@/lib/growth/agent-writes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { jsonSchema, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

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
      kind: yupString().defined(),
      title: yupString().max(500).defined(),
      content: yupString().defined(),
      metadata: jsonSchema.optional(),
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
    const result = await upsertGrowthArtifact({
      tenancy,
      runId: body.run_id,
      kind: body.kind,
      title: body.title,
      content: body.content,
      metadata: body.metadata,
    });
    return { statusCode: 200, bodyType: "json", body: { artifact_id: result.artifactId } };
  },
});
