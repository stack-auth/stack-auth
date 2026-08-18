import { describe, expect, it, vi } from "vitest";

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

function validateBatchRequest(body: unknown) {
  if (routeOverload === undefined) throw new Error("analytics batch route did not register its POST overload");
  return routeOverload.request.validate({ auth: { type: "client", tenancy: {} }, body }, { context: {} });
}

describe("analytics batch data contract", () => {
  it("accepts any JSON data on batches — old SDKs hold that contract forever", async () => {
    await expect(validateBatchRequest(LEGACY_BODY)).resolves.toBeDefined();
  });
});
