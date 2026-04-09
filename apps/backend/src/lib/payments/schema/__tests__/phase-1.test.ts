/**
 * Phase 1 tests: SeedEvents StoredTables → Events → Transactions
 *
 * Tests:
 * 1. Events generated from source table inserts
 * 2. Transaction structure, entries, ordering, back-references
 * 3. Charged amount computation
 * 4. effectiveAtMillis, indexes, txnId derivation
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPaymentsSchema } from "../index";
import type {
  TransactionRow,
} from "../types";
import { createTestDb, jsonbExpr } from "./test-helpers";

describe.sequential("payments schema phase 1 (real postgres)", () => {
  const db = createTestDb();
  const { runStatements, readRows } = db;
  const schema = createPaymentsSchema();

  const allRowsQuery = (table: { listRowsInGroup: (opts: any) => any }) =>
    table.listRowsInGroup({ start: "start", end: "end", startInclusive: true, endInclusive: true });

  const getRowDatas = async (table: { listRowsInGroup: (opts: any) => any }) => {
    const rows = await readRows(allRowsQuery(table));
    return rows.map((r: any) => r.rowdata);
  };

  beforeAll(async () => {
    await db.setup();
    for (const table of schema._allPhase1And2Tables) {
      await runStatements(table.init());
    }
  });

  afterAll(async () => {
    await db.teardown();
  });


  // ============================================================
  // 1. Events from source table inserts
  // ============================================================

  describe("subscription-renewal events (LeftJoin: invoices × subscriptions)", () => {
    it("should generate renewal event from subscription + non-creation invoice", async () => {
      await runStatements(schema.subscriptions.setRow("sub-r1", jsonbExpr({
        id: "sub-r1",
        tenancyId: "t1",
        customerId: "u1",
        customerType: "user",
        productId: "prod-basic",
        priceId: "price-monthly",
        product: {
          displayName: "Basic",
          customerType: "user",
          productLineId: "line-1",
          prices: { "price-monthly": { USD: "9.99", interval: [1, "month"] } },
          includedItems: {},
        },
        quantity: 1,
        stripeSubscriptionId: "stripe-sub-r1",
        status: "active",
        currentPeriodStartMillis: 1000,
        currentPeriodEndMillis: 2000,
        cancelAtPeriodEnd: false,
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 1000,
      })));

      await runStatements(schema.subscriptionInvoices.setRow("inv-r1", jsonbExpr({
        id: "inv-r1",
        tenancyId: "t1",
        stripeSubscriptionId: "stripe-sub-r1",
        stripeInvoiceId: "stripe-inv-r1",
        isSubscriptionCreationInvoice: false,
        status: "paid",
        amountTotal: 999,
        hostedInvoiceUrl: null,
        createdAtMillis: 1500,
      })));

      const events = await getRowDatas(schema.subscriptionRenewalEvents);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        subscriptionId: "sub-r1",
        invoiceId: "inv-r1",
        customerType: "user",
        customerId: "u1",
        paymentProvider: "stripe",
        effectiveAtMillis: 1500,
        createdAtMillis: 1500,
      });
    });

    it("should NOT generate renewal event for creation invoices", async () => {
      await runStatements(schema.subscriptionInvoices.setRow("inv-creation", jsonbExpr({
        id: "inv-creation",
        tenancyId: "t1",
        stripeSubscriptionId: "stripe-sub-r1",
        stripeInvoiceId: "stripe-inv-creation",
        isSubscriptionCreationInvoice: true,
        status: "paid",
        amountTotal: 999,
        hostedInvoiceUrl: null,
        createdAtMillis: 1000,
      })));

      const events = await getRowDatas(schema.subscriptionRenewalEvents);
      expect(events).toHaveLength(1);
      expect(events[0].invoiceId).toBe("inv-r1");
    });

    it("should compute chargedAmount from product price × quantity", async () => {
      const events = await getRowDatas(schema.subscriptionRenewalEvents);
      expect(events[0].chargedAmount).toMatchObject({ USD: "9.99" });
    });
  });


  describe("subscription-cancel events (Filter + Map from subscriptions)", () => {
    it("should generate cancel event for active subscription with cancelAtPeriodEnd", async () => {
      await runStatements(schema.subscriptions.setRow("sub-c1", jsonbExpr({
        id: "sub-c1",
        tenancyId: "t1",
        customerId: "u2",
        customerType: "user",
        productId: "prod-basic",
        priceId: "price-monthly",
        product: {
          displayName: "Basic",
          customerType: "user",
          prices: { "price-monthly": { USD: "9.99" } },
          includedItems: {},
        },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "active",
        currentPeriodStartMillis: 1000,
        currentPeriodEndMillis: 2000,
        cancelAtPeriodEnd: true,
        refundedAtMillis: null,
        creationSource: "TEST_MODE",
        createdAtMillis: 1000,
      })));

      const events = await getRowDatas(schema.subscriptionCancelEvents);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        subscriptionId: "sub-c1",
        changeType: "cancel",
        paymentProvider: "test_mode",
      });
    });

    it("should NOT generate cancel event for already-canceled subscription", async () => {
      await runStatements(schema.subscriptions.setRow("sub-c2", jsonbExpr({
        id: "sub-c2",
        tenancyId: "t1",
        customerId: "u3",
        customerType: "user",
        productId: null,
        priceId: null,
        product: { displayName: "X", customerType: "user", prices: {}, includedItems: {} },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "canceled",
        currentPeriodStartMillis: 1000,
        currentPeriodEndMillis: 2000,
        cancelAtPeriodEnd: true,
        refundedAtMillis: null,
        creationSource: "TEST_MODE",
        createdAtMillis: 1000,
      })));

      const events = await getRowDatas(schema.subscriptionCancelEvents);
      expect(events).toHaveLength(1);
    });

    it("should NOT generate cancel event when cancelAtPeriodEnd is false", async () => {
      await runStatements(schema.subscriptions.setRow("sub-c3", jsonbExpr({
        id: "sub-c3",
        tenancyId: "t1",
        customerId: "u4",
        customerType: "user",
        productId: null,
        priceId: null,
        product: { displayName: "X", customerType: "user", prices: {}, includedItems: {} },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "active",
        currentPeriodStartMillis: 1000,
        currentPeriodEndMillis: 2000,
        cancelAtPeriodEnd: false,
        refundedAtMillis: null,
        creationSource: "TEST_MODE",
        createdAtMillis: 1000,
      })));

      const events = await getRowDatas(schema.subscriptionCancelEvents);
      expect(events).toHaveLength(1);
    });
  });


  describe("one-time-purchase events (Map from OTP StoredTable)", () => {
    it("should generate OTP event with computed fields", async () => {
      await runStatements(schema.oneTimePurchases.setRow("otp-1", jsonbExpr({
        id: "otp-1",
        tenancyId: "t1",
        customerId: "u1",
        customerType: "user",
        productId: "prod-coins",
        priceId: "price-coins",
        product: {
          displayName: "Coin Pack",
          customerType: "user",
          productLineId: "line-coins",
          prices: { "price-coins": { USD: "4.99" } },
          includedItems: {
            coins: { quantity: 100, expires: "never" },
            bonus: { quantity: 5, expires: "when-purchase-expires" },
          },
        },
        quantity: 2,
        stripePaymentIntentId: "pi-1",
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 3000,
      })));

      const events = await getRowDatas(schema.oneTimePurchaseEvents);
      expect(events).toHaveLength(1);

      const event = events[0];
      expect(event.purchaseId).toBe("otp-1");
      expect(event.productLineId).toBe("line-coins");
      expect(event.chargedAmount).toMatchObject({ USD: "9.98" });
      expect(event.paymentProvider).toBe("stripe");
      expect(event.effectiveAtMillis).toBe(3000);

      const grants = event.itemGrants as any[];
      expect(grants).toHaveLength(2);
      const coinsGrant = grants.find((g: any) => g.itemId === "coins");
      const bonusGrant = grants.find((g: any) => g.itemId === "bonus");
      expect(coinsGrant).toMatchObject({ quantity: 200, expiresWhen: null });
      expect(bonusGrant).toMatchObject({ quantity: 10, expiresWhen: "when-purchase-expires" });
    });

    it("should NOT generate event for refunded OTP", async () => {
      await runStatements(schema.oneTimePurchases.setRow("otp-refunded", jsonbExpr({
        id: "otp-refunded",
        tenancyId: "t1",
        customerId: "u1",
        customerType: "user",
        productId: "prod-coins",
        priceId: "price-coins",
        product: {
          displayName: "Coin Pack",
          customerType: "user",
          prices: { "price-coins": { USD: "4.99" } },
          includedItems: {},
        },
        quantity: 1,
        stripePaymentIntentId: "pi-refunded",
        refundedAtMillis: 5000,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 3000,
      })));

      const events = await getRowDatas(schema.oneTimePurchaseEvents);
      expect(events).toHaveLength(1);
      expect(events[0].purchaseId).toBe("otp-1");
    });
  });


  describe("manual-item-quantity-change events (Map from ManualItemQuantityChanges)", () => {
    it("should map through all fields correctly", async () => {
      await runStatements(schema.manualItemQuantityChanges.setRow("iqc-1", jsonbExpr({
        id: "iqc-1",
        tenancyId: "t1",
        customerId: "u1",
        customerType: "user",
        itemId: "credits",
        quantity: -5,
        description: "Used 5 credits",
        expiresAtMillis: null,
        paymentProvider: "stripe",
        createdAtMillis: 4000,
      })));

      const events = await getRowDatas(schema.manualItemQuantityChangeEvents);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        changeId: "iqc-1",
        itemId: "credits",
        quantity: -5,
        paymentProvider: "stripe",
        effectiveAtMillis: 4000,
        createdAtMillis: 4000,
      });
    });
  });


  // TODO: TimeFold event tests (subscription-start, subscription-end, item-grant-repeat)
  // These will be testable once declareTimeFoldTable is available.
  // For now, we test the transaction mapping by populating the stubs directly.


  // ============================================================
  // 2. Event → Transaction mapping
  // ============================================================

  describe("subscription-renewal transaction", () => {
    it("should produce correct txnId, type, and money-transfer entry", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-renewal");
      expect(txns).toHaveLength(1);

      const txn = txns[0] as TransactionRow;
      expect(txn.txnId).toBe("sub-renewal:inv-r1");
      expect(txn.effectiveAtMillis).toBe(1500);
      expect(txn.paymentProvider).toBe("stripe");
      expect(txn.entries).toHaveLength(1);
      expect(txn.entries[0]).toMatchObject({
        type: "money-transfer",
        customerType: "user",
        customerId: "u1",
        chargedAmount: { USD: "9.99" },
      });
    });
  });


  describe("subscription-cancel transaction", () => {
    it("should produce correct active-subscription-change entry", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-cancel");
      expect(txns).toHaveLength(1);

      const txn = txns[0] as TransactionRow;
      expect(txn.txnId).toBe("sub-cancel:sub-c1");
      expect(txn.entries).toHaveLength(1);
      expect(txn.entries[0]).toMatchObject({
        type: "active-subscription-change",
        subscriptionId: "sub-c1",
        changeType: "cancel",
      });
    });
  });


  describe("subscription-start transaction (via stub)", () => {
    beforeAll(async () => {
      await runStatements(schema._timeFoldStubs.subscriptionStartEvents.setRow("start-A", jsonbExpr({
        subscriptionId: "sub-A",
        tenancyId: "t1",
        customerId: "u10",
        customerType: "user",
        productId: "prod-pro",
        product: {
          displayName: "Pro Plan",
          customerType: "user",
          productLineId: "line-1",
          prices: { "price-1": { USD: "29.99" } },
          includedItems: { credits: { quantity: 500 } },
        },
        productLineId: "line-1",
        priceId: "price-1",
        quantity: 1,
        chargedAmount: { USD: "29.99" },
        itemGrants: [
          { itemId: "credits", quantity: 500, expiresWhen: null },
          { itemId: "bonus", quantity: 10, expiresWhen: "when-purchase-expires" },
        ],
        paymentProvider: "stripe",
        effectiveAtMillis: 500,
        createdAtMillis: 500,
      })));

      await runStatements(schema._timeFoldStubs.subscriptionStartEvents.setRow("start-B", jsonbExpr({
        subscriptionId: "sub-B",
        tenancyId: "t1",
        customerId: "u10",
        customerType: "user",
        productId: "prod-basic",
        product: {
          displayName: "Basic Plan",
          customerType: "user",
          productLineId: "line-1",
          prices: { "price-basic": { USD: "9.99" } },
          includedItems: { credits: { quantity: 100 } },
        },
        productLineId: "line-1",
        priceId: "price-basic",
        quantity: 1,
        chargedAmount: { USD: "9.99" },
        itemGrants: [{ itemId: "credits", quantity: 100, expiresWhen: null }],
        paymentProvider: "test_mode",
        effectiveAtMillis: 600,
        createdAtMillis: 600,
      })));
    });

    it("should produce transactions for both subscriptions with correct entry ordering", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-start") as TransactionRow[];
      expect(txns).toHaveLength(2);

      const txnA = txns.find(t => t.txnId === "sub-start:sub-A")!;
      expect(txnA).toBeDefined();

      const entryTypes = txnA.entries.map(e => e.type);
      expect(entryTypes[0]).toBe("active-subscription-start");
      expect(entryTypes[1]).toBe("product-grant");
      expect(entryTypes[2]).toBe("money-transfer");
      expect(entryTypes[3]).toBe("item-quantity-change");
      expect(entryTypes[4]).toBe("item-quantity-change");
      expect(txnA.entries).toHaveLength(5);
    });

    it("should set correct fields on product-grant entry", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-start") as TransactionRow[];
      const txnA = txns.find(t => t.txnId === "sub-start:sub-A")!;

      const productGrant = txnA.entries[1];
      expect(productGrant).toMatchObject({
        type: "product-grant",
        productId: "prod-pro",
        productLineId: "line-1",
        quantity: 1,
        subscriptionId: "sub-A",
      });
    });

    it("should set expiresWhen on item-quantity-change entries", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-start") as TransactionRow[];
      const txnA = txns.find(t => t.txnId === "sub-start:sub-A")!;

      const itemChanges = txnA.entries.filter(e => e.type === "item-quantity-change");
      expect(itemChanges).toHaveLength(2);

      const creditsChange = itemChanges.find((e: any) => e.itemId === "credits");
      const bonusChange = itemChanges.find((e: any) => e.itemId === "bonus");
      expect((creditsChange as any).expiresWhen).toBeNull();
      expect((bonusChange as any).expiresWhen).toBe("when-purchase-expires");
    });

    it("should omit money-transfer for test_mode subscription", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-start") as TransactionRow[];
      const txnB = txns.find(t => t.txnId === "sub-start:sub-B")!;

      const entryTypes = txnB.entries.map(e => e.type);
      expect(entryTypes).not.toContain("money-transfer");
    });
  });


  describe("subscription-end transaction (via stub)", () => {
    beforeAll(async () => {
      await runStatements(schema._timeFoldStubs.subscriptionEndEvents.setRow("end-A", jsonbExpr({
        subscriptionId: "sub-A",
        tenancyId: "t1",
        customerId: "u10",
        customerType: "user",
        productId: "prod-pro",
        productLineId: "line-1",
        quantity: 1,
        startProductGrantRef: { transactionId: "sub-start:sub-A", entryIndex: 1 },
        itemQuantityChangesToExpire: [
          { transactionId: "sub-start:sub-A", entryIndex: 3, itemId: "credits", quantity: 500 },
          { transactionId: "sub-start:sub-A", entryIndex: 4, itemId: "bonus", quantity: 10 },
        ],
        paymentProvider: "stripe",
        effectiveAtMillis: 2000,
        createdAtMillis: 2000,
      })));
    });

    it("should produce product-revocation pointing at the correct product-grant", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-end") as TransactionRow[];
      expect(txns).toHaveLength(1);

      const txn = txns[0];
      expect(txn.txnId).toBe("sub-end:sub-A");

      const revocation = txn.entries.find(e => e.type === "product-revocation") as any;
      expect(revocation).toBeDefined();
      expect(revocation.adjustedTransactionId).toBe("sub-start:sub-A");
      expect(revocation.adjustedEntryIndex).toBe(1);
      expect(revocation.productId).toBe("prod-pro");
      expect(revocation.productLineId).toBe("line-1");
    });

    it("should produce item-quantity-expire entries pointing at correct item-quantity-changes", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-end") as TransactionRow[];
      const txn = txns[0];

      const expires = txn.entries.filter(e => e.type === "item-quantity-expire") as any[];
      expect(expires).toHaveLength(2);

      const creditsExpire = expires.find(e => e.itemId === "credits");
      expect(creditsExpire).toMatchObject({
        adjustedTransactionId: "sub-start:sub-A",
        adjustedEntryIndex: 3,
        quantity: 500,
      });

      const bonusExpire = expires.find(e => e.itemId === "bonus");
      expect(bonusExpire).toMatchObject({
        adjustedTransactionId: "sub-start:sub-A",
        adjustedEntryIndex: 4,
        quantity: 10,
      });
    });

    it("should have correct entry ordering: [active-subscription-end, product-revocation, ...item-quantity-expire]", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-end") as TransactionRow[];
      const txn = txns[0];

      expect(txn.entries[0].type).toBe("active-subscription-end");
      expect(txn.entries[1].type).toBe("product-revocation");
      expect(txn.entries[2].type).toBe("item-quantity-expire");
      expect(txn.entries[3].type).toBe("item-quantity-expire");
    });
  });


  describe("item-grant-repeat transaction (via stub)", () => {
    beforeAll(async () => {
      await runStatements(schema._timeFoldStubs.itemGrantRepeatFromSubscriptions.setRow("igr-1", jsonbExpr({
        sourceType: "subscription",
        sourceId: "sub-A",
        tenancyId: "t1",
        customerId: "u10",
        customerType: "user",
        itemGrants: [{ itemId: "credits", quantity: 500, expiresWhen: "when-repeated" }],
        previousGrantsToExpire: [
          { transactionId: "sub-start:sub-A", entryIndex: 3, itemId: "credits", quantity: 500 },
        ],
        paymentProvider: "stripe",
        effectiveAtMillis: 1000,
        createdAtMillis: 1000,
      })));
    });

    it("should expire previous grants before adding new ones", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "item-grant-repeat") as TransactionRow[];
      expect(txns).toHaveLength(1);

      const txn = txns[0];
      expect(txn.txnId).toBe("igr:sub-A:1000");

      const entryTypes = txn.entries.map(e => e.type);
      expect(entryTypes[0]).toBe("item-quantity-expire");
      expect(entryTypes[1]).toBe("item-quantity-change");

      const expire = txn.entries[0] as any;
      expect(expire.adjustedTransactionId).toBe("sub-start:sub-A");
      expect(expire.adjustedEntryIndex).toBe(3);

      const change = txn.entries[1] as any;
      expect(change.itemId).toBe("credits");
      expect(change.quantity).toBe(500);
      expect(change.expiresWhen).toBe("when-repeated");
    });
  });


  describe("one-time-purchase transaction", () => {
    it("should produce correct entry structure with productLineId", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "one-time-purchase") as TransactionRow[];
      expect(txns).toHaveLength(1);

      const txn = txns[0];
      expect(txn.txnId).toBe("otp:otp-1");
      expect(txn.effectiveAtMillis).toBe(3000);
      expect(txn.paymentProvider).toBe("stripe");

      expect(txn.entries[0].type).toBe("product-grant");
      const grant = txn.entries[0] as any;
      expect(grant.productId).toBe("prod-coins");
      expect(grant.productLineId).toBe("line-coins");
      expect(grant.oneTimePurchaseId).toBe("otp-1");

      expect(txn.entries[1].type).toBe("money-transfer");
      expect((txn.entries[1] as any).chargedAmount).toMatchObject({ USD: "9.98" });

      const itemChanges = txn.entries.filter(e => e.type === "item-quantity-change");
      expect(itemChanges).toHaveLength(2);
    });

    it("should set expiresWhen on OTP item-quantity-change entries from product config", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "one-time-purchase") as TransactionRow[];
      const txn = txns[0];

      const itemChanges = txn.entries.filter(e => e.type === "item-quantity-change") as any[];
      const coinsChange = itemChanges.find(e => e.itemId === "coins");
      const bonusChange = itemChanges.find(e => e.itemId === "bonus");

      expect(coinsChange.expiresWhen).toBeNull();
      expect(bonusChange.expiresWhen).toBe("when-purchase-expires");
      expect(coinsChange.quantity).toBe(200);
      expect(bonusChange.quantity).toBe(10);
    });
  });


  describe("manual-item-quantity-change transaction", () => {
    it("should produce single item-quantity-change entry with expiresWhen: null", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "manual-item-quantity-change") as TransactionRow[];
      expect(txns).toHaveLength(1);

      const txn = txns[0];
      expect(txn.txnId).toBe("miqc:iqc-1");
      expect(txn.effectiveAtMillis).toBe(4000);
      expect(txn.entries).toHaveLength(1);

      const entry = txn.entries[0] as any;
      expect(entry).toMatchObject({
        type: "item-quantity-change",
        itemId: "credits",
        quantity: -5,
        expiresWhen: null,
      });
    });
  });


  describe("refund transaction (ManualTransactions pass-through)", () => {
    beforeAll(async () => {
      await runStatements(schema.manualTransactions.setRow("refund-1", jsonbExpr({
        txnId: "refund-001",
        tenancyId: "t1",
        effectiveAtMillis: 5000,
        type: "refund",
        entries: [
          { type: "money-transfer", customerType: "user", customerId: "u1", chargedAmount: { USD: "-9.99" } },
        ],
        customerType: "user",
        customerId: "u1",
        paymentProvider: "stripe",
        createdAtMillis: 5000,
      })));
    });

    it("should appear in transactions table unchanged", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "refund") as TransactionRow[];
      expect(txns).toHaveLength(1);
      expect(txns[0].txnId).toBe("refund-001");
      expect(txns[0].entries).toHaveLength(1);
      expect((txns[0].entries[0] as any).chargedAmount.USD).toBe("-9.99");
    });

    it("should NOT pass through non-refund manual transactions", async () => {
      await runStatements(schema.manualTransactions.setRow("non-refund", jsonbExpr({
        txnId: "other-001",
        tenancyId: "t1",
        effectiveAtMillis: 6000,
        type: "subscription-start",
        entries: [],
        customerType: "user",
        customerId: "u1",
        paymentProvider: "test_mode",
        createdAtMillis: 6000,
      })));

      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId === "other-001");
      expect(txns).toHaveLength(0);
    });
  });


  // ============================================================
  // 3. Charged amount computation
  // ============================================================

  describe("charged amount edge cases", () => {
    it("should multiply price by quantity for multi-quantity OTP", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "one-time-purchase") as TransactionRow[];

      const moneyEntry = txns[0].entries.find(e => e.type === "money-transfer") as any;
      expect(moneyEntry.chargedAmount.USD).toBe("9.98");
    });

    it("should omit money-transfer when chargedAmount is empty (test_mode)", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-start") as TransactionRow[];
      const txnB = txns.find(t => t.txnId === "sub-start:sub-B")!;

      expect(txnB.entries.some(e => e.type === "money-transfer")).toBe(false);
    });
  });


  // ============================================================
  // 4. txnId, effectiveAtMillis, indexes
  // ============================================================

  describe("txnId derivation", () => {
    it("should use correct prefixes", async () => {
      const txns = await getRowDatas(schema.transactions);
      const txnIds = txns.map((t: any) => t.txnId);

      expect(txnIds).toContain("sub-renewal:inv-r1");
      expect(txnIds).toContain("sub-cancel:sub-c1");
      expect(txnIds).toContain("sub-start:sub-A");
      expect(txnIds).toContain("sub-start:sub-B");
      expect(txnIds).toContain("sub-end:sub-A");
      expect(txnIds).toContain("igr:sub-A:1000");
      expect(txnIds).toContain("otp:otp-1");
      expect(txnIds).toContain("miqc:iqc-1");
      expect(txnIds).toContain("refund-001");
    });
  });

  describe("effectiveAtMillis correctness", () => {
    it("subscription-renewal effectiveAt should come from invoice createdAt", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-renewal") as TransactionRow[];
      expect(txns[0].effectiveAtMillis).toBe(1500);
    });

    it("OTP effectiveAt should come from purchase createdAt", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "one-time-purchase") as TransactionRow[];
      expect(txns[0].effectiveAtMillis).toBe(3000);
    });

    it("manual change effectiveAt should come from change createdAt", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "manual-item-quantity-change") as TransactionRow[];
      expect(txns[0].effectiveAtMillis).toBe(4000);
    });
  });
});
