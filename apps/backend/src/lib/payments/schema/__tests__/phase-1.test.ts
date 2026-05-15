/**
 * Phase 1 tests: SeedEvents StoredTables → Events → Transactions
 *
 * Tests are grouped by:
 * 1. Non-TimeFold events (subscription-renewal, subscription-cancel, OTP, manual-item-quantity-change)
 * 2. TimeFold events (subscription-start, subscription-end, item-grant-repeat)
 * 3. Event → Transaction mapping
 * 4. Transaction fields (txnId, effectiveAtMillis, entry ordering)
 *
 * Each test uses unique IDs and is self-contained.
 * Time simulation: BulldozerTimeFoldMetadata.lastProcessedAt = 2099-01-01
 * so all TimeFold-scheduled repeats fire immediately.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBulldozerExecutionContext, type BulldozerExecutionContext } from "@/lib/bulldozer/db/index";
import { createPaymentsSchema } from "../index";
import type { TransactionRow } from "../types";
import { createTestDb, jsonbExpr } from "./test-helpers";

const DAY_MS = 86400000;
const MONTH_MS = 2592000000;

describe.sequential("payments schema phase 1 (real postgres)", () => {
  const db = createTestDb();
  const { runStatements, readRows } = db;
  const schema = createPaymentsSchema();
  let executionContext = createBulldozerExecutionContext();

  const getRowDatas = async (table: { listRowsInGroup: (ctx: BulldozerExecutionContext, opts: any) => any }) => {
    const rows = await readRows(table.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    return rows.map((r: any) => r.rowdata);
  };

  const makeSubscription = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    tenancyId: "t1",
    customerId: `customer-${id}`,
    customerType: "user",
    productId: `prod-${id}`,
    priceId: "p1",
    product: {
      displayName: "Test Plan",
      customerType: "user",
      productLineId: `line-${id}`,
      prices: { p1: { USD: "10" } },
      includedItems: {},
    },
    quantity: 1,
    stripeSubscriptionId: null,
    status: "active",
    currentPeriodStartMillis: 0,
    currentPeriodEndMillis: MONTH_MS,
    cancelAtPeriodEnd: false,
    canceledAtMillis: null,
    endedAtMillis: null,
    refundedAtMillis: null,
    creationSource: "TEST_MODE",
    createdAtMillis: 0,
    ...overrides,
  });

  beforeEach(() => {
    executionContext = createBulldozerExecutionContext();
  });

  beforeAll(async () => {
    await db.setup();
    for (const table of schema._allPhase1Tables) {
      await runStatements(table.init(executionContext));
    }
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });


  // ============================================================
  // 1. Non-TimeFold events
  // ============================================================

  describe("subscription-renewal events", () => {
    it("should generate renewal event from subscription + non-creation invoice", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-renewal-1", jsonbExpr(makeSubscription("sub-renewal-1", {
        stripeSubscriptionId: "stripe-sub-renewal-1",
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 1000,
      }))));
      await runStatements(schema.subscriptionInvoices.setRow(executionContext, "inv-renewal-1", jsonbExpr({
        id: "inv-renewal-1",
        tenancyId: "t1",
        stripeSubscriptionId: "stripe-sub-renewal-1",
        stripeInvoiceId: "stripe-inv-1",
        isSubscriptionCreationInvoice: false,
        status: "paid",
        amountTotal: 1000,
        hostedInvoiceUrl: null,
        createdAtMillis: 2000,
      })));

      const events = await getRowDatas(schema.subscriptionRenewalEvents);
      const event = events.find((e: any) => e.invoiceId === "inv-renewal-1");
      expect(event).toBeDefined();
      expect(event.subscriptionId).toBe("sub-renewal-1");
      expect(event.paymentProvider).toBe("stripe");
      expect(event.effectiveAtMillis).toBe(2000);
    });

    it("should NOT generate renewal event for creation invoices", async () => {
      await runStatements(schema.subscriptionInvoices.setRow(executionContext, "inv-creation-1", jsonbExpr({
        id: "inv-creation-1",
        tenancyId: "t1",
        stripeSubscriptionId: "stripe-sub-renewal-1",
        stripeInvoiceId: "stripe-inv-creation",
        isSubscriptionCreationInvoice: true,
        status: "paid",
        amountTotal: 1000,
        hostedInvoiceUrl: null,
        createdAtMillis: 1000,
      })));

      const events = await getRowDatas(schema.subscriptionRenewalEvents);
      const creationEvent = events.find((e: any) => e.invoiceId === "inv-creation-1");
      expect(creationEvent).toBeUndefined();
    });
  });


  describe("subscription-cancel events", () => {
    it("should generate cancel event for active subscription with cancelAtPeriodEnd", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-cancel-1", jsonbExpr(makeSubscription("sub-cancel-1", {
        cancelAtPeriodEnd: true,
        status: "active",
      }))));

      const events = await getRowDatas(schema.subscriptionCancelEvents);
      const event = events.find((e: any) => e.subscriptionId === "sub-cancel-1");
      expect(event).toBeDefined();
      expect(event.changeType).toBe("cancel");
    });

    it("should NOT generate cancel event for canceled subscription", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-cancel-2", jsonbExpr(makeSubscription("sub-cancel-2", {
        cancelAtPeriodEnd: true,
        status: "canceled",
      }))));

      const events = await getRowDatas(schema.subscriptionCancelEvents);
      const event = events.find((e: any) => e.subscriptionId === "sub-cancel-2");
      expect(event).toBeUndefined();
    });
  });


  describe("one-time-purchase events", () => {
    it("should generate OTP event with computed chargedAmount and itemGrants", async () => {
      await runStatements(schema.oneTimePurchases.setRow(executionContext, "otp-ev-1", jsonbExpr({
        id: "otp-ev-1",
        tenancyId: "t1",
        customerId: "u-otp-ev",
        customerType: "user",
        productId: "prod-coins",
        priceId: "price-coins",
        product: {
          displayName: "Coin Pack",
          customerType: "user",
          productLineId: "line-coins",
          prices: { "price-coins": { USD: "5" } },
          includedItems: {
            coins: { quantity: 100, expires: "never" },
          },
        },
        quantity: 2,
        stripePaymentIntentId: "pi-ev-1",
        revokedAtMillis: null,
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 3000,
      })));

      const events = await getRowDatas(schema.oneTimePurchaseEvents);
      const event = events.find((e: any) => e.purchaseId === "otp-ev-1");
      expect(event).toBeDefined();
      expect(event.chargedAmount).toMatchObject({ USD: "10" });
      expect(event.itemGrants).toHaveLength(1);
      expect(event.itemGrants[0]).toMatchObject({ itemId: "coins", quantity: 200 });
    });
  });


  describe("manual-item-quantity-change events", () => {
    it("should map through all fields correctly", async () => {
      await runStatements(schema.manualItemQuantityChanges.setRow(executionContext, "iqc-ev-1", jsonbExpr({
        id: "iqc-ev-1",
        tenancyId: "t1",
        customerId: "u-iqc-ev",
        customerType: "user",
        itemId: "credits",
        quantity: -5,
        description: null,
        expiresAtMillis: null,
        createdAtMillis: 4000,
      })));

      const events = await getRowDatas(schema.manualItemQuantityChangeEvents);
      const event = events.find((e: any) => e.changeId === "iqc-ev-1");
      expect(event).toBeDefined();
      expect(event).toMatchObject({
        itemId: "credits",
        quantity: -5,
        effectiveAtMillis: 4000,
      });
    });
  });


  // ============================================================
  // 2. TimeFold events
  // ============================================================

  describe("subscription TimeFold: subscription-start", () => {
    it("should emit subscription-start event when a subscription is inserted", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-tf-start", jsonbExpr(makeSubscription("sub-tf-start", {
        product: {
          displayName: "TF Plan",
          customerType: "user",
          productLineId: "line-tf",
          prices: { p1: { USD: "20" } },
          includedItems: {
            credits: { quantity: 100, expires: "when-purchase-expires" },
          },
        },
        createdAtMillis: 5000,
      }))));

      const startEvents = await getRowDatas(schema.subscriptionStartEvents);
      const event = startEvents.find((e: any) => e.subscriptionId === "sub-tf-start");
      expect(event).toBeDefined();
      expect(event.type).toBe("subscription-start");
      expect(event.effectiveAtMillis).toBe(5000);
      expect(event.itemGrants.length).toBeGreaterThanOrEqual(1);
      expect(event.itemGrants[0]).toMatchObject({ itemId: "credits", quantity: 100 });
    });
  });


  describe("subscription TimeFold: item-grant-repeat with when-repeated expiry", () => {
    it("should emit repeats that expire previous when-repeated grants", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-tf-repeat", jsonbExpr(makeSubscription("sub-tf-repeat", {
        product: {
          displayName: "Repeat Plan",
          customerType: "user",
          productLineId: "line-tf-repeat",
          prices: { p1: { USD: "5" } },
          includedItems: {
            tokens: { quantity: 50, repeat: [7, "day"], expires: "when-repeated" },
          },
        },
        endedAtMillis: 30 * DAY_MS,
        createdAtMillis: 0,
      }))));

      const repeatEvents = (await getRowDatas(schema.itemGrantRepeatEvents))
        .filter((e: any) => e.sourceId === "sub-tf-repeat" && e.sourceType === "subscription");

      expect(repeatEvents.length).toBeGreaterThan(0);

      for (const event of repeatEvents) {
        expect(event.itemGrants).toEqual(
          expect.arrayContaining([expect.objectContaining({ itemId: "tokens", quantity: 50 })])
        );
      }

      const withExpiries = repeatEvents.filter((e: any) => e.previousGrantsToExpire?.length > 0);
      expect(withExpiries.length).toBeGreaterThan(0);
      for (const event of withExpiries) {
        expect(event.previousGrantsToExpire[0].itemId).toBe("tokens");
      }
    });
  });


  describe("subscription TimeFold: subscription-end", () => {
    it("should emit subscription-end with correct expiries when endedAt is set", async () => {
      const endTime = 3 * MONTH_MS;
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-tf-end", jsonbExpr(makeSubscription("sub-tf-end", {
        product: {
          displayName: "End Plan",
          customerType: "user",
          productLineId: "line-tf-end",
          prices: { p1: { USD: "15" } },
          includedItems: {
            storage: { quantity: 100, repeat: [30, "day"], expires: "when-purchase-expires" },
          },
        },
        endedAtMillis: endTime,
        createdAtMillis: 0,
      }))));

      const endEvents = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-tf-end");
      expect(endEvents).toHaveLength(1);

      const endEvent = endEvents[0];
      expect(endEvent.type).toBe("subscription-end");
      expect(endEvent.effectiveAtMillis).toBe(endTime);
      expect(endEvent.itemQuantityChangesToExpire.length).toBeGreaterThan(0);
      for (const expiry of endEvent.itemQuantityChangesToExpire) {
        expect(expiry.itemId).toBe("storage");
      }
    });

    it("should have correct product revocation back-reference", async () => {
      const endEvents = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-tf-end");
      expect(endEvents[0].startProductGrantRef).toEqual({
        transactionId: "sub-start:sub-tf-end",
        entryIndex: 1,
      });
    });

    it("should NOT expire items with expires=never", async () => {
      const endTime = 2 * MONTH_MS;
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-tf-mixed", jsonbExpr(makeSubscription("sub-tf-mixed", {
        product: {
          displayName: "Mixed Plan",
          customerType: "user",
          productLineId: "line-tf-mixed",
          prices: { p1: { USD: "10" } },
          includedItems: {
            expiring: { quantity: 50, expires: "when-purchase-expires" },
            permanent: { quantity: 20, expires: "never" },
          },
        },
        endedAtMillis: endTime,
        createdAtMillis: 0,
      }))));

      const endEvents = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-tf-mixed");
      expect(endEvents).toHaveLength(1);

      const expiredItemIds = endEvents[0].itemQuantityChangesToExpire.map((e: any) => e.itemId);
      expect(expiredItemIds).toContain("expiring");
      expect(expiredItemIds).not.toContain("permanent");
    });

    it("should NOT emit subscription-end for active subscription without endedAt", async () => {
      const endEvents = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-tf-start");
      expect(endEvents).toHaveLength(0);
    });

    it("should expire when-repeated grants alongside when-purchase-expires when ending before any repeat", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-tf-end-mix-pre", jsonbExpr(makeSubscription("sub-tf-end-mix-pre", {
        product: {
          displayName: "Mix Pre-Repeat Plan",
          customerType: "user",
          productLineId: "line-tf-end-mix-pre",
          prices: { p1: { USD: "10" } },
          includedItems: {
            storage: { quantity: 100, expires: "when-purchase-expires" },
            quota: { quantity: 500, repeat: [7, "day"], expires: "when-repeated" },
          },
        },
        endedAtMillis: 3 * DAY_MS,
        createdAtMillis: 0,
      }))));

      const endEvents = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-tf-end-mix-pre");
      expect(endEvents).toHaveLength(1);

      const expiredByItem = new Map<string, any>();
      for (const expiry of endEvents[0].itemQuantityChangesToExpire) {
        expiredByItem.set(expiry.itemId, expiry);
      }
      expect([...expiredByItem.keys()].sort()).toEqual(["quota", "storage"]);
      expect(expiredByItem.get("storage").transactionId).toBe("sub-start:sub-tf-end-mix-pre");
      expect(expiredByItem.get("quota").transactionId).toBe("sub-start:sub-tf-end-mix-pre");
      expect(expiredByItem.get("quota").quantity).toBe(500);

      const repeats = (await getRowDatas(schema.itemGrantRepeatEvents))
        .filter((e: any) => e.sourceId === "sub-tf-end-mix-pre");
      expect(repeats).toHaveLength(0);
    });

    it("should reference the latest igr txnId for when-repeated grants when ending after repeats", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-tf-end-mix-post", jsonbExpr(makeSubscription("sub-tf-end-mix-post", {
        product: {
          displayName: "Mix Post-Repeat Plan",
          customerType: "user",
          productLineId: "line-tf-end-mix-post",
          prices: { p1: { USD: "10" } },
          includedItems: {
            storage: { quantity: 100, expires: "when-purchase-expires" },
            quota: { quantity: 500, repeat: [7, "day"], expires: "when-repeated" },
          },
        },
        endedAtMillis: 17 * DAY_MS,
        createdAtMillis: 0,
      }))));

      const endEvents = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-tf-end-mix-post");
      expect(endEvents).toHaveLength(1);

      const expiredByItem = new Map<string, any>();
      for (const expiry of endEvents[0].itemQuantityChangesToExpire) {
        expiredByItem.set(expiry.itemId, expiry);
      }
      expect([...expiredByItem.keys()].sort()).toEqual(["quota", "storage"]);

      // storage never repeated; still points at sub-start
      expect(expiredByItem.get("storage").transactionId).toBe("sub-start:sub-tf-end-mix-post");

      // quota last repeated at 14d; should point at that igr txn
      const latestRepeatMillis = 14 * DAY_MS;
      expect(expiredByItem.get("quota").transactionId).toBe(`igr:sub-tf-end-mix-post:${latestRepeatMillis}`);
      expect(expiredByItem.get("quota").quantity).toBe(500);

      const repeats = (await getRowDatas(schema.itemGrantRepeatEvents))
        .filter((e: any) => e.sourceId === "sub-tf-end-mix-post")
        .sort((a: any, b: any) => a.effectiveAtMillis - b.effectiveAtMillis);
      expect(repeats.map((r: any) => r.effectiveAtMillis)).toEqual([7 * DAY_MS, 14 * DAY_MS]);
    });

    it("should NOT expire permanent grants (expires=never, absent, or invalid)", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-tf-end-permanent", jsonbExpr(makeSubscription("sub-tf-end-permanent", {
        product: {
          displayName: "Permanent Grants Plan",
          customerType: "user",
          productLineId: "line-tf-end-permanent",
          prices: { p1: { USD: "10" } },
          includedItems: {
            expiring: { quantity: 50, expires: "when-purchase-expires" },
            repeating: { quantity: 10, repeat: [1, "day"], expires: "when-repeated" },
            permanent_never: { quantity: 20, expires: "never" },
            permanent_absent: { quantity: 30 },
            permanent_invalid: { quantity: 40, expires: "not-a-real-value" },
          },
        },
        endedAtMillis: 2 * MONTH_MS,
        createdAtMillis: 0,
      }))));

      const endEvents = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-tf-end-permanent");
      expect(endEvents).toHaveLength(1);

      const expiredItemIds = endEvents[0].itemQuantityChangesToExpire.map((e: any) => e.itemId).sort();
      expect(expiredItemIds).toEqual(["expiring", "repeating"]);
    });
  });


  describe("subscription TimeFold: repeat timing", () => {
    it("should schedule repeats at anchor + N*interval and stop before endedAt", async () => {
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-tf-timing", jsonbExpr(makeSubscription("sub-tf-timing", {
        product: {
          displayName: "Timing Plan",
          customerType: "user",
          productLineId: "line-tf-timing",
          prices: { p1: { USD: "10" } },
          includedItems: {
            daily: { quantity: 10, repeat: [1, "day"], expires: "when-repeated" },
          },
        },
        endedAtMillis: 5 * DAY_MS,
        createdAtMillis: 5000,
      }))));

      const repeatEvents = (await getRowDatas(schema.itemGrantRepeatEvents))
        .filter((e: any) => e.sourceId === "sub-tf-timing" && e.sourceType === "subscription")
        .sort((a: any, b: any) => a.effectiveAtMillis - b.effectiveAtMillis);

      expect(repeatEvents.length).toBeGreaterThan(0);
      expect(repeatEvents[0].effectiveAtMillis).toBe(5000 + DAY_MS);

      for (let i = 1; i < repeatEvents.length; i++) {
        expect(repeatEvents[i].effectiveAtMillis).toBe(repeatEvents[i - 1].effectiveAtMillis + DAY_MS);
      }

      for (const event of repeatEvents) {
        expect(event.effectiveAtMillis).toBeLessThanOrEqual(5 * DAY_MS);
      }
    });
  });


  describe("OTP TimeFold: item-grant-repeat", () => {
    it("should emit item-grant-repeat events for OTP with repeating items", async () => {
      await runStatements(schema.oneTimePurchases.setRow(executionContext, "otp-tf-repeat", jsonbExpr({
        id: "otp-tf-repeat",
        tenancyId: "t1",
        customerId: "u-otp-tf",
        customerType: "user",
        productId: "prod-otp-tf",
        priceId: "p1",
        product: {
          displayName: "Token Pack",
          customerType: "user",
          productLineId: "line-otp-tf",
          prices: { p1: { USD: "5" } },
          includedItems: {
            tokens: { quantity: 100, repeat: [7, "day"], expires: "when-repeated" },
          },
        },
        quantity: 1,
        stripePaymentIntentId: null,
        revokedAtMillis: 30 * DAY_MS,
        refundedAtMillis: null,
        creationSource: "TEST_MODE",
        createdAtMillis: 0,
      })));

      const repeatEvents = (await getRowDatas(schema.itemGrantRepeatEvents))
        .filter((e: any) => e.sourceId === "otp-tf-repeat" && e.sourceType === "one_time_purchase");

      expect(repeatEvents.length).toBeGreaterThan(0);
      for (const event of repeatEvents) {
        expect(event.itemGrants).toEqual(
          expect.arrayContaining([expect.objectContaining({ itemId: "tokens", quantity: 100 })])
        );
      }
    });
  });


  // ============================================================
  // 3. Event → Transaction mapping
  // ============================================================

  describe("transaction mapping", () => {
    it("subscription-renewal transaction has correct money-transfer entry", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "sub-renewal:inv-renewal-1") as TransactionRow[];
      expect(txns).toHaveLength(1);
      expect(txns[0].entries).toHaveLength(1);
      expect(txns[0].entries[0]).toMatchObject({
        type: "money-transfer",
        chargedAmount: { USD: "10" },
      });
    });

    it("subscription-cancel transaction has correct entry", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "sub-cancel:sub-cancel-1") as TransactionRow[];
      expect(txns).toHaveLength(1);
      expect(txns[0].entries[0]).toMatchObject({
        type: "active-subscription-change",
        changeType: "cancel",
      });
    });

    it("subscription-start transaction has correct entry ordering", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "sub-start:sub-tf-start") as TransactionRow[];
      expect(txns).toHaveLength(1);

      const entryTypes = txns[0].entries.map((e: any) => e.type);
      expect(entryTypes[0]).toBe("active-subscription-start");
      expect(entryTypes[1]).toBe("product-grant");
    });

    it("one-time-purchase transaction has product-grant with oneTimePurchaseId", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "otp:otp-ev-1") as TransactionRow[];
      expect(txns).toHaveLength(1);
      expect(txns[0].entries[0]).toMatchObject({
        type: "product-grant",
        oneTimePurchaseId: "otp-ev-1",
      });
    });

    it("manual-item-quantity-change transaction has single entry with expiresWhen null", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "miqc:iqc-ev-1") as TransactionRow[];
      expect(txns).toHaveLength(1);
      expect(txns[0].entries).toHaveLength(1);
      expect((txns[0].entries[0] as any).expiresWhen).toBeNull();
    });
  });


  // ============================================================
  // 4. Refund pass-through
  // ============================================================

  describe("refund transaction", () => {
    it("should pass through refund from manualTransactions", async () => {
      await runStatements(schema.manualTransactions.setRow(executionContext, "refund-p1", jsonbExpr({
        txnId: "refund-p1-001",
        tenancyId: "t1",
        effectiveAtMillis: 9000,
        type: "refund",
        entries: [
          { type: "money-transfer", customerType: "user", customerId: "u-refund", chargedAmount: { USD: "-10" } },
        ],
        customerType: "user",
        customerId: "u-refund",
        paymentProvider: "stripe",
        createdAtMillis: 9000,
      })));

      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "refund-p1-001");
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe("refund");
    });

    it("should NOT pass through non-refund manual transactions", async () => {
      await runStatements(schema.manualTransactions.setRow(executionContext, "non-refund-p1", jsonbExpr({
        txnId: "other-p1-001",
        tenancyId: "t1",
        effectiveAtMillis: 9500,
        type: "subscription-start",
        entries: [],
        customerType: "user",
        customerId: "u-other",
        paymentProvider: "test_mode",
        createdAtMillis: 9500,
      })));

      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "other-p1-001");
      expect(txns).toHaveLength(0);
    });
  });


  // ============================================================
  // 5. Charged amount computation
  // ============================================================

  describe("charged amount computation", () => {
    it("should multiply price by quantity for multi-quantity OTP", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "otp:otp-ev-1") as TransactionRow[];
      const moneyEntry = txns[0].entries.find((e: any) => e.type === "money-transfer") as any;
      expect(moneyEntry).toBeDefined();
      expect(moneyEntry.chargedAmount.USD).toBe("10");
    });

    it("should compute chargedAmount for subscription renewal from product price", async () => {
      const events = await getRowDatas(schema.subscriptionRenewalEvents);
      const event = events.find((e: any) => e.invoiceId === "inv-renewal-1");
      expect(event.chargedAmount).toMatchObject({ USD: "10" });
    });

    it("should omit money-transfer for test_mode subscriptions", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId?.startsWith("sub-start:sub-cancel-")) as TransactionRow[];

      for (const txn of txns) {
        const hasMoneyTransfer = txn.entries.some((e: any) => e.type === "money-transfer");
        expect(hasMoneyTransfer).toBe(false);
      }
    });
  });


  // ============================================================
  // 6. txnId derivation
  // ============================================================

  describe("txnId derivation", () => {
    it("should use correct prefixes for all transaction types", async () => {
      const txns = await getRowDatas(schema.transactions);
      const txnIds = txns.map((t: any) => t.txnId as string);

      expect(txnIds.some(id => id.startsWith("sub-renewal:"))).toBe(true);
      expect(txnIds.some(id => id.startsWith("sub-cancel:"))).toBe(true);
      expect(txnIds.some(id => id.startsWith("sub-start:"))).toBe(true);
      expect(txnIds.some(id => id.startsWith("otp:"))).toBe(true);
      expect(txnIds.some(id => id.startsWith("miqc:"))).toBe(true);
      expect(txnIds.some(id => id.startsWith("refund"))).toBe(true);
    });
  });


  // ============================================================
  // 7. effectiveAtMillis correctness
  // ============================================================

  describe("effectiveAtMillis correctness", () => {
    it("subscription-renewal effectiveAt comes from invoice createdAt", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "sub-renewal:inv-renewal-1") as TransactionRow[];
      expect(txns[0].effectiveAtMillis).toBe(2000);
    });

    it("OTP effectiveAt comes from purchase createdAt", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "otp:otp-ev-1") as TransactionRow[];
      expect(txns[0].effectiveAtMillis).toBe(3000);
    });

    it("manual change effectiveAt comes from change createdAt", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "miqc:iqc-ev-1") as TransactionRow[];
      expect(txns[0].effectiveAtMillis).toBe(4000);
    });

    it("subscription-start effectiveAt comes from subscription createdAt", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "sub-start:sub-tf-start") as TransactionRow[];
      expect(txns[0].effectiveAtMillis).toBe(5000);
    });
  });
});
