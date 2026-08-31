import { requireGrowthAppEnabled } from "@/lib/growth/dashboard";
import { evaluateGrowthMilestones } from "@/lib/growth/orchestration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Evaluates this branch's armed milestones against the latest stored daily rollup. The per-
 * milestone lastEvaluatedAt CAS caps evaluation at once per hour regardless of how often (or how
 * concurrently) this is called.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({}).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      evaluated: yupNumber().defined(),
      crossed: yupArray(yupObject({
        milestone_id: yupString().defined(),
        run_id: yupString().nullable().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const result = await evaluateGrowthMilestones({
      tenancyId: auth.tenancy.id,
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        evaluated: result.evaluated,
        crossed: result.crossed.map((entry) => ({ milestone_id: entry.milestoneId, run_id: entry.runId })),
      },
    };
  },
});
