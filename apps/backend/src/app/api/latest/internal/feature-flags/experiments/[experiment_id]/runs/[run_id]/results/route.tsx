import { ensureAnalyticsInstalledForExperiments } from "@/lib/feature-flags/experiment-api";
import { validateExperimentConfig } from "@/lib/feature-flags/experiment-config";
import { computeExperimentRunResults } from "@/lib/feature-flags/experiment-results";
import { getExperimentRun } from "@/lib/feature-flags/experiment-runs";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, userSpecifiedIdSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      experiment_id: userSpecifiedIdSchema("experimentId").defined(),
      run_id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    // The results shape is defined (and typed) in experiment-results.ts; it is
    // large and internal-only, so it's passed through rather than re-declared
    // as a parallel yup schema that would inevitably drift.
    body: yupMixed().defined(),
  }),
  async handler({ auth, params }) {
    ensureAnalyticsInstalledForExperiments(auth.tenancy);
    const run = await getExperimentRun({ tenancy: auth.tenancy, experimentId: params.experiment_id, runId: params.run_id });
    if (run.state === "DRAFT") {
      throw new StatusError(StatusError.BadRequest, "Experiment run has not started yet, so there are no results");
    }
    // The snapshot was validated at freeze time; re-validating here guards
    // against DB-level tampering or a schema drift bug — fail loudly (500,
    // reported) rather than compute results from a config we don't understand.
    let config;
    try {
      config = await validateExperimentConfig(run.configSnapshot);
    } catch (error) {
      const assertionError = new HexclaveAssertionError(`Frozen experiment snapshot for run ${run.id} failed re-validation; the snapshot should be immutable after start`, { cause: error });
      captureError("experiment-results", assertionError);
      throw assertionError;
    }
    const results = await computeExperimentRunResults({
      id: run.id,
      projectId: run.projectId,
      branchId: run.branchId,
      experimentId: run.experimentId,
      configRevisionHash: run.configRevisionHash,
      config,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: results,
    };
  },
});
