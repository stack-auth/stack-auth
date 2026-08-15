import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bulldozerDeleteItemQuantityChanges: vi.fn(),
  bulldozerTryDecreaseItemQuantityChanges: vi.fn(),
  bulldozerWriteItemQuantityChanges: vi.fn(),
  createMany: vi.fn(),
  ensureCustomerExists: vi.fn(),
  getPrismaClientForTenancy: vi.fn(),
  retryTransaction: vi.fn(),
}));

vi.mock("@/lib/payments", () => ({
  ensureCustomerExists: mocks.ensureCustomerExists,
}));

vi.mock("@/lib/payments/bulldozer-dual-write", () => ({
  bulldozerDeleteItemQuantityChanges: mocks.bulldozerDeleteItemQuantityChanges,
  bulldozerTryDecreaseItemQuantityChanges: mocks.bulldozerTryDecreaseItemQuantityChanges,
  bulldozerWriteItemQuantityChanges: mocks.bulldozerWriteItemQuantityChanges,
}));

vi.mock("@/lib/payments/customer-data", () => ({
  getItemQuantitiesForCustomer: vi.fn(),
}));

vi.mock("@/prisma-client", () => ({
  getPrismaClientForTenancy: mocks.getPrismaClientForTenancy,
  retryTransaction: mocks.retryTransaction,
}));

vi.mock("./tenancies", () => ({
  DEFAULT_BRANCH_ID: "main",
  getSoleTenancyFromProjectBranch: vi.fn(async () => ({
    id: "internal-tenancy",
    config: {
      payments: {
        items: {
          analytics_events: { customerType: "team" },
          analytics_spans: { customerType: "team" },
          session_replays: { customerType: "team" },
          analytics_timeout_seconds: { customerType: "team" },
        },
      },
    },
  })),
}));

import { increasePlanItemQuantity, tryDecreasePlanItemQuantities } from "./plan-metering";

describe("plan metering persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrismaClientForTenancy.mockResolvedValue({});
    mocks.bulldozerDeleteItemQuantityChanges.mockResolvedValue(undefined);
    mocks.bulldozerTryDecreaseItemQuantityChanges.mockResolvedValue({ insufficientItemId: null });
    mocks.bulldozerWriteItemQuantityChanges.mockResolvedValue(undefined);
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.retryTransaction.mockImplementation(async (_prisma, callback) => await callback({
      itemQuantityChange: {
        createMany: mocks.createMany,
      },
    }));
  });

  it("removes an applied Bulldozer credit when Postgres persistence fails", async () => {
    const persistenceError = new Error("Postgres unavailable");
    mocks.createMany.mockRejectedValue(persistenceError);

    await expect(increasePlanItemQuantity(
      "billing-team",
      ITEM_IDS.analyticsEvents,
      3,
    )).rejects.toBe(persistenceError);

    expect(mocks.bulldozerWriteItemQuantityChanges).toHaveBeenCalledOnce();
    expect(mocks.bulldozerDeleteItemQuantityChanges).toHaveBeenCalledOnce();
    expect(mocks.bulldozerDeleteItemQuantityChanges).toHaveBeenCalledWith(
      mocks.bulldozerWriteItemQuantityChanges.mock.calls[0][0],
    );
  });
  it("uses the same valid UUID row and timestamp for an idempotent telemetry debit retry", async () => {
    const createdAt = new Date("2026-08-04T12:00:00.123Z");
    const idempotency = {
      key: "otlp-span:0123456789abcdef0123456789abcdef:0123456789abcdef",
      createdAt,
    };

    await tryDecreasePlanItemQuantities("billing-team", [{ itemId: ITEM_IDS.analyticsSpans, quantity: 1, idempotency }]);
    await tryDecreasePlanItemQuantities("billing-team", [{ itemId: ITEM_IDS.analyticsSpans, quantity: 1, idempotency }]);

    const firstChange = mocks.bulldozerTryDecreaseItemQuantityChanges.mock.calls[0][0][0];
    const retryChange = mocks.bulldozerTryDecreaseItemQuantityChanges.mock.calls[1][0][0];
    expect(firstChange.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(retryChange).toEqual(firstChange);
    expect(firstChange.createdAt).toEqual(createdAt);
  });
});
