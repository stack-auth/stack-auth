import { getConfigAgentRun } from "@/lib/config";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, configAgentRunSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Returns the state of a specific dashboard→GitHub config agent run (by `run_id`),
 * or `null` if it doesn't belong to this branch. The dashboard polls this while a
 * run is in flight to show progress and, once `awaiting_review`, the diff. Each run
 * is its own row in the `ConfigAgentRun` table, addressed by id.
 */
export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get config agent run state",
    description: "Returns a specific config agent run (by run_id) for the linked GitHub repo.",
    tags: ["Config"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    query: yupObject({
      run_id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      agent_run: configAgentRunSchema.nullable().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const agentRun = await getConfigAgentRun({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      runId: req.query.run_id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { agent_run: agentRun },
    };
  },
});
