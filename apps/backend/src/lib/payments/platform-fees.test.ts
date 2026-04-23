import type { Tenancy } from "@/lib/tenancies";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectInverseFee, PlatformFeeSourceType, PlatformFeeStatus } from "./platform-fees";

type PlatformFeeRow = {
  tenancyId: string,
  projectId: string,
  sourceType: string,
  sourceId: string,
  amount: number,
  currency: string,
  status: string,
  stripeTransferId: string | null,
  collectedAt: Date | null,
  error: string | null,
};

const mocks = vi.hoisted(() => ({
  rows: new Map<string, PlatformFeeRow>(),
  captureError: vi.fn(),
  findProject: vi.fn(),
  transferList: vi.fn(),
  transferCreate: vi.fn(),
  platformFeeEventUpsert: vi.fn(),
  platformFeeEventUpdate: vi.fn(),
}));

function rowKey(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

vi.mock("@/prisma-client", () => ({
  globalPrismaClient: {
    platformFeeEvent: {
      upsert: mocks.platformFeeEventUpsert,
      update: mocks.platformFeeEventUpdate,
    },
    project: {
      findUnique: mocks.findProject,
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStackStripe: () => ({
    transfers: {
      list: mocks.transferList,
      create: mocks.transferCreate,
    },
  }),
}));

vi.mock("@stackframe/stack-shared/dist/utils/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stackframe/stack-shared/dist/utils/errors")>();
  return {
    ...actual,
    captureError: mocks.captureError,
  };
});

const tenancy = {
  id: "tenancy_1",
  project: { id: "project_1" },
} as Tenancy;

describe("collectInverseFee", () => {
  const originalPlatformAccountId = process.env.STACK_STRIPE_PLATFORM_ACCOUNT_ID;

  beforeEach(() => {
    mocks.rows.clear();
    mocks.captureError.mockClear();
    mocks.findProject.mockReset().mockResolvedValue({ stripeAccountId: "acct_connected" });
    mocks.transferList.mockReset();
    mocks.transferCreate.mockReset();
    mocks.platformFeeEventUpsert.mockReset().mockImplementation(async ({ where, create }) => {
      const key = rowKey(where.sourceType_sourceId.sourceType, where.sourceType_sourceId.sourceId);
      const existing = mocks.rows.get(key);
      if (existing) return existing;
      const row = {
        ...create,
        stripeTransferId: null,
        collectedAt: null,
        error: null,
      };
      mocks.rows.set(key, row);
      return row;
    });
    mocks.platformFeeEventUpdate.mockReset().mockImplementation(async ({ where, data }) => {
      const key = rowKey(where.sourceType_sourceId.sourceType, where.sourceType_sourceId.sourceId);
      const existing = mocks.rows.get(key);
      if (!existing) throw new Error(`missing row ${key}`);
      const row = { ...existing, ...data };
      mocks.rows.set(key, row);
      return row;
    });
    process.env.STACK_STRIPE_PLATFORM_ACCOUNT_ID = "acct_platform";
  });

  afterEach(() => {
    if (originalPlatformAccountId === undefined) {
      delete process.env.STACK_STRIPE_PLATFORM_ACCOUNT_ID;
    } else {
      process.env.STACK_STRIPE_PLATFORM_ACCOUNT_ID = originalPlatformAccountId;
    }
  });

  it("fails closed instead of creating a transfer when Stripe reconciliation lookup fails", async () => {
    mocks.transferList.mockRejectedValue(new Error("stripe list unavailable"));

    await collectInverseFee({
      tenancy,
      amountStripeUnits: 10_000,
      currency: "usd",
      sourceType: PlatformFeeSourceType.REFUND,
      sourceId: "refund_1",
    });

    expect(mocks.transferList).toHaveBeenCalledWith(
      { transfer_group: "platform-fee-REFUND-refund_1", limit: 1 },
      { stripeAccount: "acct_connected" },
    );
    expect(mocks.transferCreate).not.toHaveBeenCalled();
    expect(mocks.rows.get("REFUND:refund_1")).toMatchObject({
      status: PlatformFeeStatus.FAILED,
      error: expect.stringContaining("rather than risking double-debit"),
    });
  });
});
