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

import { increasePlanItemQuantity } from "./plan-metering";

describe("plan metering persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrismaClientForTenancy.mockResolvedValue({});
    mocks.bulldozerDeleteItemQuantityChanges.mockResolvedValue(undefined);
    mocks.bulldozerWriteItemQuantityChanges.mockResolvedValue(undefined);
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
});
