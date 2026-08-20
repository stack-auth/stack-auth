import { Buffer } from "node:buffer";
import {
  scrubErrorIngestPayload,
  type ErrorIngestScrubbedValue,
  type ErrorIngestScrubOverrides,
} from "./error-ingest-scrubber";
import type { ErrorIngestItemType, ErrorIngestItemOutcome } from "./error-ingest-outcomes";

const MAX_OVERRIDE_KEYS = 32;
const MAX_OVERRIDE_KEY_BYTES = 96;
const MAX_COUNTER_BUCKETS = 10_000;
const SAFE_OVERRIDE_KEY = /^(?:user\.(?:email|username|ip_address)|request\.url|url|tags\.[a-zA-Z0-9_.-]{1,64}|contexts\.[a-zA-Z0-9_.-]{1,64}|extra\.[a-zA-Z0-9_.-]{1,64})$/;
const SAFE_OVERRIDE_RULE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

type JsonRecord = { [key: string]: unknown };

export type ErrorIngestPolicyConfig = {
  finalScrub: ErrorIngestScrubOverrides,
  rateLimit: { maxItemsPerWindow: number, windowSeconds: number } | null,
  quota: { maxBytesPerWindow: number, windowSeconds: number } | null,
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
};

export type ErrorIngestPolicyDecision = {
  acceptedItemIds: readonly string[],
  acceptedLogIndexes: readonly number[],
  scrubbedData: ReadonlyMap<string, { [key: string]: ErrorIngestScrubbedValue }>,
  outcomes: readonly ErrorIngestPolicyItemOutcome[],
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
  const keys = new Set<string>();
  for (const [ruleId, selector] of entries) {
    if (!SAFE_OVERRIDE_RULE_ID.test(ruleId)) {
      throw new ErrorIngestPolicyConfigError("Error-ingest scrub override rule ids must be short dotless identifiers");
    }
    if (typeof selector !== "string" || Buffer.byteLength(selector, "utf8") > MAX_OVERRIDE_KEY_BYTES || !SAFE_OVERRIDE_KEY.test(selector)) {
      throw new ErrorIngestPolicyConfigError("Unsupported error-ingest scrub override key");
    }
    if (field === "dropKeys" && selector === "url") {
      throw new ErrorIngestPolicyConfigError("The url selector is only valid for URL scrubbing");
    }
    keys.add(selector);
  }
  return [...keys].sort();
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

function defaultPolicyConfig(): ErrorIngestPolicyConfig {
  return {
    finalScrub: {},
    rateLimit: null,
    quota: null,
  };
}

export function parseErrorIngestPolicyConfig(config: unknown): ErrorIngestPolicyConfig {
  if (config === undefined) return defaultPolicyConfig();
  if (!isRecord(config)) throw new ErrorIngestPolicyConfigError("observability config must be an object");
  const observability = config.observability;
  if (observability === undefined) return defaultPolicyConfig();
  const observabilityRecord = requiredRecord(observability, "observability");
  const rawPolicy = observabilityRecord.errorIngest;
  if (rawPolicy === undefined) return defaultPolicyConfig();
  const policy = requiredRecord(rawPolicy, "observability.errorIngest");
  const finalScrub = policy.finalScrub === undefined
    ? {}
    : requiredRecord(policy.finalScrub, "observability.errorIngest.finalScrub");
  rejectUnknownKeys(policy, ["finalScrub", "rateLimit", "quota"], "error-ingest");
  rejectUnknownKeys(finalScrub, ["dropKeys", "urlKeys"], "finalScrub");
  return {
    finalScrub: {
      dropKeys: parseOverrideKeys(finalScrub.dropKeys, "dropKeys"),
      urlKeys: parseOverrideKeys(finalScrub.urlKeys, "urlKeys"),
    },
    rateLimit: parseRateLimit(policy.rateLimit),
    quota: parseQuota(policy.quota),
  };
}

function windowStart(nowMs: number, seconds: number): number {
  return Math.floor(nowMs / (seconds * 1000)) * seconds * 1000;
}

function retryAfterMs(nowMs: number, seconds: number): number {
  return Math.max(0, windowStart(nowMs, seconds) + seconds * 1000 - nowMs);
}

function limitStateKey(kind: "rate" | "quota", scope: ErrorIngestPolicyScope, windowStartMs: number): string {
  return JSON.stringify([kind, scope.tenancyId, scope.projectId, scope.branchId, windowStartMs]);
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
  if (store.buckets.size >= MAX_COUNTER_BUCKETS) {
    throw new ErrorIngestPolicyStateError("Error-ingest policy counter capacity exhausted");
  }
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
  const config = parseErrorIngestPolicyConfig(options.config);
  const store = options.stateStore ?? defaultStateStore;
  const hasLimits = config.rateLimit !== null || config.quota !== null;
  if (hasLimits) pruneState(store, options.nowMs, config);
  const rateBucket = config.rateLimit === null
    ? null
    : getBucket(store, limitStateKey("rate", options.scope, windowStart(options.nowMs, config.rateLimit.windowSeconds)));
  const quotaBucket = config.quota === null
    ? null
    : getBucket(store, limitStateKey("quota", options.scope, windowStart(options.nowMs, config.quota.windowSeconds)));
  const outcomes: ErrorIngestPolicyItemOutcome[] = [];
  const acceptedItemIds: string[] = [];
  const acceptedLogIndexes: number[] = [];
  const scrubbedData = new Map<string, { [key: string]: ErrorIngestScrubbedValue }>();

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

    const itemCountExceeded = config.rateLimit !== null && rateBucket !== null
      && rateBucket.itemCount >= config.rateLimit.maxItemsPerWindow;
    const quotaExceeded = config.quota !== null && quotaBucket !== null
      && quotaBucket.byteCount + scrubbed.byteLength > config.quota.maxBytesPerWindow;
    if (quotaExceeded || itemCountExceeded) {
      const reason = quotaExceeded ? "quota" : "rate_limit";
      const retryAfter = quotaExceeded
        ? retryAfterMs(options.nowMs, config.quota?.windowSeconds ?? 1)
        : retryAfterMs(options.nowMs, config.rateLimit?.windowSeconds ?? 1);
      outcomes.push(rateLimitedOutcome(item, reason, retryAfter, scrubbed.truncated, scrubbed.byteLength));
      continue;
    }

    if (rateBucket !== null) {
      rateBucket.itemCount += 1;
      rateBucket.touchedAtMs = options.nowMs;
    }
    if (quotaBucket !== null) {
      quotaBucket.byteCount += scrubbed.byteLength;
      quotaBucket.touchedAtMs = options.nowMs;
    }
    acceptedItemIds.push(item.itemId);
    scrubbedData.set(item.itemId, scrubbed.value);
    if (item.itemType === "log") acceptedLogIndexes.push(index);
    outcomes.push({
      itemId: item.itemId,
      itemType: item.itemType,
      status: "accepted",
      scrubbed: scrubbed.truncated,
      scrubbedBytes: scrubbed.byteLength,
    });
  }

  return {
    acceptedItemIds,
    acceptedLogIndexes,
    scrubbedData,
    outcomes,
  };
}
