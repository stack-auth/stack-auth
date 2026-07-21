import { globalPrismaClient } from "@/prisma-client";
import type { Tenancy } from "@/lib/tenancies";
import type { FeatureFlagDefinition, FeatureFlagsConfig } from "@hexclave/shared/dist/feature-flags/types";
import { validateExperimentConfig } from "./experiment-config";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

function findFlagId(config: FeatureFlagsConfig, configuredFlagId: string): string | undefined {
  if (config.flags?.[configuredFlagId] !== undefined) return configuredFlagId;
  return Object.entries(config.flags ?? {}).find(([, flag]) => flag?.key === configuredFlagId)?.[0];
}

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

  const flags: Record<string, FeatureFlagDefinition | undefined> = { ...config.flags };
  const experiments = { ...config.experiments };
  const activeFlagIds = new Set<string>();
  for (const run of runs) {
    let snapshot;
    try {
      snapshot = await validateExperimentConfig(run.configSnapshot);
    } catch (error) {
      throw new HexclaveAssertionError(`Frozen experiment snapshot for run ${run.id} is invalid; persisted snapshots must remain valid after creation`, { cause: error });
    }
    const flagId = findFlagId(config, snapshot.flag_id);
    if (flagId === undefined) {
      // A pushed config can race a lifecycle request. The frozen run remains
      // intact for audit/results, but without the flag's public definition
      // there is no safe key through which to expose it in this config version.
      continue;
    }
    if (activeFlagIds.has(flagId)) {
      // The migration's partial unique index prevents new collisions. Keep the
      // oldest run (query order above) if legacy/corrupt data predates it so a
      // single bad row cannot make every flag evaluation fail.
      continue;
    }
    activeFlagIds.add(flagId);
    const flag = flags[flagId];
    if (flag === undefined) {
      continue;
    }
    const frozenVariants = { ...flag.variants };
    for (const [variantId, variant] of Object.entries(snapshot.variants)) {
      const currentVariant = flag.variants?.[variantId];
      frozenVariants[variantId] = currentVariant === undefined
        ? { value: variant.flag_value }
        : { ...currentVariant, value: variant.flag_value };
    }
    const variantWeights = Object.fromEntries(
      Object.entries(snapshot.variants).map(([variantId, variant]) => [variantId, variant.weight_basis_points]),
    );
    const ruleId = `experiment_${run.id}`;
    flags[flagId] = {
      ...flag,
      variants: frozenVariants,
      ...(snapshot.mutual_exclusion_group_id === undefined ? {} : { mutualExclusionGroupId: snapshot.mutual_exclusion_group_id }),
      rules: {
        ...flag.rules,
        [ruleId]: {
          enabled: true,
          priority: 2_000_000,
          rolloutBasisPoints: snapshot.traffic_allocation_basis_points,
          allocationSalt: run.configRevisionHash,
          stickyBy: snapshot.assignment_unit === "team" ? "teamId" : "userId",
          variantWeights,
          experimentId: run.experimentId,
          experimentRunId: run.id,
          experimentConfigRevision: run.configRevisionHash,
        },
      },
    };
    experiments[run.experimentId] = {
      ...experiments[run.experimentId],
      flagId,
      assignmentUnit: snapshot.assignment_unit,
      trafficAllocationBasisPoints: snapshot.traffic_allocation_basis_points,
      controlVariantKey: snapshot.control_variant_id,
      variantWeights,
    };
  }
  return { ...config, flags, experiments };
}
