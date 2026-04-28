// Public-facing types for feature flag definitions, mirroring `branchFeatureFlagsSchema` in
// `../../config/schema.ts`. Re-exported from the runtime types module so consumers (dashboard,
// SDK) only depend on one place.

import type { EvalReason } from "../../feature-flags/types";

export type {
  ConditionOperator,
  EvalContext,
  EvalReason,
  EvalResult,
  FeatureFlagsConfig,
  FlagCondition,
  FlagDef,
  FlagRule,
  FlagType,
  FlagVariant,
  HoldoutDef,
  StickyBy,
} from "../../feature-flags/types";

export { featureFlagConditionOperators } from "../../feature-flags/types";

export type FeatureFlagEvaluateRequest = {
  distinct_id?: string,
  flag_keys?: string[],
};

export type FeatureFlagEvaluateResult = {
  flag_key: string,
  variant_key: string | null,
  value?: unknown,
  reason: EvalReason,
  rule_id: string | null,
};

export type FeatureFlagEvaluateResponse = {
  results: Record<string, FeatureFlagEvaluateResult>,
};
