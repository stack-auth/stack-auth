import { describe, expect, it, vi } from "vitest";
import { createErrorIngestPolicyStateStore, evaluateErrorIngestPolicy } from "@/lib/error-ingest";
import { createLegacyBatchProtocolProjection } from "@/lib/error-ingest/error-ingest-protocol-projections";
import { CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES } from "@hexclave/shared/dist/utils/analytics-wire";

// Route-schema tests should not initialize the full backend request stack
// (Prisma, billing, QStash). Same pattern as the issues route-schema tests:
// expose the overload definition so `overload.request` (the yup schema — the
// wire contract under test here) is reachable without the server dispatcher.
vi.mock("@/route-handlers/smart-route-handler", () => ({
  createSmartRouteHandler: (...args: readonly unknown[]) => {
    const definition = args.at(-1);
    if (typeof definition !== "object" || definition === null) throw new Error("route definition is missing");
    return { overloads: new Map([[undefined, definition]]) };
  },
}));
vi.mock("@/prisma-client", () => ({
  getPrismaClientForTenancy: vi.fn(),
}));
vi.mock("@/lib/session-replays", () => ({
  findRecentSessionReplay: vi.fn(),
}));
vi.mock("@/lib/plan-entitlements", () => ({
  arePlanLimitsEnforced: vi.fn(),
  getBillingTeamId: vi.fn(),
}));
vi.mock("@/lib/plan-metering", () => ({
  increasePlanItemQuantity: vi.fn(),
  tryDecreasePlanItemQuantities: vi.fn(),
}));
vi.mock("@/lib/qstash-outbox", () => ({
  buildTelemetryMaterializationMessage: vi.fn(),
  enqueueQstashMessage: vi.fn(),
}));

import { POST } from "./route";

const routeOverload = [...POST.overloads.values()].at(0);
if (routeOverload === undefined) throw new Error("analytics batch route did not register its POST overload");

// The released pre-versioned wire shape: no schema_version/resource, a per-tab
// segment, and only $page-view/$click events.
const LEGACY_BODY = {
  batch_id: "11111111-1111-4111-8111-111111111111",
  session_replay_segment_id: "22222222-2222-4222-8222-222222222222",
  sent_at_ms: 1_700_000_000_000,
  events: [{ event_type: "$page-view", event_at_ms: 1_700_000_000_000, data: "just a string" }],
};

const VERSIONED_BODY = {
  ...LEGACY_BODY,
  schema_version: 3,
  resource: { service: { name: "storefront" } },
};

function validateBatchRequest(body: unknown) {
  if (routeOverload === undefined) throw new Error("analytics batch route did not register its POST overload");
  return routeOverload.request.validate({ auth: { type: "client", tenancy: {} }, body }, { context: {} });
}

describe("analytics batch wire-version data contract", () => {
  it("accepts any JSON data on legacy batches — old SDKs hold that contract forever", async () => {
    await expect(validateBatchRequest(LEGACY_BODY)).resolves.toBeDefined();
  });

  it("rejects non-object data once the batch declares schema_version 3", async () => {
    await expect(validateBatchRequest(VERSIONED_BODY))
      .rejects.toThrow(/Event data must be a JSON object/);
  });

  it("applies the serialized-size cap to versioned batches only", async () => {
    // The serialized object is 11 bytes over the cap because the JSON
    // envelope adds `{"blob":"` and the closing `"}` around the payload.
    const oversized = { blob: "x".repeat(CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES) };
    const withOversizedData = (base: typeof LEGACY_BODY) => ({
      ...base,
      events: [{ event_type: "$page-view", event_at_ms: 1_700_000_000_000, data: oversized }],
    });

    await expect(validateBatchRequest(withOversizedData(LEGACY_BODY))).resolves.toBeDefined();
    await expect(validateBatchRequest(withOversizedData(VERSIONED_BODY)))
      .rejects.toThrow(/Event data must be a JSON object of at most/);
  });
});

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
