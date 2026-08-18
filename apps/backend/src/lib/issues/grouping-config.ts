/**
 * The registry of grouping algorithms.
 *
 * A grouping config id is baked into every occurrence row at ingest, and every
 * issue's hashes are only meaningful *within* the config that produced them.
 * That is why this is a closed union rather than a `string`: a typo in a config
 * id would not fail anywhere at runtime, it would quietly start a parallel
 * universe of issue hashes that never resolve to an existing issue.
 *
 * Adding a config:
 *   1. Append the new id to `GROUPING_CONFIG_IDS` (this widens the union).
 *   2. Add its entry to `GROUPING_CONFIGS`.
 *   3. Add a `case` to the dispatch in `grouping.ts` — the exhaustiveness check
 *      there turns "I forgot to implement it" into a compile error.
 *   4. Leave the old id in place forever, or until a durable migration job has
 *      rewritten every stored hash. Retiring a readable config on a wall-clock
 *      timer would mean a dormant issue that recurs after the timer silently
 *      becomes a brand-new issue.
 *
 * This module deliberately does NOT read project config. The caller resolves
 * which config a project is on and passes the id in, so that `computeGrouping`
 * stays a pure function of its arguments.
 */

export const GROUPING_CONFIG_IDS = ["hexclave-js:2026-08-01"] as const;

export type GroupingConfigId = typeof GROUPING_CONFIG_IDS[number];

export type GroupingConfig = {
  id: GroupingConfigId,
  /** ISO date the config was introduced. The readable chain is tried newest-first, oldest-last. */
  introducedAt: string,
  /** Shown in the dashboard and in migration-job logs; not part of any hash. */
  description: string,
};

export const GROUPING_CONFIGS: ReadonlyMap<GroupingConfigId, GroupingConfig> = new Map<GroupingConfigId, GroupingConfig>([
  [
    "hexclave-js:2026-08-01",
    {
      id: "hexclave-js:2026-08-01",
      introducedAt: "2026-08-01",
      description: "Initial JS/Node grouping: exception type + normalized stack frames, app/system variants, length-prefixed SHA-256 leaves.",
    },
  ],
]);

export const DEFAULT_GROUPING_CONFIG_ID: GroupingConfigId = "hexclave-js:2026-08-01";

/**
 * The environment-level rollout setting passed into the ingestion boundary.
 * Keep this structural rather than importing the full rendered config type:
 * the grouping implementation is also used by seed/reconciliation code and
 * must not acquire a dependency on the config loader.
 */
export type GroupingRuntimeConfig = {
  activeConfigId?: string,
  readableConfigIds?: Readonly<Record<string, { enabled?: boolean } | undefined>>,
};

export type GroupingConfigResolutionSource = "default" | "configured";

export type GroupingConfigResolution = {
  activeConfigId: GroupingConfigId,
  /** Older configs only, ordered newest-first for hash lookup/migration callers. */
  readableConfigIds: GroupingConfigId[],
  provenance: {
    active: GroupingConfigResolutionSource,
    readable: GroupingConfigResolutionSource,
  },
};

/**
 * Narrows an untrusted value (a config column, a request body, an env var) to a
 * known config id. Anything unknown must be treated as "this project is on a
 * config we no longer ship" and handled explicitly by the caller — never
 * defaulted, because defaulting would re-group the project's whole history.
 */
export function isGroupingConfigId(value: unknown): value is GroupingConfigId {
  // Compare against the literal array rather than `GROUPING_CONFIGS.has(...)`,
  // which would need a cast because Map.has() takes the key type.
  return typeof value === "string" && GROUPING_CONFIG_IDS.some((id): boolean => id === value);
}

/**
 * Resolves the complete grouping rollout contract at the ingest boundary.
 *
 * The active id is the primary algorithm. Readable ids are deliberately
 * separate: they are historical algorithms that a caller may use for lookup
 * or reconciliation, never a reason to change the newly-written primary hash.
 * The current config is excluded from the readable chain even if a stale
 * settings record marks it enabled, so a caller cannot accidentally hash the
 * same occurrence twice under one id.
 *
 * Registry order is the only ordering authority. New ids are appended to the
 * registry, so reversing it gives newest-first while retaining a deterministic
 * order independent of object-key order in project settings.
 */
export function resolveGroupingConfig(settings: GroupingRuntimeConfig | undefined): GroupingConfigResolution {
  const configuredActive = settings?.activeConfigId;
  const activeConfigId = resolveActiveGroupingConfigId(settings);

  const configuredReadable = settings?.readableConfigIds;
  if (configuredReadable !== undefined) {
    for (const id of Object.keys(configuredReadable)) {
      if (!isGroupingConfigId(id)) {
        throw new Error(`Unknown readable grouping config id ${JSON.stringify(id)}`);
      }
    }
  }

  const activeIds = new Set<GroupingConfigId>([activeConfigId]);
  const readableConfigIds = configuredReadable === undefined
    ? []
    : [...GROUPING_CONFIG_IDS]
      .reverse()
      .filter((id) => !activeIds.has(id) && configuredReadable[id]?.enabled === true);

  return {
    activeConfigId,
    readableConfigIds,
    provenance: {
      active: configuredActive === undefined ? "default" : "configured",
      readable: configuredReadable === undefined ? "default" : "configured",
    },
  };
}

/**
 * Resolves the configured active algorithm at the ingest boundary.
 *
 * Missing configuration is the backwards-compatible default for existing
 * projects. A present but unknown value is intentionally an error: silently
 * falling back would regroup the project under a different algorithm while
 * leaving the stored `groupingConfigId` claiming the old one.
 */
export function resolveActiveGroupingConfigId(settings: GroupingRuntimeConfig | undefined): GroupingConfigId {
  const configured = settings?.activeConfigId;
  if (configured === undefined) return DEFAULT_GROUPING_CONFIG_ID;
  if (!isGroupingConfigId(configured)) {
    throw new Error(`Unknown active grouping config id ${JSON.stringify(configured)}`);
  }
  return configured;
}
