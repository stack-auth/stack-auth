import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  ERROR_INGEST_OUTCOME_STATUSES,
  summarizeErrorIngestOutcomes,
  type ErrorIngestBatchCounts,
  type ErrorIngestBatchStatus,
  type ErrorIngestDropReason,
  type ErrorIngestFilterReason,
  type ErrorIngestItemDescriptor,
  type ErrorIngestItemOutcome,
  type ErrorIngestItemType,
  type ErrorIngestOutcomeStatus,
  type ErrorIngestQueueReason,
  type ErrorIngestRateLimitReason,
  type ErrorIngestRejectReason,
} from "./error-ingest-outcomes";

/**
 * A drop reason that is not yet modeled by the canonical outcome contract.
 * Unknown reasons are deliberately collapsed to this fixed value before they
 * can reach a client report or an HTTP error message.
 */
export type ErrorIngestUnknownDropOutcome = ErrorIngestItemDescriptor & {
  status: "dropped",
  reason: "unknown",
};

export type ErrorIngestProtocolOutcomeInput = ErrorIngestItemOutcome | ErrorIngestUnknownDropOutcome;

export type ErrorIngestProtocolReason =
  | ErrorIngestFilterReason
  | ErrorIngestRateLimitReason
  | ErrorIngestRejectReason
  | ErrorIngestDropReason
  | ErrorIngestQueueReason
  | "deduplicated"
  | "unknown";

/** Sentry-compatible client-report bucket names. */
export type ErrorIngestClientReportBucket =
  | "discarded_events"
  | "rate_limited_events"
  | "filtered_events"
  | "filtered_sampling_events";

/** Relay's data-category vocabulary for the item types this backend knows. */
export type ErrorIngestClientReportCategory =
  | "error"
  | "log_item"
  | "span"
  | "transaction"
  | "attachment"
  | "client_report"
  | "unknown"
  /** Relay accepts the complete data-category vocabulary, including categories added after this SDK. */
  | (string & {});

export type ErrorIngestClientReportReason =
  | ErrorIngestFilterReason
  | ErrorIngestRateLimitReason
  | ErrorIngestRejectReason
  | ErrorIngestDropReason
  | "deduplicated"
  | "unknown"
  /** Client reports preserve bounded Relay reason strings for forward compatibility. */
  | (string & {});

export type ErrorIngestClientReportEntry = {
  reason: ErrorIngestClientReportReason,
  category: ErrorIngestClientReportCategory,
  quantity: number,
};

/**
 * This is the exact JSON-shaped partial-success body consumed by the current
 * OTLP HTTP response helper. Counts are strings because that is the OTLP JSON
 * mapping for protobuf uint64 fields.
 */
export type ErrorIngestOtlpPartialSuccessBody = {
  partialSuccess?: {
    rejectedLogRecords?: string,
    rejectedSpans?: string,
    errorMessage?: string,
  },
};

export type ErrorIngestOtlpPartialSuccessProjection = {
  rejectedItems: number,
  body: ErrorIngestOtlpPartialSuccessBody,
};

export type ErrorIngestClientReportProjection = {
  discarded_events: readonly ErrorIngestClientReportEntry[],
  rate_limited_events: readonly ErrorIngestClientReportEntry[],
  filtered_events: readonly ErrorIngestClientReportEntry[],
  filtered_sampling_events: readonly ErrorIngestClientReportEntry[],
};

export type ErrorIngestProtocolItemProjection = {
  /** Position disambiguates identical item IDs in one batch. */
  itemIndex: number,
  itemId: string,
  itemType: ErrorIngestItemType,
  eventId?: string,
  status: ErrorIngestOutcomeStatus,
  reason?: ErrorIngestProtocolReason,
  canonicalItemId?: string,
  retryAfterMs?: number,
  category: ErrorIngestClientReportCategory,
  clientReportBucket?: ErrorIngestClientReportBucket,
  clientReportReason?: ErrorIngestClientReportReason,
  /** Terminal rejection is distinct from queued and idempotent deduplication. */
  rejectedByOtlp: boolean,
};

export type ErrorIngestProtocolTruncation = {
  clientReportEntries: number,
  clientReportItems: number,
};

/**
 * Count-only legacy projection. It intentionally contains no event, message,
 * stack, request, user, or arbitrary reason payload.
 */
export type ErrorIngestLegacyBatchOutcomeProjection = {
  batchId: string,
  status: ErrorIngestBatchStatus,
  itemCount: number,
  counts: ErrorIngestBatchCounts,
  acceptedItems: number,
  deduplicatedItems: number,
  queuedItems: number,
  rejectedItems: number,
  truncatedClientReportEntries: number,
  truncatedClientReportItems: number,
  reason?: "empty_batch",
};

export type ErrorIngestProtocolAdapterLimits = {
  maxBatchIdBytes: number,
  maxItemIdBytes: number,
  maxEventIdBytes: number,
  maxClientReportEntries: number,
  maxErrorMessageBytes: number,
};

export const ERROR_INGEST_PROTOCOL_ADAPTER_LIMITS: Readonly<ErrorIngestProtocolAdapterLimits> = {
  // These limits protect the projection itself. The ingest routes retain their
  // own larger payload/item limits and may reject before this adapter runs.
  maxBatchIdBytes: 256,
  maxItemIdBytes: 256,
  maxEventIdBytes: 64,
  maxClientReportEntries: 100,
  maxErrorMessageBytes: 512,
};

export type ErrorIngestProtocolAdapterOptions = {
  limits?: Partial<ErrorIngestProtocolAdapterLimits>,
};

export type ErrorIngestProtocolProjection = {
  batchId: string,
  itemCount: number,
  status: ErrorIngestBatchStatus,
  counts: ErrorIngestBatchCounts,
  /** Safe descriptors only; no input event payload is copied here. */
  items: readonly ErrorIngestProtocolItemProjection[],
  clientReport: ErrorIngestClientReportProjection,
  otlpPartialSuccess: {
    logs: ErrorIngestOtlpPartialSuccessProjection,
    traces: ErrorIngestOtlpPartialSuccessProjection,
  },
  legacyBatch: ErrorIngestLegacyBatchOutcomeProjection,
  truncation: ErrorIngestProtocolTruncation,
  /** Stable for retries of the same batch and outcome decisions. */
  idempotencyKey: string,
};

export class ErrorIngestProtocolAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorIngestProtocolAdapterError";
  }
}

const CLIENT_REPORT_BUCKETS: readonly ErrorIngestClientReportBucket[] = [
  "discarded_events",
  "rate_limited_events",
  "filtered_events",
  "filtered_sampling_events",
];

const ITEM_TYPES: readonly ErrorIngestItemType[] = ["event", "log", "span", "transaction", "attachment", "client_report", "unknown"];

const REJECTED_STATUSES: readonly ErrorIngestOutcomeStatus[] = [
  "filtered",
  "rate_limited",
  "rejected",
  "dropped",
];

function validatePositiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ErrorIngestProtocolAdapterError(`${name} must be a positive safe integer`);
  }
  return value;
}

function resolveLimits(options?: ErrorIngestProtocolAdapterOptions): ErrorIngestProtocolAdapterLimits {
  const overrides = options?.limits;
  const limits = {
    maxBatchIdBytes: overrides?.maxBatchIdBytes ?? ERROR_INGEST_PROTOCOL_ADAPTER_LIMITS.maxBatchIdBytes,
    maxItemIdBytes: overrides?.maxItemIdBytes ?? ERROR_INGEST_PROTOCOL_ADAPTER_LIMITS.maxItemIdBytes,
    maxEventIdBytes: overrides?.maxEventIdBytes ?? ERROR_INGEST_PROTOCOL_ADAPTER_LIMITS.maxEventIdBytes,
    maxClientReportEntries: overrides?.maxClientReportEntries ?? ERROR_INGEST_PROTOCOL_ADAPTER_LIMITS.maxClientReportEntries,
    maxErrorMessageBytes: overrides?.maxErrorMessageBytes ?? ERROR_INGEST_PROTOCOL_ADAPTER_LIMITS.maxErrorMessageBytes,
  };
  for (const [name, value] of Object.entries(limits)) validatePositiveLimit(value, name);
  return limits;
}

function validateIdentifier(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ErrorIngestProtocolAdapterError(`${name} must be a non-empty bounded identifier`);
  }
  return value;
}

function validateRetryAfter(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ErrorIngestProtocolAdapterError("retryAfterMs must be a non-negative safe integer");
  }
  return value;
}

function normalizeFilterReason(value: unknown): ErrorIngestFilterReason | "unknown" {
  switch (value) {
    case "configured_filter": { return value; }
    case "privacy": { return value; }
    case "sampling": { return value; }
    default: { return "unknown"; }
  }
}

function normalizeRateLimitReason(value: unknown): ErrorIngestRateLimitReason | "unknown" {
  switch (value) {
    case "quota": { return value; }
    case "rate_limit": { return value; }
    default: { return "unknown"; }
  }
}

function normalizeRejectReason(value: unknown): ErrorIngestRejectReason | "unknown" {
  switch (value) {
    case "auth": { return value; }
    case "invalid": { return value; }
    case "payload_too_large": { return value; }
    case "unsupported": { return value; }
    default: { return "unknown"; }
  }
}

function normalizeDropReason(value: unknown): ErrorIngestDropReason | "unknown" {
  switch (value) {
    case "delivery_failed": { return value; }
    case "internal": { return value; }
    case "queue_full": { return value; }
    case "shutdown": { return value; }
    case "unknown": { return value; }
    default: { return "unknown"; }
  }
}

function normalizeQueueReason(value: unknown): ErrorIngestQueueReason | "unknown" {
  switch (value) {
    case "offline": { return value; }
    case "retryable": { return value; }
    default: { return "unknown"; }
  }
}

function reportCategory(itemType: ErrorIngestItemType): ErrorIngestClientReportCategory {
  switch (itemType) {
    case "event": { return "error"; }
    case "log": { return "log_item"; }
    case "span": { return "span"; }
    case "transaction": { return "transaction"; }
    case "attachment": { return "attachment"; }
    case "client_report": { return "client_report"; }
    case "unknown": { return "unknown"; }
  }
}

function protocolReason(outcome: ErrorIngestProtocolOutcomeInput): ErrorIngestProtocolReason | undefined {
  switch (outcome.status) {
    case "accepted": { return undefined; }
    case "filtered": { return normalizeFilterReason(outcome.reason); }
    case "rate_limited": { return normalizeRateLimitReason(outcome.reason); }
    case "rejected": { return normalizeRejectReason(outcome.reason); }
    case "deduplicated": { return "deduplicated"; }
    case "dropped": { return normalizeDropReason(outcome.reason); }
    case "queued": { return normalizeQueueReason(outcome.reason); }
  }
}

function clientReportDisposition(outcome: ErrorIngestProtocolOutcomeInput): {
  bucket: ErrorIngestClientReportBucket,
  reason: ErrorIngestClientReportReason,
} | undefined {
  // A client report is already a loss ledger. Re-reporting a rejected report
  // would create the exact feedback loop Relay avoids for this item type.
  if (outcome.itemType === "client_report") return undefined;
  const reason = protocolReason(outcome);
  switch (outcome.status) {
    case "accepted":
    case "queued": {
      // Queued is retained and must not be reported as a loss. It will either
      // become accepted/deduplicated or emit its own later delivery outcome.
      return undefined;
    }
    case "filtered": {
      return reason === "sampling"
        ? { bucket: "filtered_sampling_events", reason }
        : { bucket: "filtered_events", reason: toClientReportReason(reason) };
    }
    case "rate_limited": {
      return { bucket: "rate_limited_events", reason: toClientReportReason(reason) };
    }
    case "rejected": {
      return { bucket: "discarded_events", reason: toClientReportReason(reason) };
    }
    case "deduplicated": {
      return { bucket: "discarded_events", reason: "deduplicated" };
    }
    case "dropped": {
      return { bucket: "discarded_events", reason: toClientReportReason(reason) };
    }
  }
}

function toClientReportReason(reason: ErrorIngestProtocolReason | undefined): ErrorIngestClientReportReason {
  switch (reason) {
    case "offline":
    case "retryable":
    case undefined: { return "unknown"; }
    default: { return reason; }
  }
}

function isOtlpRejected(status: ErrorIngestOutcomeStatus): boolean {
  return REJECTED_STATUSES.includes(status);
}

function normalizeItem(
  outcome: ErrorIngestProtocolOutcomeInput,
  itemIndex: number,
  limits: ErrorIngestProtocolAdapterLimits,
): ErrorIngestProtocolItemProjection {
  if (!ERROR_INGEST_OUTCOME_STATUSES.includes(outcome.status)) {
    throw new ErrorIngestProtocolAdapterError("outcome status is not supported");
  }
  if (!ITEM_TYPES.includes(outcome.itemType)) {
    throw new ErrorIngestProtocolAdapterError("outcome item type is not supported");
  }
  const itemId = validateIdentifier(outcome.itemId, "itemId", limits.maxItemIdBytes);
  const eventId = outcome.eventId === undefined
    ? undefined
    : validateIdentifier(outcome.eventId, "eventId", limits.maxEventIdBytes);
  const reason = protocolReason(outcome);
  const disposition = clientReportDisposition(outcome);
  const canonicalItemId = outcome.status === "deduplicated"
    ? validateIdentifier(outcome.canonicalItemId, "canonicalItemId", limits.maxItemIdBytes)
    : undefined;
  const retryAfterMs = "retryAfterMs" in outcome ? validateRetryAfter(outcome.retryAfterMs) : undefined;

  return {
    itemIndex,
    itemId,
    itemType: outcome.itemType,
    ...(eventId === undefined ? {} : { eventId }),
    status: outcome.status,
    ...(reason === undefined ? {} : { reason }),
    ...(canonicalItemId === undefined ? {} : { canonicalItemId }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    category: reportCategory(outcome.itemType),
    ...(disposition === undefined ? {} : {
      clientReportBucket: disposition.bucket,
      clientReportReason: disposition.reason,
    }),
    rejectedByOtlp: isOtlpRejected(outcome.status),
  };
}

function encodeCanonicalPart(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

// This key is stable across retries of the same batch AND outcome decisions —
// deliberately including each item's status/reason. A byte-identical retry
// whose policy decisions changed in between (e.g. a rate-limit window opened)
// therefore produces a NEW key and a second loss-ledger row: the ledger counts
// decisions, and making it count "first decision per batch" instead would
// require durably persisting that first decision before policy reruns, which
// this stateless projection layer intentionally does not do. The ClickHouse
// write path stays idempotent separately via the batch identity.
function idempotencyKey(
  batchId: string,
  items: readonly ErrorIngestProtocolItemProjection[],
): string {
  const canonicalItems = items.map((item) => JSON.stringify([
    item.itemId,
    item.itemType,
    item.eventId ?? "",
    item.status,
    item.reason ?? "",
    item.canonicalItemId ?? "",
    // Retry-After is a delivery hint, not an identity component. A retry can
    // receive a different hint while still representing the same outcome.
  ])).sort();
  const canonical = [encodeCanonicalPart(batchId), ...canonicalItems.map(encodeCanonicalPart)].join("\u001e");
  return `error-ingest-v1:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

type MutableReportEntry = ErrorIngestClientReportEntry;

function emptyReportMaps(): Record<ErrorIngestClientReportBucket, Map<string, MutableReportEntry>> {
  return {
    discarded_events: new Map(),
    rate_limited_events: new Map(),
    filtered_events: new Map(),
    filtered_sampling_events: new Map(),
  };
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function aggregateClientReport(
  items: readonly ErrorIngestProtocolItemProjection[],
  maxEntries: number,
): {
  report: ErrorIngestClientReportProjection,
  truncation: ErrorIngestProtocolTruncation,
} {
  const maps = emptyReportMaps();
  for (const item of items) {
    if (item.clientReportBucket === undefined || item.clientReportReason === undefined) continue;
    const key = `${item.category}\u0000${item.clientReportReason}`;
    const existing = maps[item.clientReportBucket].get(key);
    if (existing === undefined) {
      maps[item.clientReportBucket].set(key, {
        category: item.category,
        reason: item.clientReportReason,
        quantity: 1,
      });
    } else {
      existing.quantity += 1;
    }
  }

  const entries: Array<{ bucket: ErrorIngestClientReportBucket, entry: MutableReportEntry }> = [];
  for (const bucket of CLIENT_REPORT_BUCKETS) {
    const bucketEntries = [...maps[bucket].values()].sort((left, right) => {
      const categoryOrder = compareStrings(left.category, right.category);
      return categoryOrder === 0 ? compareStrings(left.reason, right.reason) : categoryOrder;
    });
    for (const entry of bucketEntries) entries.push({ bucket, entry });
  }

  const selected = entries.slice(0, maxEntries);
  const selectedByBucket = emptyReportMaps();
  for (const { bucket, entry } of selected) selectedByBucket[bucket].set(`${entry.category}\u0000${entry.reason}`, entry);

  let truncatedClientReportItems = 0;
  for (const { entry } of entries.slice(maxEntries)) truncatedClientReportItems += entry.quantity;

  const report = {
    discarded_events: [...selectedByBucket.discarded_events.values()],
    rate_limited_events: [...selectedByBucket.rate_limited_events.values()],
    filtered_events: [...selectedByBucket.filtered_events.values()],
    filtered_sampling_events: [...selectedByBucket.filtered_sampling_events.values()],
  } satisfies ErrorIngestClientReportProjection;

  return {
    report,
    truncation: {
      clientReportEntries: entries.length - selected.length,
      clientReportItems: truncatedClientReportItems,
    },
  };
}

function rejectedItemCount(counts: ErrorIngestBatchCounts): number {
  return REJECTED_STATUSES.reduce((total, status) => total + counts[status], 0);
}

function boundedErrorMessage(counts: ErrorIngestBatchCounts, maxBytes: number): string | undefined {
  const rejected = rejectedItemCount(counts);
  if (rejected === 0) return undefined;
  const details = REJECTED_STATUSES
    .filter((status) => counts[status] > 0)
    .map((status) => `${status}=${counts[status]}`)
    .join(", ");
  const message = `error ingest rejected ${rejected} item(s): ${details}`;
  if (Buffer.byteLength(message, "utf8") <= maxBytes) return message;

  let result = "";
  for (const character of message) {
    if (Buffer.byteLength(`${result}${character}`, "utf8") > maxBytes) break;
    result += character;
  }
  return result;
}

function isSignalItemType(itemType: ErrorIngestItemType, signal: "logs" | "traces"): boolean {
  return signal === "logs"
    ? itemType === "log"
    : itemType === "span" || itemType === "transaction";
}

function otlpPartialSuccess(
  items: readonly ErrorIngestProtocolItemProjection[],
  signal: "logs" | "traces",
  maxErrorMessageBytes: number,
): ErrorIngestOtlpPartialSuccessProjection {
  // Each OTLP signal reports only its own item types. Counting the whole batch
  // would let a rejected transaction surface as `rejectedLogRecords` (and vice
  // versa) in mixed batches, telling the client the wrong signal failed.
  const counts = summarizeErrorIngestOutcomes(items.filter((item) => isSignalItemType(item.itemType, signal))).counts;
  const rejectedItems = rejectedItemCount(counts);
  const errorMessage = boundedErrorMessage(counts, maxErrorMessageBytes);
  if (rejectedItems === 0 || errorMessage === undefined) {
    return { rejectedItems, body: {} };
  }
  const partialSuccess = signal === "logs"
    ? { rejectedLogRecords: String(rejectedItems), errorMessage }
    : { rejectedSpans: String(rejectedItems), errorMessage };
  return { rejectedItems, body: { partialSuccess } };
}

/**
 * Creates all protocol projections from item outcomes without accepting or
 * serializing event payloads. Aggregation is order-independent; retries of the
 * same batch and decisions receive the same idempotency key.
 */
export function createErrorIngestProtocolProjection(
  batchId: string,
  outcomes: readonly ErrorIngestProtocolOutcomeInput[],
  options?: ErrorIngestProtocolAdapterOptions,
): ErrorIngestProtocolProjection {
  const limits = resolveLimits(options);
  const normalizedBatchId = validateIdentifier(batchId, "batchId", limits.maxBatchIdBytes);
  const items = outcomes.map((outcome, itemIndex) => normalizeItem(outcome, itemIndex, limits));
  const { counts, ...status } = summarizeErrorIngestOutcomes(items);
  const report = aggregateClientReport(items, limits.maxClientReportEntries);
  const legacyBatch: ErrorIngestLegacyBatchOutcomeProjection = {
    batchId: normalizedBatchId,
    status: status.status,
    itemCount: items.length,
    counts,
    acceptedItems: counts.accepted,
    deduplicatedItems: counts.deduplicated,
    queuedItems: counts.queued,
    rejectedItems: rejectedItemCount(counts),
    truncatedClientReportEntries: report.truncation.clientReportEntries,
    truncatedClientReportItems: report.truncation.clientReportItems,
    ...(status.reason === undefined ? {} : { reason: status.reason }),
  };

  return {
    batchId: normalizedBatchId,
    itemCount: items.length,
    status: status.status,
    counts,
    items,
    clientReport: report.report,
    otlpPartialSuccess: {
      logs: otlpPartialSuccess(items, "logs", limits.maxErrorMessageBytes),
      traces: otlpPartialSuccess(items, "traces", limits.maxErrorMessageBytes),
    },
    legacyBatch,
    truncation: report.truncation,
    idempotencyKey: idempotencyKey(normalizedBatchId, items),
  };
}
