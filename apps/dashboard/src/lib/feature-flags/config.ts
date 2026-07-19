import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";

/**
 * Frontend-local mirror of the *intended* `featureFlags` branch-config section.
 *
 * INTEGRATION NOTE: the shared config schema (`packages/shared/src/config/schema.ts`)
 * does not have a `featureFlags` section yet — it is being added by the
 * config-schema workstream. Once that lands, the types in this file must be
 * replaced by (or type-checked against) the schema-derived types from
 * `@hexclave/shared/dist/config/schema`, and `parseFeatureFlagsSection` below
 * becomes a plain typed property read. Keep the shapes here in exact sync with
 * that schema; this module is the single boundary between the dashboard UI and
 * the config contract, so nothing outside `@/lib/feature-flags` should need to
 * change when the real schema arrives.
 *
 * All percentages in this contract are stored as basis points (1/100th of a
 * percent, 0..10_000) to avoid floating-point drift in config files. The UI
 * always displays them as percentages — use `formatBps`/`percentToBps`.
 */

export const BPS_TOTAL = 10_000;

export type FlagValueType = "boolean" | "string" | "number" | "json";

export type FlagVariant = {
  id: string,
  label: string,
  /**
   * JSON-encoded variant value so the config contract is uniform across flag
   * types (`true`, `"\"canary\""`, `"42"`, or arbitrary JSON). The editor
   * renders a typed input per flag type and JSON-encodes on save.
   */
  jsonValue: string,
};

export type FlagServe =
  | { type: "variant", variantId: string }
  | { type: "split", split: { variantId: string, weightBps: number }[] };

export const FLAG_OPERATORS = [
  "eq", "neq",
  "in", "not_in",
  "starts_with", "ends_with", "contains", "not_contains",
  "num_gt", "num_gte", "num_lt", "num_lte",
  "exists", "not_exists",
  "before", "after",
  "semver_eq", "semver_gt", "semver_gte", "semver_lt", "semver_lte",
  "in_segment", "not_in_segment",
] as const;

export type FlagOperator = (typeof FLAG_OPERATORS)[number];

/** How many operands each operator consumes; drives both UI and validation. */
export type FlagOperatorArity = "none" | "single" | "list";

export const FLAG_OPERATOR_METADATA: ReadonlyMap<FlagOperator, { label: string, arity: FlagOperatorArity, valueKind: "string" | "number" | "datetime" | "semver" | "segment" }> = new Map([
  ["eq", { label: "equals", arity: "single", valueKind: "string" }],
  ["neq", { label: "does not equal", arity: "single", valueKind: "string" }],
  ["in", { label: "is one of", arity: "list", valueKind: "string" }],
  ["not_in", { label: "is not one of", arity: "list", valueKind: "string" }],
  ["starts_with", { label: "starts with", arity: "single", valueKind: "string" }],
  ["ends_with", { label: "ends with", arity: "single", valueKind: "string" }],
  ["contains", { label: "contains", arity: "single", valueKind: "string" }],
  ["not_contains", { label: "does not contain", arity: "single", valueKind: "string" }],
  ["num_gt", { label: "is greater than", arity: "single", valueKind: "number" }],
  ["num_gte", { label: "is at least", arity: "single", valueKind: "number" }],
  ["num_lt", { label: "is less than", arity: "single", valueKind: "number" }],
  ["num_lte", { label: "is at most", arity: "single", valueKind: "number" }],
  ["exists", { label: "is present", arity: "none", valueKind: "string" }],
  ["not_exists", { label: "is not present", arity: "none", valueKind: "string" }],
  ["before", { label: "is before", arity: "single", valueKind: "datetime" }],
  ["after", { label: "is after", arity: "single", valueKind: "datetime" }],
  ["semver_eq", { label: "version equals", arity: "single", valueKind: "semver" }],
  ["semver_gt", { label: "version is above", arity: "single", valueKind: "semver" }],
  ["semver_gte", { label: "version is at least", arity: "single", valueKind: "semver" }],
  ["semver_lt", { label: "version is below", arity: "single", valueKind: "semver" }],
  ["semver_lte", { label: "version is at most", arity: "single", valueKind: "semver" }],
  ["in_segment", { label: "is in segment", arity: "single", valueKind: "segment" }],
  ["not_in_segment", { label: "is not in segment", arity: "single", valueKind: "segment" }],
]);

export function getOperatorMetadataOrThrow(operator: FlagOperator) {
  return FLAG_OPERATOR_METADATA.get(operator) ?? throwErr(`Unknown flag operator ${operator} — FLAG_OPERATOR_METADATA must cover every FlagOperator`);
}

export type FlagCondition = {
  /** Evaluation-context attribute path, e.g. "user.email" or "custom.plan". */
  attribute: string,
  operator: FlagOperator,
  /** Operand for arity "single" operators; must be undefined otherwise. */
  value?: string,
  /** Operands for arity "list" operators; must be undefined otherwise. */
  values?: string[],
};

export type FlagRule = {
  id: string,
  label: string,
  enabled: boolean,
  /** All conditions must match (logical AND). */
  conditions: FlagCondition[],
  serve: FlagServe,
  /**
   * Portion of matched traffic this rule captures, in basis points. Traffic
   * that matches but falls outside the rollout continues to the next rule.
   */
  rolloutBps: number,
};

export type FlagPrerequisite = {
  flagKey: string,
  requiredVariantId: string,
};

export type FlagConfig = {
  displayName: string,
  description: string,
  type: FlagValueType,
  enabled: boolean,
  /** Kill switch: serve the fallback variant unconditionally, without evaluation. */
  killed: boolean,
  archived: boolean,
  variants: FlagVariant[],
  /** Served when the flag is disabled, killed, held out, or evaluation fails. */
  fallbackVariantId: string,
  /** Served when the flag is enabled and no targeting rule captures the request. */
  defaultServe: FlagServe,
  rules: FlagRule[],
  prerequisites: FlagPrerequisite[],
  /** Portion of all traffic excluded from targeting entirely (serves fallback). */
  holdoutBps: number,
  /** Flags/experiments sharing a group never both target the same unit. */
  mutualExclusionGroup: string | null,
  createdAtMillis: number,
};

export type FlagSegment = {
  displayName: string,
  conditions: FlagCondition[],
};

export type MetricSource =
  | { type: "page_view", urlPattern: string }
  | { type: "click", selector: string }
  | { type: "funnel", steps: { eventName: string }[] }
  | { type: "custom_event", eventName: string }
  | { type: "numeric_value", eventName: string, propertyName: string, aggregation: "sum" | "average" };

export type MetricSourceType = MetricSource["type"];

export type ExperimentMetricRole = "primary" | "secondary" | "guardrail";

export type ExperimentMetric = {
  id: string,
  label: string,
  role: ExperimentMetricRole,
  source: MetricSource,
};

export type ExperimentConfig = {
  displayName: string,
  hypothesis: string,
  flagKey: string,
  assignmentUnit: "user" | "team",
  /** Split of enrolled traffic across the linked flag's variants; sums to 10_000. */
  allocation: { variantId: string, weightBps: number }[],
  /** Portion of eligible traffic enrolled into the experiment. */
  trafficBps: number,
  metrics: ExperimentMetric[],
  attributionWindowHours: number,
  mutualExclusionGroup: string | null,
  schedule: { startAtIso: string | null, endAtIso: string | null },
  archived: boolean,
  createdAtMillis: number,
};

export type FeatureFlagsSection = {
  flags: Map<string, FlagConfig>,
  segments: Map<string, FlagSegment>,
  experiments: Map<string, ExperimentConfig>,
};

/** Config path prefix of the intended shared schema section. */
export const FEATURE_FLAGS_CONFIG_PREFIX = "featureFlags";

export function flagConfigPath(flagKey: string): string {
  return `${FEATURE_FLAGS_CONFIG_PREFIX}.flags.${flagKey}`;
}

export function experimentConfigPath(experimentId: string): string {
  return `${FEATURE_FLAGS_CONFIG_PREFIX}.experiments.${experimentId}`;
}

const FLAG_KEY_REGEX = /^[a-z][a-z0-9-]{0,63}$/;

export function validateFlagKey(key: string): string | null {
  if (key.length === 0) return "Key is required.";
  if (!FLAG_KEY_REGEX.test(key)) {
    return "Keys must be 1-64 characters of lowercase letters, digits, and dashes, starting with a letter.";
  }
  return null;
}

export function formatBps(bps: number): string {
  // Show up to two decimals but strip trailing zeros ("33.33%", "50%", "0.01%").
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function percentToBps(percentText: string): number | null {
  const trimmed = percentText.trim().replace(/%$/, "");
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  // Round to whole basis points; the contract cannot represent finer precision.
  return Math.round(parsed * 100);
}

export function bpsToPercentText(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent) ? percent.toString() : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export type FlagStatus = "enabled" | "disabled" | "killed" | "archived";

export function getFlagStatus(flag: FlagConfig): FlagStatus {
  // Archived wins over killed so archived flags don't keep screaming "killed";
  // killed wins over enabled/disabled because the kill switch overrides both.
  if (flag.archived) return "archived";
  if (flag.killed) return "killed";
  return flag.enabled ? "enabled" : "disabled";
}

/**
 * Human summary of what portion of traffic currently receives a non-fallback
 * variant, for the flags list. This intentionally describes configuration, not
 * live traffic — live exposure counts come from the activity adapter.
 */
export function describeCurrentRollout(flag: FlagConfig): string {
  const status = getFlagStatus(flag);
  if (status === "killed") return "0% (killed)";
  if (status === "archived") return "0% (archived)";
  if (status === "disabled") return "0% (disabled)";
  const targetableBps = BPS_TOTAL - flag.holdoutBps;
  const activeRules = flag.rules.filter((rule) => rule.enabled);
  if (activeRules.length === 0 && flag.defaultServe.type === "variant") {
    return `${formatBps(targetableBps)} → ${describeServe(flag, flag.defaultServe)}`;
  }
  const ruleSummary = activeRules.length > 0 ? `${activeRules.length} rule${activeRules.length === 1 ? "" : "s"}, ` : "";
  return `${formatBps(targetableBps)} targeted (${ruleSummary}default ${describeServe(flag, flag.defaultServe)})`;
}

export function describeServe(flag: FlagConfig, serve: FlagServe): string {
  if (serve.type === "variant") {
    return getVariantOrThrow(flag, serve.variantId).label;
  }
  return serve.split
    .map((entry) => `${getVariantOrThrow(flag, entry.variantId).label} ${formatBps(entry.weightBps)}`)
    .join(" / ");
}

export function getVariantOrThrow(flag: FlagConfig, variantId: string): FlagVariant {
  return flag.variants.find((variant) => variant.id === variantId)
    ?? throwErr(`Flag references unknown variant ${variantId} — flag config must be internally consistent`);
}

// ---------------------------------------------------------------------------
// Parsing the (not yet schema-backed) `featureFlags` section off CompleteConfig
// ---------------------------------------------------------------------------

class FeatureFlagsConfigShapeError extends HexclaveAssertionError {
  constructor(path: string, expectation: string) {
    super(`Invalid featureFlags config at ${path}: expected ${expectation}`);
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new FeatureFlagsConfigShapeError(path, "an object");
  }
  return Object.fromEntries(Object.entries(value));
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new FeatureFlagsConfigShapeError(path, "a string");
  return value;
}

function asStringOrNull(value: unknown, path: string): string | null {
  if (value == null) return null;
  return asString(value, path);
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new FeatureFlagsConfigShapeError(path, "a boolean");
  return value;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new FeatureFlagsConfigShapeError(path, "a finite number");
  return value;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new FeatureFlagsConfigShapeError(path, "an array");
  return value;
}

function asOneOf<const T extends readonly string[]>(value: unknown, options: T, path: string): T[number] {
  const text = asString(value, path);
  // find() (rather than includes()) keeps the literal-union element type
  // without needing a cast on the way out.
  const match = options.find((option) => option === text);
  if (match == null) throw new FeatureFlagsConfigShapeError(path, `one of ${options.join(", ")}`);
  return match;
}

function parseServe(value: unknown, path: string): FlagServe {
  const record = asRecord(value, path);
  const type = asOneOf(record.type, ["variant", "split"] as const, `${path}.type`);
  if (type === "variant") {
    return { type, variantId: asString(record.variantId, `${path}.variantId`) };
  }
  return {
    type,
    split: asArray(record.split, `${path}.split`).map((entry, index) => {
      const entryRecord = asRecord(entry, `${path}.split[${index}]`);
      return {
        variantId: asString(entryRecord.variantId, `${path}.split[${index}].variantId`),
        weightBps: asNumber(entryRecord.weightBps, `${path}.split[${index}].weightBps`),
      };
    }),
  };
}

function parseCondition(value: unknown, path: string): FlagCondition {
  const record = asRecord(value, path);
  const operator = asOneOf(record.operator, FLAG_OPERATORS, `${path}.operator`);
  const arity = getOperatorMetadataOrThrow(operator).arity;
  return {
    attribute: asString(record.attribute, `${path}.attribute`),
    operator,
    ...arity === "single" ? { value: asString(record.value, `${path}.value`) } : {},
    ...arity === "list" ? { values: asArray(record.values, `${path}.values`).map((entry, index) => asString(entry, `${path}.values[${index}]`)) } : {},
  };
}

function parseFlag(value: unknown, path: string): FlagConfig {
  const record = asRecord(value, path);
  return {
    displayName: asString(record.displayName, `${path}.displayName`),
    description: asString(record.description, `${path}.description`),
    type: asOneOf(record.type, ["boolean", "string", "number", "json"] as const, `${path}.type`),
    enabled: asBoolean(record.enabled, `${path}.enabled`),
    killed: asBoolean(record.killed, `${path}.killed`),
    archived: asBoolean(record.archived, `${path}.archived`),
    variants: asArray(record.variants, `${path}.variants`).map((entry, index) => {
      const variantRecord = asRecord(entry, `${path}.variants[${index}]`);
      return {
        id: asString(variantRecord.id, `${path}.variants[${index}].id`),
        label: asString(variantRecord.label, `${path}.variants[${index}].label`),
        jsonValue: asString(variantRecord.jsonValue, `${path}.variants[${index}].jsonValue`),
      };
    }),
    fallbackVariantId: asString(record.fallbackVariantId, `${path}.fallbackVariantId`),
    defaultServe: parseServe(record.defaultServe, `${path}.defaultServe`),
    rules: asArray(record.rules, `${path}.rules`).map((entry, index) => {
      const ruleRecord = asRecord(entry, `${path}.rules[${index}]`);
      return {
        id: asString(ruleRecord.id, `${path}.rules[${index}].id`),
        label: asString(ruleRecord.label, `${path}.rules[${index}].label`),
        enabled: asBoolean(ruleRecord.enabled, `${path}.rules[${index}].enabled`),
        conditions: asArray(ruleRecord.conditions, `${path}.rules[${index}].conditions`).map((condition, conditionIndex) =>
          parseCondition(condition, `${path}.rules[${index}].conditions[${conditionIndex}]`)),
        serve: parseServe(ruleRecord.serve, `${path}.rules[${index}].serve`),
        rolloutBps: asNumber(ruleRecord.rolloutBps, `${path}.rules[${index}].rolloutBps`),
      };
    }),
    prerequisites: asArray(record.prerequisites, `${path}.prerequisites`).map((entry, index) => {
      const prerequisiteRecord = asRecord(entry, `${path}.prerequisites[${index}]`);
      return {
        flagKey: asString(prerequisiteRecord.flagKey, `${path}.prerequisites[${index}].flagKey`),
        requiredVariantId: asString(prerequisiteRecord.requiredVariantId, `${path}.prerequisites[${index}].requiredVariantId`),
      };
    }),
    holdoutBps: asNumber(record.holdoutBps, `${path}.holdoutBps`),
    mutualExclusionGroup: asStringOrNull(record.mutualExclusionGroup, `${path}.mutualExclusionGroup`),
    createdAtMillis: asNumber(record.createdAtMillis, `${path}.createdAtMillis`),
  };
}

function parseMetricSource(value: unknown, path: string): MetricSource {
  const record = asRecord(value, path);
  const type = asOneOf(record.type, ["page_view", "click", "funnel", "custom_event", "numeric_value"] as const, `${path}.type`);
  switch (type) {
    case "page_view": {
      return { type, urlPattern: asString(record.urlPattern, `${path}.urlPattern`) };
    }
    case "click": {
      return { type, selector: asString(record.selector, `${path}.selector`) };
    }
    case "funnel": {
      return {
        type,
        steps: asArray(record.steps, `${path}.steps`).map((entry, index) => ({
          eventName: asString(asRecord(entry, `${path}.steps[${index}]`).eventName, `${path}.steps[${index}].eventName`),
        })),
      };
    }
    case "custom_event": {
      return { type, eventName: asString(record.eventName, `${path}.eventName`) };
    }
    case "numeric_value": {
      return {
        type,
        eventName: asString(record.eventName, `${path}.eventName`),
        propertyName: asString(record.propertyName, `${path}.propertyName`),
        aggregation: asOneOf(record.aggregation, ["sum", "average"] as const, `${path}.aggregation`),
      };
    }
  }
}

function parseExperiment(value: unknown, path: string): ExperimentConfig {
  const record = asRecord(value, path);
  const schedule = asRecord(record.schedule, `${path}.schedule`);
  return {
    displayName: asString(record.displayName, `${path}.displayName`),
    hypothesis: asString(record.hypothesis, `${path}.hypothesis`),
    flagKey: asString(record.flagKey, `${path}.flagKey`),
    assignmentUnit: asOneOf(record.assignmentUnit, ["user", "team"] as const, `${path}.assignmentUnit`),
    allocation: asArray(record.allocation, `${path}.allocation`).map((entry, index) => {
      const entryRecord = asRecord(entry, `${path}.allocation[${index}]`);
      return {
        variantId: asString(entryRecord.variantId, `${path}.allocation[${index}].variantId`),
        weightBps: asNumber(entryRecord.weightBps, `${path}.allocation[${index}].weightBps`),
      };
    }),
    trafficBps: asNumber(record.trafficBps, `${path}.trafficBps`),
    metrics: asArray(record.metrics, `${path}.metrics`).map((entry, index) => {
      const metricRecord = asRecord(entry, `${path}.metrics[${index}]`);
      return {
        id: asString(metricRecord.id, `${path}.metrics[${index}].id`),
        label: asString(metricRecord.label, `${path}.metrics[${index}].label`),
        role: asOneOf(metricRecord.role, ["primary", "secondary", "guardrail"] as const, `${path}.metrics[${index}].role`),
        source: parseMetricSource(metricRecord.source, `${path}.metrics[${index}].source`),
      };
    }),
    attributionWindowHours: asNumber(record.attributionWindowHours, `${path}.attributionWindowHours`),
    mutualExclusionGroup: asStringOrNull(record.mutualExclusionGroup, `${path}.mutualExclusionGroup`),
    schedule: {
      startAtIso: asStringOrNull(schedule.startAtIso, `${path}.schedule.startAtIso`),
      endAtIso: asStringOrNull(schedule.endAtIso, `${path}.schedule.endAtIso`),
    },
    archived: asBoolean(record.archived, `${path}.archived`),
    createdAtMillis: asNumber(record.createdAtMillis, `${path}.createdAtMillis`),
  };
}

/**
 * Reads the intended `featureFlags` section off the rendered project config
 * (`CompleteConfig` — typed as `object` here because the schema-derived type
 * gains the `featureFlags` property only once the config-schema workstream
 * merges; the structural validation below is the contract until then).
 *
 * A missing section is a valid state (the schema workstream hasn't merged, or
 * the project simply has no flags yet) and parses to empty maps — that is NOT
 * a silent fallback but the contract's empty value. A section that exists with
 * the wrong shape throws loudly, because that means the dashboard and schema
 * disagree about the frozen contract.
 */
export function parseFeatureFlagsSection(config: object): FeatureFlagsSection {
  const raw: unknown = Reflect.get(config, FEATURE_FLAGS_CONFIG_PREFIX);
  if (raw == null) {
    return { flags: new Map(), segments: new Map(), experiments: new Map() };
  }
  const record = asRecord(raw, FEATURE_FLAGS_CONFIG_PREFIX);
  return {
    flags: new Map(Object.entries(asRecord(record.flags ?? {}, "featureFlags.flags"))
      .map(([key, value]): [string, FlagConfig] => [key, parseFlag(value, `featureFlags.flags.${key}`)])),
    segments: new Map(Object.entries(asRecord(record.segments ?? {}, "featureFlags.segments"))
      .map(([key, value]): [string, FlagSegment] => {
        const segmentRecord = asRecord(value, `featureFlags.segments.${key}`);
        return [key, {
          displayName: asString(segmentRecord.displayName, `featureFlags.segments.${key}.displayName`),
          conditions: asArray(segmentRecord.conditions, `featureFlags.segments.${key}.conditions`).map((condition, index) =>
            parseCondition(condition, `featureFlags.segments.${key}.conditions[${index}]`)),
        }];
      })),
    experiments: new Map(Object.entries(asRecord(record.experiments ?? {}, "featureFlags.experiments"))
      .map(([key, value]): [string, ExperimentConfig] => [key, parseExperiment(value, `featureFlags.experiments.${key}`)])),
  };
}

/**
 * Validates a complete flag draft before it is written to config. Returns all
 * problems at once so the publish-review step can list them.
 */
export function validateFlagConfig(flagKey: string, flag: FlagConfig, section: FeatureFlagsSection): string[] {
  const errors: string[] = [];
  const keyError = validateFlagKey(flagKey);
  if (keyError != null) errors.push(keyError);
  if (flag.displayName.trim().length === 0) errors.push("Display name is required.");
  if (flag.variants.length === 0) errors.push("At least one variant is required.");
  const variantIds = new Set(flag.variants.map((variant) => variant.id));
  if (variantIds.size !== flag.variants.length) errors.push("Variant IDs must be unique.");
  for (const variant of flag.variants) {
    if (variant.label.trim().length === 0) errors.push(`Variant "${variant.id}" needs a label.`);
    const valueError = validateVariantJsonValue(flag.type, variant.jsonValue);
    if (valueError != null) errors.push(`Variant "${variant.label || variant.id}": ${valueError}`);
  }
  if (!variantIds.has(flag.fallbackVariantId)) errors.push("The fallback variant must be one of the flag's variants.");
  errors.push(...validateServe(flag.defaultServe, variantIds, "Default rule"));
  flag.rules.forEach((rule, index) => {
    const ruleName = rule.label.trim().length > 0 ? `Rule "${rule.label}"` : `Rule ${index + 1}`;
    if (rule.conditions.length === 0) errors.push(`${ruleName} needs at least one condition.`);
    for (const condition of rule.conditions) {
      errors.push(...validateCondition(condition, section).map((error) => `${ruleName}: ${error}`));
    }
    errors.push(...validateServe(rule.serve, variantIds, ruleName));
    if (rule.rolloutBps < 0 || rule.rolloutBps > BPS_TOTAL) errors.push(`${ruleName}: rollout must be between 0% and 100%.`);
  });
  if (flag.holdoutBps < 0 || flag.holdoutBps > BPS_TOTAL) errors.push("Holdout must be between 0% and 100%.");
  for (const prerequisite of flag.prerequisites) {
    const prerequisiteFlag = section.flags.get(prerequisite.flagKey);
    if (prerequisite.flagKey === flagKey) {
      errors.push("A flag cannot be its own prerequisite.");
    } else if (prerequisiteFlag == null) {
      errors.push(`Prerequisite flag "${prerequisite.flagKey}" does not exist.`);
    } else if (!prerequisiteFlag.variants.some((variant) => variant.id === prerequisite.requiredVariantId)) {
      errors.push(`Prerequisite "${prerequisite.flagKey}" does not have the selected variant.`);
    }
  }
  return errors;
}

function validateServe(serve: FlagServe, variantIds: Set<string>, context: string): string[] {
  const errors: string[] = [];
  if (serve.type === "variant") {
    if (!variantIds.has(serve.variantId)) errors.push(`${context}: served variant no longer exists.`);
    return errors;
  }
  if (serve.split.length === 0) {
    errors.push(`${context}: a percentage split needs at least one variant.`);
    return errors;
  }
  let total = 0;
  for (const entry of serve.split) {
    if (!variantIds.has(entry.variantId)) errors.push(`${context}: split references a variant that no longer exists.`);
    if (entry.weightBps < 0 || entry.weightBps > BPS_TOTAL) errors.push(`${context}: split weights must be between 0% and 100%.`);
    total += entry.weightBps;
  }
  if (total !== BPS_TOTAL) {
    errors.push(`${context}: split weights must add up to exactly 100% (currently ${formatBps(total)}).`);
  }
  return errors;
}

function validateCondition(condition: FlagCondition, section: FeatureFlagsSection): string[] {
  const errors: string[] = [];
  if (condition.attribute.trim().length === 0) errors.push("every condition needs an attribute.");
  const metadata = getOperatorMetadataOrThrow(condition.operator);
  if (metadata.arity === "single" && (condition.value == null || condition.value.trim().length === 0)) {
    errors.push(`"${metadata.label}" needs a value.`);
  }
  if (metadata.arity === "list" && (condition.values == null || condition.values.length === 0)) {
    errors.push(`"${metadata.label}" needs at least one value.`);
  }
  if (metadata.valueKind === "number" && condition.value != null && !Number.isFinite(Number(condition.value))) {
    errors.push(`"${condition.value}" is not a number.`);
  }
  if (metadata.valueKind === "datetime" && condition.value != null && Number.isNaN(Date.parse(condition.value))) {
    errors.push(`"${condition.value}" is not a valid date/time.`);
  }
  if (metadata.valueKind === "semver" && condition.value != null && !isStrictSemver(condition.value)) {
    errors.push(`"${condition.value}" is not a strict semver version (like 1.2.3).`);
  }
  if (metadata.valueKind === "segment" && condition.value != null && !section.segments.has(condition.value)) {
    errors.push(`segment "${condition.value}" does not exist.`);
  }
  return errors;
}

// Strict semver per semver.org (no leading "v", no loose forms) because the
// evaluator contract specifies strict comparisons — a loose match here would
// let the dashboard save conditions the backend then rejects.
const STRICT_SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isStrictSemver(version: string): boolean {
  return STRICT_SEMVER_REGEX.test(version);
}

export function validateVariantJsonValue(flagType: FlagValueType, jsonValue: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonValue);
  } catch {
    return flagType === "json" ? "the value is not valid JSON." : "the value is missing or malformed.";
  }
  switch (flagType) {
    case "boolean": {
      return typeof parsed === "boolean" ? null : "the value must be true or false.";
    }
    case "string": {
      return typeof parsed === "string" ? null : "the value must be a string.";
    }
    case "number": {
      return typeof parsed === "number" && Number.isFinite(parsed) ? null : "the value must be a finite number.";
    }
    case "json": {
      return null;
    }
  }
}

/** Experiments whose linked flag is this one, for the "linked experiment" list column. */
export function getLinkedExperiments(section: FeatureFlagsSection, flagKey: string): { id: string, experiment: ExperimentConfig }[] {
  return [...section.experiments.entries()]
    .filter(([, experiment]) => experiment.flagKey === flagKey && !experiment.archived)
    .map(([id, experiment]) => ({ id, experiment }));
}

export function validateExperimentConfig(experiment: ExperimentConfig, section: FeatureFlagsSection): string[] {
  const errors: string[] = [];
  if (experiment.displayName.trim().length === 0) errors.push("Name is required.");
  if (experiment.hypothesis.trim().length === 0) errors.push("A hypothesis is required.");
  const flag = section.flags.get(experiment.flagKey);
  if (flag == null) {
    errors.push("The experiment must be linked to an existing flag.");
  } else {
    const variantIds = new Set(flag.variants.map((variant) => variant.id));
    if (experiment.allocation.length < 2) errors.push("Allocate traffic to at least two variants to compare them.");
    let total = 0;
    for (const entry of experiment.allocation) {
      if (!variantIds.has(entry.variantId)) errors.push("The allocation references a variant that no longer exists on the flag.");
      if (entry.weightBps < 0 || entry.weightBps > BPS_TOTAL) errors.push("Allocation weights must be between 0% and 100%.");
      total += entry.weightBps;
    }
    if (experiment.allocation.length >= 2 && total !== BPS_TOTAL) {
      errors.push(`Allocation must add up to exactly 100% (currently ${formatBps(total)}).`);
    }
  }
  if (experiment.trafficBps <= 0 || experiment.trafficBps > BPS_TOTAL) {
    errors.push("Traffic allocation must be above 0% and at most 100%.");
  }
  const primaryMetrics = experiment.metrics.filter((metric) => metric.role === "primary");
  if (primaryMetrics.length !== 1) errors.push("Exactly one primary metric is required.");
  for (const metric of experiment.metrics) {
    errors.push(...validateMetricSource(metric).map((error) => `Metric "${metric.label || metric.id}": ${error}`));
  }
  if (experiment.attributionWindowHours <= 0) errors.push("The attribution window must be positive.");
  const { startAtIso, endAtIso } = experiment.schedule;
  if (startAtIso != null && Number.isNaN(Date.parse(startAtIso))) errors.push("The start date is not a valid date/time.");
  if (endAtIso != null && Number.isNaN(Date.parse(endAtIso))) errors.push("The end date is not a valid date/time.");
  if (startAtIso != null && endAtIso != null && Date.parse(endAtIso) <= Date.parse(startAtIso)) {
    errors.push("The end date must be after the start date.");
  }
  return errors;
}

function validateMetricSource(metric: ExperimentMetric): string[] {
  if (metric.label.trim().length === 0) return ["a label is required."];
  switch (metric.source.type) {
    case "page_view": {
      return metric.source.urlPattern.trim().length === 0 ? ["a URL pattern is required."] : [];
    }
    case "click": {
      return metric.source.selector.trim().length === 0 ? ["a CSS selector is required."] : [];
    }
    case "funnel": {
      if (metric.source.steps.length < 2) return ["a funnel needs at least two steps."];
      return metric.source.steps.some((step) => step.eventName.trim().length === 0) ? ["every funnel step needs an event name."] : [];
    }
    case "custom_event": {
      return metric.source.eventName.trim().length === 0 ? ["an event name is required."] : [];
    }
    case "numeric_value": {
      const errors: string[] = [];
      if (metric.source.eventName.trim().length === 0) errors.push("an event name is required.");
      if (metric.source.propertyName.trim().length === 0) errors.push("a numeric property name is required.");
      return errors;
    }
  }
}
