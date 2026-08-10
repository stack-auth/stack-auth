import { describe, expect, it } from "vitest";
import { createErrorIngestPolicyStateStore, evaluateErrorIngestPolicy } from "@/lib/error-ingest";
import { createLegacyBatchProtocolProjection } from "@/lib/error-ingest/error-ingest-protocol-projections";

describe("legacy analytics batch protocol boundary", () => {
  it("keeps accepted-batch projections count-only and retry-stable", () => {
    const projection = createLegacyBatchProtocolProjection("batch-1", 2, 1);

    expect(projection).toMatchObject({
      status: "accepted",
      itemCount: 3,
      counts: {
        accepted: 3,
        filtered: 0,
        rate_limited: 0,
        rejected: 0,
        deduplicated: 0,
        dropped: 0,
        queued: 0,
      },
      legacyBatch: {
        acceptedItems: 3,
        rejectedItems: 0,
      },
    });
    expect(projection.items).toEqual([
      expect.objectContaining({ itemIndex: 0, itemId: "event:0", itemType: "event", status: "accepted" }),
      expect.objectContaining({ itemIndex: 1, itemId: "event:1", itemType: "event", status: "accepted" }),
      expect.objectContaining({ itemIndex: 2, itemId: "span:0", itemType: "span", status: "accepted" }),
    ]);
    expect(projection.clientReport).toEqual({
      discarded_events: [],
      rate_limited_events: [],
      filtered_events: [],
      filtered_sampling_events: [],
    });
    expect(projection.idempotencyKey).toBe(createLegacyBatchProtocolProjection("batch-1", 2, 1).idempotencyKey);
    expect(JSON.stringify(projection)).not.toContain("message");
    expect(JSON.stringify(projection)).not.toContain("secret");
  });

  it("retains an explicit empty-batch rejection for the future itemized path", () => {
    const projection = createLegacyBatchProtocolProjection("empty-batch", 0, 0);

    expect(projection.status).toBe("rejected");
    expect(projection.legacyBatch.reason).toBe("empty_batch");
    expect(projection.otlpPartialSuccess.logs.rejectedItems).toBe(0);
  });

  it("projects policy rate limits as explicit client-report outcomes", () => {
    const policy = evaluateErrorIngestPolicy({
      config: { observability: { errorIngest: { rateLimit: { maxItemsPerWindow: 1, windowSeconds: 60 } } } },
      scope: { tenancyId: "tenancy-1", projectId: "project-1", branchId: "branch-1" },
      items: [
        { itemId: "event:0", itemType: "event", data: { message: "first" } },
        { itemId: "event:1", itemType: "event", data: { message: "second" } },
      ],
      nowMs: 1_000,
      stateStore: createErrorIngestPolicyStateStore(),
    });
    const projection = createLegacyBatchProtocolProjection("policy-batch", 1, 0, policy.outcomes);

    expect(projection.status).toBe("partial");
    expect(projection.counts).toMatchObject({ accepted: 1, rate_limited: 1 });
    expect(projection.clientReport.rate_limited_events).toEqual([
      { reason: "rate_limit", category: "error", quantity: 1 },
    ]);
  });
});
