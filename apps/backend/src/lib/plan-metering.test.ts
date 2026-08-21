import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bulldozerDeleteItemQuantityChanges: vi.fn(),
  bulldozerTryDecreaseItemQuantityChanges: vi.fn(),
  createMany: vi.fn(),
  deleteMany: vi.fn(),
  findMany: vi.fn(),
  ensureCustomerExists: vi.fn(),
  getPrismaClientForTenancy: vi.fn(),
  executeRaw: vi.fn(),
  retryTransaction: vi.fn(),
}));

vi.mock("@/lib/payments", () => ({
  ensureCustomerExists: mocks.ensureCustomerExists,
}));

vi.mock("@/lib/payments/bulldozer-dual-write", () => ({
  bulldozerDeleteItemQuantityChanges: mocks.bulldozerDeleteItemQuantityChanges,
  bulldozerTryDecreaseItemQuantityChanges: mocks.bulldozerTryDecreaseItemQuantityChanges,
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

import { rollbackPlanItemDebits, tryDecreasePlanItemQuantities } from "./plan-metering";

describe("plan metering persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrismaClientForTenancy.mockResolvedValue({});
    mocks.bulldozerDeleteItemQuantityChanges.mockResolvedValue(undefined);
    mocks.bulldozerTryDecreaseItemQuantityChanges.mockResolvedValue({ insufficientItemId: null });
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.findMany.mockResolvedValue([]);
    mocks.executeRaw.mockResolvedValue(0);
    mocks.retryTransaction.mockImplementation(async (_prisma, callback) => await callback({
      $executeRaw: mocks.executeRaw,
      itemQuantityChange: {
        createMany: mocks.createMany,
        deleteMany: mocks.deleteMany,
        findMany: mocks.findMany,
      },
    }));
  });

  it("rolls back the original retry-stable debit without exposing a temporary credit", async () => {
    const debit = {
      itemId: ITEM_IDS.analyticsEvents,
      quantity: 3,
      idempotency: { key: "analytics-events:tenancy:batch", createdAt: new Date("2026-08-04T12:00:00.123Z") },
    };
    const debitResult = await tryDecreasePlanItemQuantities("billing-team", [debit]);
    const originalChange = mocks.bulldozerTryDecreaseItemQuantityChanges.mock.calls[0][0][0];

    await rollbackPlanItemDebits("billing-team", [debit], new Set(debitResult.createdChangeIds));

    expect(mocks.bulldozerDeleteItemQuantityChanges).toHaveBeenCalledOnce();
    expect(mocks.bulldozerDeleteItemQuantityChanges).toHaveBeenCalledWith([originalChange]);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { tenancyId: "internal-tenancy", id: { in: [originalChange.id] } },
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  });

  it("holds the customer lock while compensating a failed debit persistence", async () => {
    const persistenceError = new Error("Postgres unavailable");
    mocks.createMany.mockRejectedValueOnce(persistenceError);

    await expect(tryDecreasePlanItemQuantities("billing-team", [{
      itemId: ITEM_IDS.analyticsEvents,
      quantity: 1,
      idempotency: { key: "batch", createdAt: new Date("2026-08-04T12:00:00.123Z") },
    }])).rejects.toBe(persistenceError);

    const lockOrder = mocks.executeRaw.mock.invocationCallOrder.at(0);
    const debitOrder = mocks.bulldozerTryDecreaseItemQuantityChanges.mock.invocationCallOrder.at(0);
    if (lockOrder === undefined || debitOrder === undefined) throw new Error("Expected lock and debit calls");
    expect(lockOrder).toBeLessThan(debitOrder);
    expect(mocks.bulldozerDeleteItemQuantityChanges).toHaveBeenCalledOnce();
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

  it("does not let an idempotent retry claim or roll back another invocation's debit", async () => {
    const debit = {
      itemId: ITEM_IDS.sessionReplays,
      quantity: 1,
      idempotency: { key: "session-replay:tenancy:batch", createdAt: new Date("2026-08-04T12:00:00.123Z") },
    };
    const first = await tryDecreasePlanItemQuantities("billing-team", [debit]);
    const createdChangeId = first.createdChangeIds.at(0);
    if (createdChangeId === undefined) throw new Error("Expected the first debit to own a plan change");

    mocks.findMany.mockResolvedValueOnce([{ id: createdChangeId }]);
    const retry = await tryDecreasePlanItemQuantities("billing-team", [debit]);
    expect(retry.createdChangeIds).toEqual([]);
    expect(mocks.bulldozerTryDecreaseItemQuantityChanges).toHaveBeenCalledOnce();

    await rollbackPlanItemDebits("billing-team", [debit], new Set(retry.createdChangeIds));
    expect(mocks.bulldozerDeleteItemQuantityChanges).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
