import { describe, expect, it, vi } from "vitest";
import { getTransactionsPaginatedList } from "./index";

function createMockPrisma(data: {
  defaultProductsSnapshots?: any[],
  subscriptions?: any[],
  subscriptionInvoices?: any[],
  oneTimePurchases?: any[],
  itemQuantityChanges?: any[],
}) {
  const defaultProductsSnapshots = data.defaultProductsSnapshots ?? [];
  const subscriptions = data.subscriptions ?? [];
  const subscriptionInvoices = data.subscriptionInvoices ?? [];
  const oneTimePurchases = data.oneTimePurchases ?? [];
  const itemQuantityChanges = data.itemQuantityChanges ?? [];

  function applyCustomerFilter<T extends { customerType?: string, customerId?: string }>(rows: T[], where: any) {
    return rows.filter((row) => {
      if (where?.customerType && row.customerType !== where.customerType) return false;
      if (where?.customerId && row.customerId !== where.customerId) return false;
      return true;
    });
  }

  return {
    defaultProductsSnapshot: {
      findMany: async () => defaultProductsSnapshots,
    },
    subscription: {
      findMany: async ({ where }: any) => applyCustomerFilter(subscriptions, where),
    },
    subscriptionInvoice: {
      findMany: async ({ where }: any) => {
        const filtered = subscriptionInvoices.filter((invoice) => {
          const sub = invoice.subscription;
          if (where?.subscription?.customerType && sub.customerType !== where.subscription.customerType) return false;
          if (where?.subscription?.customerId && sub.customerId !== where.subscription.customerId) return false;
          return true;
        });
        return filtered;
      },
    },
    oneTimePurchase: {
      findMany: async ({ where }: any) => applyCustomerFilter(oneTimePurchases, where),
    },
    itemQuantityChange: {
      findMany: async ({ where }: any) => applyCustomerFilter(itemQuantityChanges, where),
    },
  } as any;
}

describe("transactions list builder", () => {
  it("uses product grant indices for subscription-end revocation and expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const subscription = {
      id: "sub-1",
      customerType: "CUSTOM",
      customerId: "cust-1",
      productId: "prod-1",
      priceId: "monthly",
      quantity: 2,
      product: {
        customerType: "custom",
        displayName: "P1",
        stackable: false,
        serverOnly: false,
        isAddOnTo: false,
        productLineId: "line-1",
        includedItems: {
          seats: { quantity: 3, expires: "when-purchase-expires" },
        },
        prices: {
          monthly: { USD: "10" },
        },
      },
      billingCycleAnchor: new Date("2025-01-01T00:00:00.000Z"),
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      endedAt: new Date("2025-01-03T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      refundedAt: null,
      creationSource: "PURCHASE_PAGE",
      updatedAt: new Date("2025-01-02T00:00:00.000Z"),
    };

    const prisma = createMockPrisma({
      subscriptions: [subscription],
    });
    const list = getTransactionsPaginatedList(prisma, "tenancy-1");
    const page = await list.next({
      after: list.getFirstCursor(),
      limit: 50,
      filter: { customerType: "custom", customerId: "cust-1" },
      orderBy: "createdAt-desc",
      limitPrecision: "exact",
    });
    const txs = page.items.map((i) => i.item);
    const start = txs.find((tx) => tx.id === "sub-1");
    const end = txs.find((tx) => tx.id === "sub-1:end");
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    if (!start || !end) throw new Error("missing transactions");

    const grantIndex = start.entries.findIndex((e) => e.type === "product-grant");
    expect(grantIndex).toBeGreaterThan(-1);
    const grant = start.entries[grantIndex] as any;
    expect(grant.item_quantity_change_indices.seats).toBeGreaterThan(grantIndex);

    const revocation = end.entries.find((e) => e.type === "product-revocation") as any;
    const seatsExpire = end.entries.find((e) => e.type === "item-quantity-expire" && (e as any).item_id === "seats") as any;
    expect(revocation.adjusted_transaction_id).toBe("sub-1");
    expect(revocation.adjusted_entry_index).toBe(grantIndex);
    expect(seatsExpire.adjusted_transaction_id).toBe("sub-1");
    expect(seatsExpire.adjusted_entry_index).toBe(grant.item_quantity_change_indices.seats);
  });

  it("chains item-grant-renewal expiries against the previous renewal grant", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-04T00:00:00.000Z"));

    const purchase = {
      id: "otp-1",
      customerType: "CUSTOM",
      customerId: "cust-1",
      productId: "prod-otp",
      priceId: "monthly",
      quantity: 1,
      product: {
        customerType: "custom",
        displayName: "OTP",
        stackable: false,
        serverOnly: false,
        isAddOnTo: false,
        productLineId: "line-1",
        includedItems: {
          credits: { quantity: 5, expires: "when-repeated", repeat: [1, "day"] },
        },
        prices: {
          monthly: { USD: "10" },
        },
      },
      refundedAt: null,
      creationSource: "PURCHASE_PAGE",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };

    const prisma = createMockPrisma({
      oneTimePurchases: [purchase],
    });
    const list = getTransactionsPaginatedList(prisma, "tenancy-1");
    const page = await list.next({
      after: list.getFirstCursor(),
      limit: 50,
      filter: { customerType: "custom", customerId: "cust-1" },
      orderBy: "createdAt-desc",
      limitPrecision: "exact",
    });
    const txs = page.items.map((i) => i.item);
    const renewalTxs = txs.filter((tx) => tx.type === "item-grant-renewal").sort((a, b) => a.created_at_millis - b.created_at_millis);
    expect(renewalTxs.length).toBeGreaterThanOrEqual(2);
    const firstRenewalExpire = renewalTxs[0].entries.find((e) => e.type === "item-quantity-expire") as any;
    const secondRenewalExpire = renewalTxs[1].entries.find((e) => e.type === "item-quantity-expire") as any;
    expect(firstRenewalExpire.adjusted_transaction_id).toBe("otp-1");
    expect(secondRenewalExpire.adjusted_transaction_id).toBe(renewalTxs[0].id);
  });

  it("emits default product repeat transactions from default snapshots", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-04T00:00:00.000Z"));

    const prisma = createMockPrisma({
      defaultProductsSnapshots: [{
        id: "snap-1",
        tenancyId: "tenancy-1",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        snapshot: {
          "prod-default": {
            customer_type: "custom",
            display_name: "Default",
            stackable: false,
            server_only: false,
            included_items: {
              credits: { quantity: 2, expires: "when-repeated", repeat: [1, "day"] },
            },
            prices: "include-by-default",
          },
        },
      }],
    });

    const list = getTransactionsPaginatedList(prisma, "tenancy-1");
    const page = await list.next({
      after: list.getFirstCursor(),
      limit: 50,
      filter: {},
      orderBy: "createdAt-desc",
      limitPrecision: "exact",
    });
    const txs = page.items.map((i) => i.item);
    expect(txs.some((tx) => tx.type === "default-products-change")).toBe(true);
    expect(txs.some((tx) => tx.type === "default-product-item-grant-repeat")).toBe(true);
  });
});
