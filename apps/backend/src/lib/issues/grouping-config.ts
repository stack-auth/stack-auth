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
 * Narrows an untrusted value (a config column, a request body, an env var) to a
 * known config id. Anything unknown must be treated as "this project is on a
 * config we no longer ship" and handled explicitly by the caller — never
 * defaulted, because defaulting would re-group the project's whole history.
 */
export function isGroupingConfigId(value: unknown): value is GroupingConfigId {
  // Comparing against the literal array (rather than `GROUPING_CONFIGS.has(value as ...)`)
  // keeps this free of type casts.
  return typeof value === "string" && GROUPING_CONFIG_IDS.some((id): boolean => id === value);
}
