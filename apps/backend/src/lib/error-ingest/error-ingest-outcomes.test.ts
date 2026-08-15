import { describe, expect, it } from "vitest";
import {
  createErrorIngestBatchOutcome,
  createErrorIngestItemOutcome,
  type ErrorIngestItemOutcome,
  type ErrorIngestItemDescriptor,
  type ErrorIngestOutcomeStatus,
} from "./error-ingest-outcomes";

const item = (itemId: string, itemType: ErrorIngestItemDescriptor["itemType"] = "event"): ErrorIngestItemDescriptor => ({
  itemId,
  itemType,
});

describe("error-ingest outcomes", () => {
  it("preserves typed item statuses and produces deterministic batch counts", () => {
    const outcomes = [
      createErrorIngestItemOutcome(item("accepted"), { status: "accepted" }),
      createErrorIngestItemOutcome(item("filtered"), { status: "filtered", reason: "privacy" }),
      createErrorIngestItemOutcome(item("limited"), { status: "rate_limited", reason: "quota", retryAfterMs: 1_000 }),
      createErrorIngestItemOutcome(item("rejected"), { status: "rejected", reason: "invalid" }),
      createErrorIngestItemOutcome(item("duplicate"), { status: "deduplicated", canonicalItemId: "accepted" }),
      createErrorIngestItemOutcome(item("dropped"), { status: "dropped", reason: "queue_full" }),
      createErrorIngestItemOutcome(item("queued"), { status: "queued", reason: "offline" }),
    ];

    const batch = createErrorIngestBatchOutcome("batch-1", outcomes);

    expect(batch).toEqual({
      batchId: "batch-1",
      status: "partial",
      itemCount: 7,
      counts: {
        accepted: 1,
        filtered: 1,
        rate_limited: 1,
        rejected: 1,
        deduplicated: 1,
        dropped: 1,
        queued: 1,
      },
      outcomes,
    });
  });

  const homogeneousOutcomes: readonly { status: ErrorIngestOutcomeStatus, outcome: ErrorIngestItemOutcome }[] = [
    { status: "accepted", outcome: createErrorIngestItemOutcome(item("accepted"), { status: "accepted" }) },
    { status: "filtered", outcome: createErrorIngestItemOutcome(item("filtered"), { status: "filtered", reason: "sampling" }) },
    { status: "rate_limited", outcome: createErrorIngestItemOutcome(item("rate_limited"), { status: "rate_limited", reason: "rate_limit" }) },
    { status: "rejected", outcome: createErrorIngestItemOutcome(item("rejected"), { status: "rejected", reason: "unsupported" }) },
    { status: "deduplicated", outcome: createErrorIngestItemOutcome(item("deduplicated"), { status: "deduplicated", canonicalItemId: "canonical" }) },
    { status: "dropped", outcome: createErrorIngestItemOutcome(item("dropped"), { status: "dropped", reason: "shutdown" }) },
    { status: "queued", outcome: createErrorIngestItemOutcome(item("queued"), { status: "queued", reason: "retryable" }) },
  ];

  for (const { status, outcome } of homogeneousOutcomes) {
    it(`keeps a homogeneous ${status} batch precise`, () => {
      expect(createErrorIngestBatchOutcome(`batch-${status}`, [outcome]).status).toBe(status);
    });
  }

  it("marks an empty batch as an explicit rejection instead of an implicit success", () => {
    expect(createErrorIngestBatchOutcome("empty", [])).toEqual({
      batchId: "empty",
      status: "rejected",
      itemCount: 0,
      counts: {
        accepted: 0,
        filtered: 0,
        rate_limited: 0,
        rejected: 0,
        deduplicated: 0,
        dropped: 0,
        queued: 0,
      },
      outcomes: [],
      reason: "empty_batch",
    });
  });
});
