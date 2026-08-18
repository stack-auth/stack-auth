import { globalPrismaClient } from "@/prisma-client";
import type { Tenancy } from "@/lib/tenancies";
import type { FeatureFlagsConfig } from "@hexclave/shared/dist/feature-flags/types";
import { overlayActiveExperimentRuns, type ActiveExperimentRunOverlay } from "./active-experiment-overlay";
import { validateExperimentConfig } from "./experiment-config";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export { overlayActiveExperimentRuns, type ActiveExperimentRunOverlay } from "./active-experiment-overlay";

/**
 * Overlays currently running immutable experiment snapshots onto branch config.
 * Lifecycle state stays in Prisma, while the shared evaluator remains pure and
 * server bootstrap consumers receive the exact same deterministic rules.
 */
export async function withActiveExperimentRuns(tenancy: Tenancy, config: FeatureFlagsConfig): Promise<FeatureFlagsConfig> {
  // Regular feature flags do not require Analytics, but experiment assignment
  // and exposure attribution do. If Analytics is disabled after a run starts,
  // stop assigning experiment traffic instead of producing unrecordable data.
  if (tenancy.config.apps.installed["analytics"]?.enabled !== true) return config;

  const runs = await globalPrismaClient.experimentRun.findMany({
    where: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      state: "RUNNING",
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  if (runs.length === 0) return config;

  const overlays: ActiveExperimentRunOverlay[] = [];
  for (const run of runs) {
    let snapshot;
    try {
      snapshot = await validateExperimentConfig(run.configSnapshot);
    } catch (error) {
      // Schema tightening or a corrupt row must not 500 every evaluate and
      // bootstrap request for the branch. Skip the run so other flags still
      // evaluate; the frozen row remains for audit and results.
      captureError("feature-flags-invalid-experiment-snapshot", new HexclaveAssertionError(
        `Frozen experiment snapshot for run ${run.id} is invalid; skipping overlay so other flags still evaluate`,
        { cause: error },
      ));
      continue;
    }
    overlays.push({
      id: run.id,
      experimentId: run.experimentId,
      configRevisionHash: run.configRevisionHash,
      snapshot,
    });
  }
  return overlayActiveExperimentRuns(config, overlays);
}
