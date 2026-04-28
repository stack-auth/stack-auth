// Runtime types for the resolved feature-flags config (post-defaults). Mirrors the yup schema in
// `../config/schema.ts` (`branchFeatureFlagsSchema`) but expressed as plain TS so consumers can
// import it without dragging in yup. Keep these in sync with the schema.

export type FlagType = "boolean" | "multivariate" | "json" | "numeric" | "string";

export type StickyBy = "userId" | "teamId" | "distinctId";

export const featureFlagConditionOperators = [
  "eq", "neq",
  "contains", "not_contains",
  "regex",
  "gt", "gte", "lt", "lte",
  "in", "not_in",
  "is_set", "is_not_set",
  "before", "after",
  "semver_eq", "semver_gt", "semver_lt",
  "in_cohort",
] as const;
export type ConditionOperator = typeof featureFlagConditionOperators[number];

export type FlagCondition = {
  attribute?: string,
  operator?: ConditionOperator,
  value?: unknown,
};

export type FlagVariant = {
  value?: unknown,
};

export type FlagRule = {
  priority?: number,
  enabled?: boolean,
  conditions?: Record<string, FlagCondition | undefined>,
  rolloutPercentage?: number,
  rolloutSeed?: string,
  stickyBy?: StickyBy,
  variantKey?: string,
  variantWeights?: Record<string, number | undefined>,
};

export type FlagDef = {
  key?: string,
  description?: string,
  type?: FlagType,
  enabled?: boolean,
  killSwitch?: boolean,
  tags?: Record<string, true | undefined>,
  ownerUserId?: string,
  dependsOn?: string,
  holdoutId?: string,
  variants?: Record<string, FlagVariant | undefined>,
  defaultVariantKey?: string,
  rules?: Record<string, FlagRule | undefined>,
};

export type HoldoutDef = {
  displayName?: string,
  percentage?: number,
  seed?: string,
};

export type FeatureFlagsConfig = {
  flags?: Record<string, FlagDef | undefined>,
  holdouts?: Record<string, HoldoutDef | undefined>,
};

/**
 * Context passed to the evaluator. `distinctId` is what bucketing hashes — it must persist across
 * a session for sticky assignments. `userId` / `teamId` are convenient shortcuts for sticky-by-user
 * / sticky-by-team rules. The other namespaces (`user`, `team`, `context`) are looked up via dotted
 * `attribute` paths in conditions.
 */
export type EvalContext = {
  distinctId?: string,
  userId?: string,
  teamId?: string,
  user?: Record<string, unknown>,
  team?: Record<string, unknown>,
  context?: Record<string, unknown>,
  // Optional cohort membership lookup for the `in_cohort` operator. Keyed by cohort id.
  cohorts?: Record<string, boolean>,
};

export type EvalReason =
  | "missing"
  | "disabled"
  | "kill_switch"
  | "dep_unmet"
  | "holdout"
  | "matched_rule"
  | "default"
  | "cycle";

export type EvalResult = {
  flagKey: string,
  variantKey: string | undefined,
  value: unknown,
  reason: EvalReason,
  ruleId?: string,
};
