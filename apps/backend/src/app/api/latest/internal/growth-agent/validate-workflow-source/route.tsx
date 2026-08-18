import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import {
  consumeGrowthWorkflowValidationRateLimit,
  getGrowthActionEventSlug,
  scanWorkflowSourceWarnings,
  validateGrowthWorkflowSpec,
} from "@/lib/growth/workflow-authoring";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

// Growth-agent machine route; see sql-query/route.tsx for the auth-opt-out rationale. Validation
// failures are agent feedback, not HTTP failures (the agent reads the error string and fixes its
// source), so every outcome — including the rate limit — is a 200 with a structured body.
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      workflow_id: yupString().max(64).defined(),
      // The real limit is WORKFLOW_SOURCE_MAX_BYTES (enforced with a proper error message inside
      // the compile pipeline); this only bounds request abuse.
      source: yupString().max(500_000).defined(),
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
    // Rate-limited because each validation runs a real esbuild bundle + manifest-mode sandbox
    // execution; see consumeGrowthWorkflowValidationRateLimit for why in-memory is acceptable.
    if (!consumeGrowthWorkflowValidationRateLimit(tenancy.project.id)) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          valid: false,
          error: "Rate limit exceeded: at most 20 workflow validations per minute per project. Wait a moment and retry.",
          manifest: null,
          workflow_id_available: null,
          warnings: [],
        },
      };
    }
    const result = await validateGrowthWorkflowSpec({
      tenancy,
      workflowId: body.workflow_id,
      source: body.source,
      expectedActionEventSlug: getGrowthActionEventSlug(body.workflow_id),
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        valid: result.valid,
        error: result.error,
        manifest: result.manifest,
        workflow_id_available: result.workflowIdAvailable,
        warnings: scanWorkflowSourceWarnings(body.source),
      },
    };
  },
});
