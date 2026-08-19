import type { SmartRequest } from "@/route-handlers/smart-request";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  arePlanLimitsEnforced: vi.fn(() => true),
  buildTelemetryWritePlan: vi.fn(() => ({ destinations: [], issueInputs: [], batchId: "batch" })),
  findRecentSessionReplay: vi.fn(),
  getBillingTeamId: vi.fn(() => "billing-team"),
  getPrismaClientForTenancy: vi.fn(async () => ({})),
  insertBatchEvents: vi.fn(),
  normalizeBatchEvents: vi.fn(() => ({ productEvents: [], logOccurrences: [], issueInputs: [] })),
  tryDecreasePlanItemQuantities: vi.fn(),
}));

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
  getPrismaClientForTenancy: mocks.getPrismaClientForTenancy,
}));
vi.mock("@/lib/session-replays", () => ({
  findRecentSessionReplay: mocks.findRecentSessionReplay,
}));
vi.mock("@/lib/plan-entitlements", () => ({
  arePlanLimitsEnforced: mocks.arePlanLimitsEnforced,
  getBillingTeamId: mocks.getBillingTeamId,
}));
vi.mock("@/lib/plan-metering", () => ({
  tryDecreasePlanItemQuantities: mocks.tryDecreasePlanItemQuantities,
}));
vi.mock("@/lib/analytics-telemetry-writers", () => ({
  buildTelemetryWritePlan: mocks.buildTelemetryWritePlan,
  insertBatchEvents: mocks.insertBatchEvents,
  normalizeBatchEvents: mocks.normalizeBatchEvents,
}));
vi.mock("@/lib/clickhouse", () => ({
  getSharedClickhouseAdminClient: vi.fn(() => ({})),
}));

import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { POST } from "./route";

const routeOverload = [...POST.overloads.values()].at(0);
if (routeOverload === undefined) throw new Error("analytics batch route did not register its POST overload");

// The released wire shape: a per-tab segment and only $page-view/$click events.
const LEGACY_BODY = {
  batch_id: "11111111-1111-4111-8111-111111111111",
  session_replay_segment_id: "22222222-2222-4222-8222-222222222222",
  sent_at_ms: 1_700_000_000_000,
  events: [{ event_type: "$page-view", event_at_ms: 1_700_000_000_000, data: "just a string" }],
};

// The dispatcher is mocked away (see above), so these tests invoke the overload
// handler directly. It takes the validated request plus the untouched full
// request; this route only destructures the former, but the signature demands
// both, so we hand over a real SmartRequest the handler never reads.
const FULL_REQUEST: SmartRequest = {
  auth: null,
  url: "http://localhost/api/latest/analytics/events/batch",
  method: "POST",
  body: LEGACY_BODY,
  bodyBuffer: new ArrayBuffer(0),
  headers: {},
  query: {},
  params: {},
  clientVersion: undefined,
};

type BatchHandlerRequest = Parameters<NonNullable<typeof routeOverload>["handler"]>[0];

// Only the fields this handler actually reads: the analytics app gate, the
// tenancy/user/refresh-token scope ids, and the body. Spelling out the full
// Tenancy and UsersCrud read shapes would add no coverage here, and anything
// the handler starts reading that is missing surfaces as a TypeError in these
// tests. Same fake-by-cast pattern as the sibling envelope route tests.
const HANDLER_REQUEST = {
  auth: {
    type: "client",
    tenancy: {
      id: "tenancy-1",
      branchId: "main",
      project: { id: "project-1" },
      config: {
        apps: { installed: { analytics: { enabled: true } } },
        observability: { errorGrouping: {} },
      },
    },
    user: { id: "user-1" },
    refreshTokenId: "refresh-token-1",
  },
  body: LEGACY_BODY,
} as unknown as BatchHandlerRequest;

function validateBatchRequest(body: unknown) {
  if (routeOverload === undefined) throw new Error("analytics batch route did not register its POST overload");
  return routeOverload.request.validate({ auth: { type: "client", tenancy: {} }, body }, { context: {} });
}

describe("analytics batch data contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.arePlanLimitsEnforced.mockReturnValue(true);
    mocks.getBillingTeamId.mockReturnValue("billing-team");
    mocks.findRecentSessionReplay.mockResolvedValue(null);
    mocks.tryDecreasePlanItemQuantities.mockResolvedValue({ insufficientItemId: null });
  });

  it("accepts any JSON data on batches — old SDKs hold that contract forever", async () => {
    await expect(validateBatchRequest(LEGACY_BODY)).resolves.toBeDefined();
  });

  it("uses one retry-stable debit and does not refund an ambiguous ClickHouse failure", async () => {
    mocks.insertBatchEvents.mockRejectedValueOnce(new Error("transport closed after commit"));

    await expect(routeOverload.handler(HANDLER_REQUEST, FULL_REQUEST))
      .rejects.toThrow("transport closed after commit");

    expect(mocks.tryDecreasePlanItemQuantities).toHaveBeenCalledWith("billing-team", [{
      itemId: ITEM_IDS.analyticsEvents,
      quantity: 1,
      idempotency: {
        key: `analytics-events:tenancy-1:${LEGACY_BODY.batch_id}`,
        createdAt: new Date(LEGACY_BODY.sent_at_ms),
      },
    }]);
    expect(mocks.tryDecreasePlanItemQuantities).toHaveBeenCalledOnce();
  });
});
