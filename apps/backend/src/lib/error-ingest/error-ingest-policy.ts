import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  scrubErrorIngestPayload,
  type ErrorIngestScrubbedValue,
  type ErrorIngestScrubOverrides,
} from "./error-ingest-scrubber";
import type { ErrorIngestItemType, ErrorIngestItemOutcome } from "./error-ingest-outcomes";

const MAX_OVERRIDE_KEYS = 32;
const MAX_OVERRIDE_KEY_BYTES = 96;
const MAX_COUNTER_BUCKETS = 10_000;
const MAX_SELECTOR_VALUES = 32;
const MAX_FILTER_RULES = 32;
const MAX_FILTER_TEXT_BYTES = 256;
const SAFE_OVERRIDE_KEY = /^(?:user\.(?:email|username|ip_address)|request\.url|url|tags\.[a-zA-Z0-9_.-]{1,64}|contexts\.[a-zA-Z0-9_.-]{1,64}|extra\.[a-zA-Z0-9_.-]{1,64})$/;
const SAFE_SELECTOR_VALUE = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,255}$/;
const SAFE_FILTER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/;
const SAFE_FILTER_FIELD = /^(?:message|level|release|environment|service|event\.(?:type|handled)|tags\.[a-zA-Z0-9_.-]{1,64}|contexts\.[a-zA-Z0-9_.-]{1,64})$/;

type JsonRecord = { [key: string]: unknown };

export const ERROR_INGEST_POLICY_VERSION = 1 as const;
export const ERROR_INGEST_NORMALIZATION_VERSION = 1 as const;
export const ERROR_INGEST_SCRUBBER_VERSION = 1 as const;

export type ErrorIngestPolicySelectors = {
  tenancyIds?: readonly string[],
  projectIds?: readonly string[],
  branchIds?: readonly string[],
};

export type ErrorIngestFilterField =
  | "message"
  | "level"
  | "release"
  | "environment"
  | "service"
  | "event.type"
  | "event.handled"
  | `tags.${string}`
  | `contexts.${string}`;

export type ErrorIngestFilterRule = {
  id: string,
  field: ErrorIngestFilterField,
  operator: "equals" | "contains",
  value: string,
};

export type ErrorIngestSamplingSeed = "event_id" | "trace_id" | "span_id" | "item_id";

export type ErrorIngestSamplingConfig = {
  sampleRate: number,
  seed: ErrorIngestSamplingSeed,
};

export type ErrorIngestSamplingInput = {
  scope: ErrorIngestPolicyScope,
  itemId: string,
  itemType: Extract<ErrorIngestItemType, "event" | "log" | "span">,
  seed: string,
  seedKind: ErrorIngestSamplingSeed,
  sampleRate: number,
};

export type ErrorIngestSamplingDecision = {
  decision: "keep" | "drop",
  sampleRate: number,
  seedKind: ErrorIngestSamplingSeed,
};

export type ErrorIngestSamplingDecisionHook = (input: ErrorIngestSamplingInput) => ErrorIngestSamplingDecision;

export type ErrorIngestPolicyMetadata = {
  policyVersion: typeof ERROR_INGEST_POLICY_VERSION,
  normalizationVersion: typeof ERROR_INGEST_NORMALIZATION_VERSION,
  scrubberVersion: typeof ERROR_INGEST_SCRUBBER_VERSION,
  selectorsMatched: boolean,
  filterIds: readonly string[],
  sampling: {
    sampleRate: number | null,
    decision: "disabled" | "keep" | "drop" | "mixed",
    seedKind?: ErrorIngestSamplingSeed,
  },
};

export type ErrorIngestPolicyConfig = {
  version: typeof ERROR_INGEST_POLICY_VERSION,
  finalScrub: ErrorIngestScrubOverrides,
  rateLimit: { maxItemsPerWindow: number, windowSeconds: number } | null,
  quota: { maxBytesPerWindow: number, windowSeconds: number } | null,
  selectors: ErrorIngestPolicySelectors | null,
  filters: readonly ErrorIngestFilterRule[],
  sampling: ErrorIngestSamplingConfig | null,
};

export type ErrorIngestPolicyScope = {
  tenancyId: string,
  projectId: string,
  branchId: string,
};

export type ErrorIngestPolicyItem = {
  itemId: string,
  itemType: Extract<ErrorIngestItemType, "event" | "log" | "span">,
  data: unknown,
};

export type ErrorIngestPolicyItemOutcome = ErrorIngestItemOutcome & {
  scrubbed: boolean,
  scrubbedBytes: number,
  filterId?: string,
  sampling?: ErrorIngestSamplingDecision,
};

export type ErrorIngestPolicyDecision = {
  acceptedItemIds: readonly string[],
  acceptedEventIndexes: readonly number[],
  acceptedLogIndexes: readonly number[],
  acceptedSpanIndexes: readonly number[],
  scrubbedData: ReadonlyMap<string, { [key: string]: ErrorIngestScrubbedValue }>,
  outcomes: readonly ErrorIngestPolicyItemOutcome[],
  metadata: ErrorIngestPolicyMetadata,
};

type CounterBucket = {
  itemCount: number,
  byteCount: number,
  touchedAtMs: number,
};

export type ErrorIngestPolicyStateStore = {
  readonly buckets: Map<string, CounterBucket>,
};

export class ErrorIngestPolicyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorIngestPolicyConfigError";
  }
}

export class ErrorIngestPolicyStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorIngestPolicyStateError";
  }
}

export function createErrorIngestPolicyStateStore(): ErrorIngestPolicyStateStore {
  return { buckets: new Map() };
}

const defaultStateStore = createErrorIngestPolicyStateStore();

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScrubbedObject(value: unknown): value is { [key: string]: ErrorIngestScrubbedValue } {
  return isRecord(value);
}

function requiredRecord(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) throw new ErrorIngestPolicyConfigError(`${field} must be an object`);
  return value;
}

function rejectUnknownKeys(record: JsonRecord, allowed: readonly string[], field: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new ErrorIngestPolicyConfigError(`Unsupported ${field} policy field`);
  }
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0) {
    throw new ErrorIngestPolicyConfigError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function parseOverrideKeys(value: unknown, field: "dropKeys" | "urlKeys"): readonly string[] {
  if (value === undefined) return [];
  const record = requiredRecord(value, `observability.errorIngest.finalScrub.${field}`);
  const entries = Object.entries(record);
  if (entries.length > MAX_OVERRIDE_KEYS) {
    throw new ErrorIngestPolicyConfigError("Too many error-ingest scrub override keys");
  }
  const keys: string[] = [];
  for (const [key, enabled] of entries) {
    if (Buffer.byteLength(key, "utf8") > MAX_OVERRIDE_KEY_BYTES || !SAFE_OVERRIDE_KEY.test(key)) {
      // Never echo a configured key: configuration values are not guaranteed
      // to be harmless labels and policy errors must remain payload-free.
      throw new ErrorIngestPolicyConfigError("Unsupported error-ingest scrub override key");
    }
    if (enabled !== true) {
      throw new ErrorIngestPolicyConfigError("Error-ingest scrub overrides must be enabled explicitly");
    }
    if (field === "dropKeys" && key === "url") {
      throw new ErrorIngestPolicyConfigError("The url selector is only valid for URL scrubbing");
    }
    keys.push(key);
  }
  return keys.sort();
}

function parseWindow(value: unknown, field: string): number {
  const seconds = nonNegativeSafeInteger(value, field);
  if (seconds < 1 || seconds > 86_400) throw new ErrorIngestPolicyConfigError(`${field} is outside its bounded range`);
  return seconds;
}

function parseRateLimit(value: unknown): ErrorIngestPolicyConfig["rateLimit"] {
  if (value === undefined) return null;
  const record = requiredRecord(value, "observability.errorIngest.rateLimit");
  rejectUnknownKeys(record, ["maxItemsPerWindow", "windowSeconds"], "rateLimit");
  const maxItems = nonNegativeSafeInteger(record.maxItemsPerWindow, "rateLimit.maxItemsPerWindow");
  if (maxItems < 1 || maxItems > 100_000) throw new ErrorIngestPolicyConfigError("rateLimit.maxItemsPerWindow is outside its bounded range");
  return {
    maxItemsPerWindow: maxItems,
    windowSeconds: parseWindow(record.windowSeconds, "rateLimit.windowSeconds"),
  };
}

function parseQuota(value: unknown): ErrorIngestPolicyConfig["quota"] {
  if (value === undefined) return null;
  const record = requiredRecord(value, "observability.errorIngest.quota");
  rejectUnknownKeys(record, ["maxBytesPerWindow", "windowSeconds"], "quota");
  const maxBytes = nonNegativeSafeInteger(record.maxBytesPerWindow, "quota.maxBytesPerWindow");
  if (maxBytes < 1 || maxBytes > 50 * 1024 * 1024) throw new ErrorIngestPolicyConfigError("quota.maxBytesPerWindow is outside its bounded range");
  return {
    maxBytesPerWindow: maxBytes,
    windowSeconds: parseWindow(record.windowSeconds, "quota.windowSeconds"),
  };
}

function boundedPolicyText(value: unknown, field: string, maxBytes = MAX_FILTER_TEXT_BYTES): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ErrorIngestPolicyConfigError(`${field} must be a bounded text value`);
  }
  return value;
}

function parseSelectorValues(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SELECTOR_VALUES) {
    throw new ErrorIngestPolicyConfigError(`${field} must contain between 1 and ${MAX_SELECTOR_VALUES} selectors`);
  }
  const selectors = value.map((selector) => {
    const normalized = boundedPolicyText(selector, field, MAX_OVERRIDE_KEY_BYTES);
    if (!SAFE_SELECTOR_VALUE.test(normalized)) {
      throw new ErrorIngestPolicyConfigError(`${field} contains an unsupported selector`);
    }
    return normalized;
  });
  return [...new Set(selectors)].sort();
}

function parseSelectors(value: unknown): ErrorIngestPolicySelectors | null {
  if (value === undefined) return null;
  const selectors = requiredRecord(value, "observability.errorIngest.selectors");
  rejectUnknownKeys(selectors, ["tenancyIds", "projectIds", "branchIds"], "selectors");
  const parsed = {
    tenancyIds: parseSelectorValues(selectors.tenancyIds, "selectors.tenancyIds"),
    projectIds: parseSelectorValues(selectors.projectIds, "selectors.projectIds"),
    branchIds: parseSelectorValues(selectors.branchIds, "selectors.branchIds"),
  } satisfies ErrorIngestPolicySelectors;
  if (parsed.tenancyIds === undefined && parsed.projectIds === undefined && parsed.branchIds === undefined) {
    throw new ErrorIngestPolicyConfigError("selectors must contain at least one selector");
  }
  return parsed;
}

function parseFilterRules(value: unknown): readonly ErrorIngestFilterRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FILTER_RULES) {
    throw new ErrorIngestPolicyConfigError(`filters must contain at most ${MAX_FILTER_RULES} rules`);
  }
  const ids = new Set<string>();
  return value.map((rawRule, index) => {
    const rule = requiredRecord(rawRule, `filters[${index}]`);
    rejectUnknownKeys(rule, ["id", "field", "operator", "value"], `filters[${index}]`);
    const id = boundedPolicyText(rule.id, `filters[${index}].id`, 64);
    if (!SAFE_FILTER_ID.test(id) || ids.has(id)) throw new ErrorIngestPolicyConfigError("filters contain an invalid or duplicate rule id");
    ids.add(id);
    const field = boundedPolicyText(rule.field, `filters[${index}].field`, 96);
    if (!isErrorIngestFilterField(field)) throw new ErrorIngestPolicyConfigError("filters contain an unsupported field");
    if (rule.operator !== "equals" && rule.operator !== "contains") {
      throw new ErrorIngestPolicyConfigError("filters contain an unsupported operator");
    }
    return {
      id,
      field,
      operator: rule.operator,
      value: boundedPolicyText(rule.value, `filters[${index}].value`),
    } satisfies ErrorIngestFilterRule;
  });
}

function parseSampleRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ErrorIngestPolicyConfigError("sampling.sampleRate must be a finite number between 0 and 1");
  }
  return value;
}

function parseSampling(value: unknown): ErrorIngestSamplingConfig | null {
  if (value === undefined) return null;
  const sampling = requiredRecord(value, "observability.errorIngest.sampling");
  rejectUnknownKeys(sampling, ["sampleRate", "seed"], "sampling");
  const seed = sampling.seed === undefined ? "item_id" : sampling.seed;
  if (seed !== "event_id" && seed !== "trace_id" && seed !== "span_id" && seed !== "item_id") {
    throw new ErrorIngestPolicyConfigError("sampling.seed is unsupported");
  }
  return { sampleRate: parseSampleRate(sampling.sampleRate), seed };
}

function defaultPolicyConfig(): ErrorIngestPolicyConfig {
  return {
    version: ERROR_INGEST_POLICY_VERSION,
    finalScrub: {},
    rateLimit: null,
    quota: null,
    selectors: null,
    filters: [],
    sampling: null,
  };
}

function isErrorIngestFilterField(value: string): value is ErrorIngestFilterField {
  return SAFE_FILTER_FIELD.test(value);
}

/** Parses only the rendered observability section; absent policy is unlimited. */
export function parseErrorIngestPolicyConfig(config: unknown): ErrorIngestPolicyConfig {
  if (config === undefined) return defaultPolicyConfig();
  if (!isRecord(config)) throw new ErrorIngestPolicyConfigError("observability config must be an object");
  const observability = config.observability;
  if (observability === undefined) return defaultPolicyConfig();
  const observabilityRecord = requiredRecord(observability, "observability");
  const rawPolicy = observabilityRecord.errorIngest;
  if (rawPolicy === undefined) return defaultPolicyConfig();
  const policy = requiredRecord(rawPolicy, "observability.errorIngest");
  const version = policy.version === undefined ? ERROR_INGEST_POLICY_VERSION : policy.version;
  if (version !== ERROR_INGEST_POLICY_VERSION) throw new ErrorIngestPolicyConfigError("Unsupported error-ingest policy version");
  const finalScrub = policy.finalScrub === undefined
    ? {}
    : requiredRecord(policy.finalScrub, "observability.errorIngest.finalScrub");
  rejectUnknownKeys(policy, ["version", "finalScrub", "rateLimit", "quota", "selectors", "filters", "sampling"], "error-ingest");
  rejectUnknownKeys(finalScrub, ["dropKeys", "urlKeys"], "finalScrub");
  return {
    version,
    finalScrub: {
      dropKeys: parseOverrideKeys(finalScrub.dropKeys, "dropKeys"),
      urlKeys: parseOverrideKeys(finalScrub.urlKeys, "urlKeys"),
    },
    rateLimit: parseRateLimit(policy.rateLimit),
    quota: parseQuota(policy.quota),
    selectors: parseSelectors(policy.selectors),
    filters: parseFilterRules(policy.filters),
    sampling: parseSampling(policy.sampling),
  };
}

function selectorsMatch(scope: ErrorIngestPolicyScope, selectors: ErrorIngestPolicySelectors | null): boolean {
  if (selectors === null) return true;
  return (selectors.tenancyIds === undefined || selectors.tenancyIds.includes(scope.tenancyId))
    && (selectors.projectIds === undefined || selectors.projectIds.includes(scope.projectId))
    && (selectors.branchIds === undefined || selectors.branchIds.includes(scope.branchId));
}

function scalarFilterValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function nestedFilterValue(data: unknown, root: "tags" | "contexts", key: string): string | undefined {
  if (!isRecord(data) || !isRecord(data[root])) return undefined;
  return scalarFilterValue(data[root][key]);
}

function filterValue(data: unknown, field: ErrorIngestFilterField): string | undefined {
  if (!isRecord(data)) return undefined;
  if (field.startsWith("tags.")) return nestedFilterValue(data, "tags", field.slice("tags.".length));
  if (field.startsWith("contexts.")) return nestedFilterValue(data, "contexts", field.slice("contexts.".length));
  switch (field) {
    case "message": { return scalarFilterValue(data.message); }
    case "level": { return scalarFilterValue(data.level); }
    case "release": { return scalarFilterValue(data.release); }
    case "environment": { return scalarFilterValue(data.environment); }
    case "service": {
      return scalarFilterValue(data.service) ?? nestedFilterValue(data, "contexts", "service.name");
    }
    case "event.type": { return scalarFilterValue(data.type) ?? scalarFilterValue(data.event_type); }
    case "event.handled": { return scalarFilterValue(data.handled); }
  }
}

function matchingFilter(data: ErrorIngestScrubbedValue, filters: readonly ErrorIngestFilterRule[]): ErrorIngestFilterRule | undefined {
  // Relay evaluates ordered filters and records the first matching rule. Keep
  // the same first-match behavior so an outcome remains explainable without
  // storing the event payload or every rule evaluation.
  return filters.find((rule) => {
    const actual = filterValue(data, rule.field);
    if (actual === undefined) return false;
    return rule.operator === "equals" ? actual === rule.value : actual.includes(rule.value);
  });
}

function safeSeed(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_FILTER_TEXT_BYTES || /[\u0000-\u001f\u007f]/u.test(value)) {
    return undefined;
  }
  return value;
}

function seedForItem(item: ErrorIngestPolicyItem, configuredSeed: ErrorIngestSamplingSeed, scrubbed: ErrorIngestScrubbedValue): string {
  if (configuredSeed === "item_id") return item.itemId;
  const data = isRecord(scrubbed) ? scrubbed : {};
  const candidates: readonly [ErrorIngestSamplingSeed, readonly string[]][] = [
    ["event_id", ["event_id", "eventId"]],
    ["trace_id", ["trace_id", "traceId"]],
    ["span_id", ["span_id", "spanId"]],
  ];
  const configuredKeys = candidates.find(([kind]) => kind === configuredSeed)?.[1] ?? [];
  const configuredValue = configuredKeys.map((key) => safeSeed(data[key])).find((value): value is string => value !== undefined);
  if (configuredValue !== undefined) return configuredValue;
  return item.itemId;
}

/**
 * Relay seeds sampling from trace/event identity so repeated processing makes
 * the same decision. This hook accepts only authenticated scope and bounded
 * identity strings; arbitrary event payload never participates in the hash.
 */
export const deterministicErrorIngestSamplingDecision: ErrorIngestSamplingDecisionHook = (input) => {
  if (input.sampleRate <= 0) return { decision: "drop", sampleRate: input.sampleRate, seedKind: input.seedKind };
  if (input.sampleRate >= 1) return { decision: "keep", sampleRate: input.sampleRate, seedKind: input.seedKind };
  const stableKey = [
    input.scope.tenancyId,
    input.scope.projectId,
    input.scope.branchId,
    input.itemType,
    input.seedKind,
    input.seed,
  ].join("\u0000");
  const digest = createHash("sha256").update(stableKey, "utf8").digest();
  const bucket = digest.readUInt32BE(0) / 0x1_0000_0000;
  return {
    decision: bucket < input.sampleRate ? "keep" : "drop",
    sampleRate: input.sampleRate,
    seedKind: input.seedKind,
  };
};

function windowStart(nowMs: number, seconds: number): number {
  return Math.floor(nowMs / (seconds * 1000)) * seconds * 1000;
}

function retryAfterMs(nowMs: number, seconds: number): number {
  return Math.max(0, windowStart(nowMs, seconds) + seconds * 1000 - nowMs);
}

function stateKey(scope: ErrorIngestPolicyScope, config: ErrorIngestPolicyConfig, nowMs: number): string {
  const rateStart = config.rateLimit === null ? "none" : String(windowStart(nowMs, config.rateLimit.windowSeconds));
  const quotaStart = config.quota === null ? "none" : String(windowStart(nowMs, config.quota.windowSeconds));
  // Relay carries scoping as a typed tuple. Encode the tuple structurally here
  // instead of joining untrusted identifiers with a delimiter: otherwise
  // tenant/project/branch values containing `:` could alias another tenant's
  // counter and weaken quota isolation.
  return JSON.stringify([scope.tenancyId, scope.projectId, scope.branchId, rateStart, quotaStart]);
}

function pruneState(store: ErrorIngestPolicyStateStore, nowMs: number, config: ErrorIngestPolicyConfig): void {
  const maxWindowMs = Math.max(config.rateLimit?.windowSeconds ?? 0, config.quota?.windowSeconds ?? 0) * 1000;
  if (maxWindowMs > 0) {
    for (const [key, bucket] of store.buckets) {
      if (nowMs - bucket.touchedAtMs > maxWindowMs * 2) store.buckets.delete(key);
    }
  }
}

function getBucket(store: ErrorIngestPolicyStateStore, key: string): CounterBucket {
  const existing = store.buckets.get(key);
  if (existing !== undefined) return existing;
  const created = { itemCount: 0, byteCount: 0, touchedAtMs: 0 };
  store.buckets.set(key, created);
  return created;
}

function rateLimitedOutcome(
  item: ErrorIngestPolicyItem,
  reason: "quota" | "rate_limit",
  retryAfter: number,
  scrubbed: boolean,
  scrubbedBytes: number,
): ErrorIngestPolicyItemOutcome {
  return {
    itemId: item.itemId,
    itemType: item.itemType,
    status: "rate_limited",
    reason,
    retryAfterMs: retryAfter,
    scrubbed,
    scrubbedBytes,
  };
}

export function evaluateErrorIngestPolicy(options: {
  config: unknown,
  scope: ErrorIngestPolicyScope,
  items: readonly ErrorIngestPolicyItem[],
  nowMs: number,
  stateStore?: ErrorIngestPolicyStateStore,
}): ErrorIngestPolicyDecision {
  if (!Number.isSafeInteger(options.nowMs) || options.nowMs < 0) throw new ErrorIngestPolicyStateError("Policy time must be a non-negative safe integer");
  const parsedConfig = parseErrorIngestPolicyConfig(options.config);
  const selectorsMatched = selectorsMatch(options.scope, parsedConfig.selectors);
  // Built-in scrubbing always runs. Customer policy controls are activated only
  // for a matching authenticated scope, so a mis-scoped config cannot alter a
  // different tenant, project, or branch.
  const config = selectorsMatched ? parsedConfig : defaultPolicyConfig();
  const store = options.stateStore ?? defaultStateStore;
  const hasLimits = config.rateLimit !== null || config.quota !== null;
  if (hasLimits) pruneState(store, options.nowMs, config);
  let bucket: CounterBucket;
  if (hasLimits) {
    const key = stateKey(options.scope, config, options.nowMs);
    if (!store.buckets.has(key) && store.buckets.size >= MAX_COUNTER_BUCKETS) {
      throw new ErrorIngestPolicyStateError("Error-ingest policy counter capacity exhausted");
    }
    bucket = getBucket(store, key);
  } else {
    bucket = { itemCount: 0, byteCount: 0, touchedAtMs: options.nowMs };
  }
  const outcomes: ErrorIngestPolicyItemOutcome[] = [];
  const acceptedItemIds: string[] = [];
  const acceptedEventIndexes: number[] = [];
  const acceptedLogIndexes: number[] = [];
  const acceptedSpanIndexes: number[] = [];
  const scrubbedData = new Map<string, { [key: string]: ErrorIngestScrubbedValue }>();
  const matchedFilterIds = new Set<string>();
  let samplingDecision: ErrorIngestPolicyMetadata["sampling"]["decision"] = "disabled";

  for (const [index, item] of options.items.entries()) {
    const scrubbed = scrubErrorIngestPayload(item.data, { overrides: config.finalScrub });
    if (scrubbed.value === undefined || !isScrubbedObject(scrubbed.value)) {
      outcomes.push({
        itemId: item.itemId,
        itemType: item.itemType,
        status: "rejected",
        reason: "invalid",
        scrubbed: scrubbed.truncated,
        scrubbedBytes: 0,
      });
      continue;
    }

    const matchedFilter = matchingFilter(scrubbed.value, config.filters);
    if (matchedFilter !== undefined) {
      matchedFilterIds.add(matchedFilter.id);
      outcomes.push({
        itemId: item.itemId,
        itemType: item.itemType,
        status: "filtered",
        reason: "configured_filter",
        filterId: matchedFilter.id,
        scrubbed: scrubbed.truncated,
        scrubbedBytes: scrubbed.byteLength,
      });
      continue;
    }

    let itemSampling: ErrorIngestSamplingDecision | undefined;
    if (config.sampling !== null) {
      const seed = seedForItem(item, config.sampling.seed, scrubbed.value);
      itemSampling = deterministicErrorIngestSamplingDecision({
        scope: options.scope,
        itemId: item.itemId,
        itemType: item.itemType,
        seed,
        seedKind: config.sampling.seed,
        sampleRate: config.sampling.sampleRate,
      });
      samplingDecision = samplingDecision === "disabled" || samplingDecision === itemSampling.decision
        ? itemSampling.decision
        : "mixed";
      if (itemSampling.decision === "drop") {
        outcomes.push({
          itemId: item.itemId,
          itemType: item.itemType,
          status: "filtered",
          reason: "sampling",
          sampling: itemSampling,
          scrubbed: scrubbed.truncated,
          scrubbedBytes: scrubbed.byteLength,
        });
        continue;
      }
    }

    const itemCountExceeded = config.rateLimit !== null
      && bucket.itemCount >= config.rateLimit.maxItemsPerWindow;
    const quotaExceeded = config.quota !== null
      && bucket.byteCount + scrubbed.byteLength > config.quota.maxBytesPerWindow;
    if (quotaExceeded || itemCountExceeded) {
      const reason = quotaExceeded ? "quota" : "rate_limit";
      const retryAfter = quotaExceeded
        ? retryAfterMs(options.nowMs, config.quota?.windowSeconds ?? 1)
        : retryAfterMs(options.nowMs, config.rateLimit?.windowSeconds ?? 1);
      outcomes.push(rateLimitedOutcome(item, reason, retryAfter, scrubbed.truncated, scrubbed.byteLength));
      continue;
    }

    if (hasLimits) {
      bucket.itemCount += 1;
      bucket.byteCount += scrubbed.byteLength;
      bucket.touchedAtMs = options.nowMs;
    }
    acceptedItemIds.push(item.itemId);
    scrubbedData.set(item.itemId, scrubbed.value);
    if (item.itemType === "event") acceptedEventIndexes.push(index);
    else if (item.itemType === "log") acceptedLogIndexes.push(index);
    else acceptedSpanIndexes.push(index);
    outcomes.push({
      itemId: item.itemId,
      itemType: item.itemType,
      status: "accepted",
      ...(itemSampling === undefined ? {} : { sampling: itemSampling }),
      scrubbed: scrubbed.truncated,
      scrubbedBytes: scrubbed.byteLength,
    });
  }

  return {
    acceptedItemIds,
    acceptedEventIndexes,
    acceptedLogIndexes,
    acceptedSpanIndexes,
    scrubbedData,
    outcomes,
    metadata: {
      policyVersion: ERROR_INGEST_POLICY_VERSION,
      normalizationVersion: ERROR_INGEST_NORMALIZATION_VERSION,
      scrubberVersion: ERROR_INGEST_SCRUBBER_VERSION,
      selectorsMatched,
      filterIds: [...matchedFilterIds],
      sampling: {
        sampleRate: config.sampling?.sampleRate ?? null,
        decision: samplingDecision,
        ...(config.sampling === null ? {} : { seedKind: config.sampling.seed }),
      },
    },
  };
}
