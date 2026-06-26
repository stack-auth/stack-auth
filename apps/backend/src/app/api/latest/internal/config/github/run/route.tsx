import { getConfigAgentRun } from "@/lib/config";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, configAgentRunSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Returns the state of the most recent dashboard→GitHub config agent run (or
 * `null`). The dashboard polls this while a run is in flight to show progress and,
 * once `awaiting_review`, the diff. Run state lives in its own DB column, separate
 * from the config source descriptor.
 */
export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get config agent run state",
    description: "Returns the in-flight or most recent config agent run for the linked GitHub repo.",
    tags: ["Config"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
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
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { agent_run: agentRun },
    };
  },
});
