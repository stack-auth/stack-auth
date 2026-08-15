/**
 * Itemized outcomes for the error-ingest boundary. These are intentionally
 * transport-neutral: routes and queues can later attach them to their own
 * response or client-report format without losing per-item meaning.
 */

export type ErrorIngestItemType = "event" | "log" | "span" | "transaction" | "attachment" | "client_report" | "unknown";

export type ErrorIngestOutcomeStatus =
  | "accepted"
  | "filtered"
  | "rate_limited"
  | "rejected"
  | "deduplicated"
  | "dropped"
  | "queued";

export type ErrorIngestFilterReason = "configured_filter" | "privacy" | "sampling";
export type ErrorIngestRateLimitReason = "quota" | "rate_limit";
export type ErrorIngestRejectReason = "auth" | "invalid" | "payload_too_large" | "unsupported";
export type ErrorIngestDropReason = "delivery_failed" | "internal" | "queue_full" | "shutdown";
export type ErrorIngestQueueReason = "offline" | "retryable";

export type ErrorIngestItemDescriptor = {
  itemId: string,
  itemType: ErrorIngestItemType,
  eventId?: string,
};

export type ErrorIngestItemOutcomeDetails =
  | { status: "accepted" }
  | { status: "filtered", reason: ErrorIngestFilterReason }
  | { status: "rate_limited", reason: ErrorIngestRateLimitReason, retryAfterMs?: number }
  | { status: "rejected", reason: ErrorIngestRejectReason }
  | { status: "deduplicated", canonicalItemId: string }
  | { status: "dropped", reason: ErrorIngestDropReason }
  | { status: "queued", reason: ErrorIngestQueueReason, retryAfterMs?: number };

export type ErrorIngestItemOutcome = ErrorIngestItemDescriptor & ErrorIngestItemOutcomeDetails;

export type ErrorIngestBatchStatus = ErrorIngestOutcomeStatus | "partial";

export type ErrorIngestBatchCounts = Readonly<Record<ErrorIngestOutcomeStatus, number>>;

export type ErrorIngestBatchOutcome = {
  batchId: string,
  status: ErrorIngestBatchStatus,
  itemCount: number,
  counts: ErrorIngestBatchCounts,
  outcomes: readonly ErrorIngestItemOutcome[],
  reason?: "empty_batch",
};

export const ERROR_INGEST_OUTCOME_STATUSES: readonly ErrorIngestOutcomeStatus[] = [
  "accepted",
  "filtered",
  "rate_limited",
  "rejected",
  "deduplicated",
  "dropped",
  "queued",
];

/** Combines an item descriptor with one typed outcome branch. */
export function createErrorIngestItemOutcome(
  item: ErrorIngestItemDescriptor,
  details: ErrorIngestItemOutcomeDetails,
): ErrorIngestItemOutcome {
  return { ...item, ...details };
}

function emptyCounts(): Record<ErrorIngestOutcomeStatus, number> {
  return {
    accepted: 0,
    filtered: 0,
    rate_limited: 0,
    rejected: 0,
    deduplicated: 0,
    dropped: 0,
    queued: 0,
  };
}

function batchStatus(
  outcomes: readonly ErrorIngestItemOutcome[],
): { status: ErrorIngestBatchStatus, reason?: "empty_batch" } {
  if (outcomes.length === 0) return { status: "rejected", reason: "empty_batch" };

  const firstStatus = outcomes[0].status;
  for (const outcome of outcomes.slice(1)) {
    if (outcome.status !== firstStatus) return { status: "partial" };
  }
  return { status: firstStatus };
}

/**
 * Summarizes item outcomes without collapsing the item list. Mixed outcomes
 * are represented as `partial`; homogeneous filtered/rate-limited/deduplicated
 * batches retain their precise status.
 */
export function createErrorIngestBatchOutcome(
  batchId: string,
  outcomes: readonly ErrorIngestItemOutcome[],
): ErrorIngestBatchOutcome {
  const counts = emptyCounts();
  for (const outcome of outcomes) counts[outcome.status] += 1;

  const status = batchStatus(outcomes);
  return {
    batchId,
    status: status.status,
    itemCount: outcomes.length,
    counts,
    outcomes: outcomes.map((outcome) => ({ ...outcome })),
    ...(status.reason === undefined ? {} : { reason: status.reason }),
  };
}
