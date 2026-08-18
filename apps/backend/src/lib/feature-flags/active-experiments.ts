import { globalPrismaClient } from "@/prisma-client";
import type { Tenancy } from "@/lib/tenancies";
import { getFeatureFlagsConfigErrors } from "@hexclave/shared/dist/feature-flags/schema";
import type { FeatureFlagDefinition, FeatureFlagsConfig } from "@hexclave/shared/dist/feature-flags/types";
import { validateExperimentConfig, type ExperimentConfig } from "./experiment-config";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

function findFlagId(config: FeatureFlagsConfig, configuredFlagId: string): string | undefined {
  if (config.flags?.[configuredFlagId] !== undefined) return configuredFlagId;
  return Object.entries(config.flags ?? {}).find(([, flag]) => flag?.key === configuredFlagId)?.[0];
}

export type ActiveExperimentRunOverlay = {
  id: string,
  experimentId: string,
  configRevisionHash: string,
  snapshot: ExperimentConfig,
};

/**
 * Pure overlay used by both the request path and tests. A run that would make
 * the published config fail whole-config validation is skipped: server SDKs
 * re-validate bootstrap with `getFeatureFlagsConfigErrors`, so one deleted or
 * type-changed experiment must not take down every local flag evaluation.
 */
export function overlayActiveExperimentRuns(
  config: FeatureFlagsConfig,
  runs: readonly ActiveExperimentRunOverlay[],
): FeatureFlagsConfig {
  if (runs.length === 0) return config;

  let flags: Record<string, FeatureFlagDefinition | undefined> = { ...config.flags };
  let experiments = { ...config.experiments };
  const activeFlagIds = new Set<string>();
  for (const run of runs) {
    const snapshot = run.snapshot;
    const flagId = findFlagId({ ...config, flags }, snapshot.flag_id);
    if (flagId === undefined) {
      // A pushed config can race a lifecycle request. The frozen run remains
      // intact for audit/results, but without the flag's public definition
      // there is no safe key through which to expose it in this config version.
      continue;
    }
    if (activeFlagIds.has(flagId)) {
      // The migration's partial unique index prevents new collisions. Keep the
      // oldest run (caller must pass oldest-first) if legacy/corrupt data
      // predates it so a single bad row cannot make every flag evaluation fail.
      continue;
    }
    const flag = flags[flagId];
    const experiment = experiments[run.experimentId];
    if (flag === undefined || experiment === undefined || experiment.archived === true) {
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
    const candidate: FeatureFlagsConfig = {
      ...config,
      flags: {
        ...flags,
        [flagId]: {
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
        },
      },
      experiments: {
        ...experiments,
        [run.experimentId]: {
          ...experiment,
          flagId,
          assignmentUnit: snapshot.assignment_unit,
          trafficAllocationBasisPoints: snapshot.traffic_allocation_basis_points,
          controlVariantKey: snapshot.control_variant_id,
          variantWeights,
        },
      },
    };
    if (getFeatureFlagsConfigErrors(candidate).length > 0) {
      continue;
    }
    flags = candidate.flags ?? flags;
    experiments = candidate.experiments ?? experiments;
    activeFlagIds.add(flagId);
  }
  return { ...config, flags, experiments };
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

  const overlays: ActiveExperimentRunOverlay[] = [];
  for (const run of runs) {
    let snapshot;
    try {
      snapshot = await validateExperimentConfig(run.configSnapshot);
    } catch (error) {
      throw new HexclaveAssertionError(`Frozen experiment snapshot for run ${run.id} is invalid; persisted snapshots must remain valid after creation`, { cause: error });
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

const checkoutFlag = {
  key: "checkout",
  type: "boolean" as const,
  enabled: true,
  allocationSalt: "checkout-allocation",
  fallbackVariantKey: "off",
  variants: { on: { value: true }, off: { value: false } },
};

const checkoutExperiment = {
  key: "checkout-copy",
  hypothesis: "The new copy increases checkout completion",
  flagId: "checkout",
  assignmentUnit: "user" as const,
  trafficAllocationBasisPoints: 10_000,
  controlVariantKey: "off",
  variantWeights: { off: 5_000, on: 5_000 },
  primaryMetric: {
    id: "completed",
    type: "custom_event" as const,
    direction: "increase" as const,
    eventName: "checkout-completed",
    attributionWindowSeconds: 86_400,
  },
};

function checkoutSnapshot(flagId = "checkout"): ExperimentConfig {
  return {
    flag_id: flagId,
    assignment_unit: "user",
    traffic_allocation_basis_points: 10_000,
    control_variant_id: "off",
    variants: {
      off: { weight_basis_points: 5_000, flag_value: false },
      on: { weight_basis_points: 5_000, flag_value: true },
    },
    primary_metric: { id: "completed", kind: "binary", event_name: "checkout-completed", direction: "increase" },
    secondary_metrics: [],
    guardrail_metrics: [],
    attribution_window_seconds: 86_400,
  };
}

import.meta.vitest?.test("overlays a running experiment without invalidating the published config", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: { checkout: checkoutFlag },
    experiments: { checkoutExperiment },
  };
  const overlaid = overlayActiveExperimentRuns(config, [{
    id: "run-1",
    experimentId: "checkoutExperiment",
    configRevisionHash: "revision-1",
    snapshot: checkoutSnapshot(),
  }]);
  expect(getFeatureFlagsConfigErrors(overlaid)).toEqual([]);
  expect(overlaid.flags?.checkout?.rules?.["experiment_run-1"]).toMatchObject({
    experimentId: "checkoutExperiment",
    experimentRunId: "run-1",
    stickyBy: "userId",
    priority: 2_000_000,
  });
});

import.meta.vitest?.test("skips a run whose experiment was removed so bootstrap validation still passes", ({ expect }) => {
  const config: FeatureFlagsConfig = { flags: { checkout: checkoutFlag } };
  const overlaid = overlayActiveExperimentRuns(config, [{
    id: "run-1",
    experimentId: "deletedExperiment",
    configRevisionHash: "revision-1",
    snapshot: checkoutSnapshot(),
  }]);
  expect(overlaid).toEqual(config);
  expect(getFeatureFlagsConfigErrors(overlaid)).toEqual([]);
});

import.meta.vitest?.test("skips a run that would change a boolean flag to incompatible frozen values", ({ expect }) => {
  const config: FeatureFlagsConfig = {
    flags: { checkout: checkoutFlag },
    experiments: { checkoutExperiment },
  };
  const overlaid = overlayActiveExperimentRuns(config, [{
    id: "run-1",
    experimentId: "checkoutExperiment",
    configRevisionHash: "revision-1",
    snapshot: {
      ...checkoutSnapshot(),
      variants: {
        off: { weight_basis_points: 5_000, flag_value: "off" },
        on: { weight_basis_points: 5_000, flag_value: "on" },
      },
    },
  }]);
  expect(overlaid.flags?.checkout?.rules?.["experiment_run-1"]).toBeUndefined();
  expect(overlaid.flags?.checkout?.variants?.on?.value).toBe(true);
  expect(getFeatureFlagsConfigErrors(overlaid)).toEqual([]);
});
