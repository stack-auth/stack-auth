import { requireGrowthAppEnabled, resolveGrowthRunIntegrations } from "@/lib/growth/dashboard";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * The human's answer to a run's integrations step. `continue` is taken at face value — there is no
 * ad platform integration in this build to verify it against, so the precondition returns with that
 * integration; `skip` records that the analysis should run on product data only — and, via the prior
 * run's SKIPPED phase row, that future runs must not ask again. Both settle the
 * phase CAS-style (409 when it is no longer pending) and transactionally enqueue the activation
 * event that resumes the dormant run (see resolveGrowthRunIntegrations).
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
    params: yupObject({
      run_id: yupString().uuid().defined(),
    }).defined(),
    body: yupObject({
      action: yupString().oneOf(["skip", "continue"]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, params, body }) => {
    requireGrowthAppEnabled(auth.tenancy);
    const runBody = await resolveGrowthRunIntegrations({
      tenancy: auth.tenancy,
      runId: params.run_id,
      action: body.action,
    });
    return { statusCode: 200, bodyType: "json", body: runBody };
  },
});
