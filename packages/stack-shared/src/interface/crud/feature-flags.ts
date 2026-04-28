// Public-facing types for feature flag definitions, mirroring `branchFeatureFlagsSchema` in
// `../../config/schema.ts`. Re-exported from the runtime types module so consumers (dashboard,
// SDK) only depend on one place.

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
