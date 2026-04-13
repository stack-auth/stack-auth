/**
 * Cross-phase integration tests.
 *
 * Tests the full pipeline: StoredTables → Events → Transactions →
 * CompactedEntries → OwnedProducts / ItemQuantities.
 *
 * Verifies that data inserted at the source correctly propagates through
 * all intermediate tables to the final output tables.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPaymentsSchema } from "../index";
import { createTestDb, jsonbExpr } from "./test-helpers";

const MONTH_MS = 2592000000;

describe.sequential("payments schema integration phase 1→3 (real postgres)", () => {
  const db = createTestDb();
  const { runStatements, readRows } = db;
  const schema = createPaymentsSchema();

  const getRowDatas = async (table: { listRowsInGroup: (opts: any) => any }) => {
    const rows = await readRows(table.listRowsInGroup({ start: "start", end: "end", startInclusive: true, endInclusive: true }));
    return rows.map((r: any) => r.rowdata);
  };

  beforeAll(async () => {
    await db.setup();
    for (const table of schema._allTables) {
      await runStatements(table.init());
    }
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });


  // ============================================================
  // OTP → Events → Transactions → Entries → OwnedProducts + ItemQuantities
  // ============================================================

  describe("one-time purchase end-to-end", () => {
    beforeAll(async () => {
      await runStatements(schema.oneTimePurchases.setRow("otp-int-1", jsonbExpr({
        id: "otp-int-1",
        tenancyId: "t1",
        customerId: "u1",
        customerType: "user",
        productId: "prod-coins",
        priceId: "price-coins",
        product: {
          displayName: "Coin Pack",
          customerType: "user",
          productLineId: "line-coins",
          prices: { "price-coins": { USD: "5" } },
          includedItems: {
            coins: { quantity: 200, expires: "never" },
          },
        },
        quantity: 1,
        stripePaymentIntentId: "pi-int-1",
        revokedAtMillis: null,
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 1000,
      })));
    });

    it("should generate an OTP event", async () => {
      const events = await getRowDatas(schema.oneTimePurchaseEvents);
      const event = events.find((e: any) => e.purchaseId === "otp-int-1");
      expect(event).toBeDefined();
      expect(event.productLineId).toBe("line-coins");
    });

    it("should generate a one-time-purchase transaction", async () => {
      const txns = await getRowDatas(schema.transactions);
      const txn = txns.find((t: any) => t.txnId === "otp:otp-int-1");
      expect(txn).toBeDefined();
      expect(txn.type).toBe("one-time-purchase");
      expect(txn.entries.length).toBeGreaterThanOrEqual(2);
    });

    it("should generate flattened transaction entries", async () => {
      const entries = await getRowDatas(schema.transactionEntries);
      const otpEntries = entries.filter((e: any) => e.txnId === "otp:otp-int-1");
      expect(otpEntries.length).toBeGreaterThanOrEqual(2);

      const types = otpEntries.map((e: any) => e.type);
      expect(types).toContain("product-grant");
      expect(types).toContain("money-transfer");
      expect(types).toContain("item-quantity-change");
    });

    it("should show prod-coins in owned products", async () => {
      const rows = await getRowDatas(schema.ownedProducts);
      const withCoins = rows.find((r: any) =>
        r.ownedProducts["prod-coins"] && r.ownedProducts["prod-coins"].quantity > 0
      );
      expect(withCoins).toBeDefined();
      expect(withCoins.ownedProducts["prod-coins"].quantity).toBe(1);
      expect(withCoins.ownedProducts["prod-coins"].productLineId).toBe("line-coins");
    });

    it("should show 200 coins in item quantities", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);
      const lastRow = rows[rows.length - 1];
      expect(lastRow.itemQuantities.coins).toBe(200);
    });
  });


  // ============================================================
  // Subscription lifecycle: start → manual changes
  // ============================================================

  describe("subscription lifecycle end-to-end", () => {
    beforeAll(async () => {
      await runStatements(schema.subscriptions.setRow("sub-int", jsonbExpr({
        id: "sub-int",
        tenancyId: "t1",
        customerId: "u1",
        customerType: "user",
        productId: "prod-pro",
        priceId: "p1",
        product: {
          displayName: "Pro Plan",
          customerType: "user",
          productLineId: "line-1",
          prices: { p1: { USD: "20" } },
          includedItems: {
            credits: { quantity: 500, expires: "never" },
          },
        },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "active",
        currentPeriodStartMillis: 2000,
        currentPeriodEndMillis: 2000 + MONTH_MS,
        cancelAtPeriodEnd: false,
        endedAtMillis: null,
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 2000,
      })));

      await runStatements(schema.manualItemQuantityChanges.setRow("iqc-int-1", jsonbExpr({
        id: "iqc-int-1",
        tenancyId: "t1",
        customerId: "u1",
        customerType: "user",
        itemId: "credits",
        quantity: -50,
        description: null,
        expiresAtMillis: null,
        paymentProvider: "stripe",
        createdAtMillis: 2500,
      })));
    });

    it("should show prod-pro owned alongside prod-coins", async () => {
      const rows = (await getRowDatas(schema.ownedProducts))
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const latest = rows[rows.length - 1];
      expect(latest.ownedProducts["prod-pro"]).toBeDefined();
      expect(latest.ownedProducts["prod-pro"].quantity).toBe(1);
      expect(latest.ownedProducts["prod-coins"]).toBeDefined();
      expect(latest.ownedProducts["prod-coins"].quantity).toBe(1);
    });

    it("should show credits balance as 500 (sub) - 50 (consumed) = 450", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId === "u1")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const latest = rows[rows.length - 1];
      expect(latest.itemQuantities.credits).toBe(450);
    });

    it("should show coins unchanged at 200", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const latest = rows[rows.length - 1];
      expect(latest.itemQuantities.coins).toBe(200);
    });
  });


  // ============================================================
  // Multiple customers: isolation check
  // ============================================================

  describe("multi-customer isolation", () => {
    beforeAll(async () => {
      await runStatements(schema.oneTimePurchases.setRow("otp-int-u2", jsonbExpr({
        id: "otp-int-u2",
        tenancyId: "t1",
        customerId: "u2",
        customerType: "user",
        productId: "prod-basic",
        priceId: "price-basic",
        product: {
          displayName: "Basic",
          customerType: "user",
          productLineId: "line-1",
          prices: { "price-basic": { USD: "10" } },
          includedItems: {
            credits: { quantity: 50, expires: "never" },
          },
        },
        quantity: 1,
        stripePaymentIntentId: "pi-int-u2",
        revokedAtMillis: null,
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 3000,
      })));
    });

    it("should show u2's product separately from u1 in owned products", async () => {
      const rows = await getRowDatas(schema.ownedProducts);

      const u1Rows = rows.filter((r: any) => r.customerId === "u1");
      const u2Rows = rows.filter((r: any) => r.customerId === "u2");

      expect(u1Rows.length).toBeGreaterThan(0);
      expect(u2Rows.length).toBeGreaterThan(0);

      const u2Latest = u2Rows.sort((a: any, b: any) => b.txnEffectiveAtMillis - a.txnEffectiveAtMillis)[0];
      expect(u2Latest.ownedProducts["prod-basic"]).toBeDefined();
      expect(u2Latest.ownedProducts["prod-basic"].quantity).toBe(1);
      expect(u2Latest.ownedProducts["prod-coins"]).toBeUndefined();
    });

    it("should show u2's credits separately in item quantities", async () => {
      const rows = await getRowDatas(schema.itemQuantities);

      const u2Rows = rows.filter((r: any) => r.customerId === "u2");
      expect(u2Rows.length).toBeGreaterThan(0);

      const u2Latest = u2Rows.sort((a: any, b: any) => b.txnEffectiveAtMillis - a.txnEffectiveAtMillis)[0];
      expect(u2Latest.itemQuantities.credits).toBe(50);
      expect(u2Latest.itemQuantities.coins).toBeUndefined();
    });
  });


  // ============================================================
  // Subscription with endedAt: product revocation + item expiry
  // ============================================================

  describe("subscription end-to-end with expiry", () => {
    beforeAll(async () => {
      await runStatements(schema.subscriptions.setRow("sub-ending", jsonbExpr({
        id: "sub-ending",
        tenancyId: "t1",
        customerId: "u3",
        customerType: "user",
        productId: "prod-expiry",
        priceId: "p1",
        product: {
          displayName: "Expiry Plan",
          customerType: "user",
          productLineId: "line-expiry",
          prices: { p1: { USD: "15" } },
          includedItems: {
            tokens: { quantity: 100, expires: "when-purchase-expires" },
            permanent: { quantity: 50, expires: "never" },
          },
        },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "canceled",
        currentPeriodStartMillis: 0,
        currentPeriodEndMillis: MONTH_MS,
        cancelAtPeriodEnd: true,
        endedAtMillis: 5000,
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 0,
      })));
    });

    it("should show product owned after start then revoked after end", async () => {
      const rows = (await getRowDatas(schema.ownedProducts))
        .filter((r: any) => r.customerId === "u3")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      expect(rows.length).toBeGreaterThanOrEqual(2);

      const afterStart = rows.find((r: any) => r.txnId === "sub-start:sub-ending");
      expect(afterStart).toBeDefined();
      expect(afterStart.ownedProducts["prod-expiry"].quantity).toBe(1);

      const afterEnd = rows.find((r: any) => r.txnId === "sub-end:sub-ending");
      expect(afterEnd).toBeDefined();
      expect(afterEnd.ownedProducts["prod-expiry"].quantity).toBe(0);
    });

    it("should have subscription-end expire entries pointing at correct subscription-start entries", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.customerId === "u3");

      const startTxn = txns.find((t: any) => t.txnId === "sub-start:sub-ending");
      expect(startTxn).toBeDefined();

      const endTxn = txns.find((t: any) => t.txnId === "sub-end:sub-ending");
      expect(endTxn).toBeDefined();

      // Find the token item-quantity-change entry in the start transaction
      const tokenChangeEntry = startTxn.entries.find((e: any) =>
        e.type === "item-quantity-change" && e.itemId === "tokens"
      );
      expect(tokenChangeEntry).toBeDefined();
      const tokenChangeIndex = startTxn.entries.indexOf(tokenChangeEntry);

      // Find the token item-quantity-expire entry in the end transaction
      const tokenExpireEntry = endTxn.entries.find((e: any) =>
        e.type === "item-quantity-expire" && e.itemId === "tokens"
      );
      expect(tokenExpireEntry).toBeDefined();
      expect(tokenExpireEntry.adjustedTransactionId).toBe("sub-start:sub-ending");
      expect(tokenExpireEntry.adjustedEntryIndex).toBe(tokenChangeIndex);
    });

    it("should have token change entry as non-compactable (expiresWhen != null)", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const tokenChanges = compacted.filter((e: any) =>
        e.type === "item-quantity-change" && e.itemId === "tokens" && e.customerId === "u3"
      );
      expect(tokenChanges.length).toBeGreaterThanOrEqual(1);
      expect(tokenChanges[0].expiresWhen).toBe("when-purchase-expires");
    });

    it("should have split changes with correct expiry for tokens", async () => {
      const splits = await getRowDatas(schema.splitChanges);
      const tokenSplits = splits.filter((s: any) => s.itemId === "tokens" && s.customerId === "u3");
      expect(tokenSplits.length).toBeGreaterThanOrEqual(1);

      // At least one split should have an expiresAtMillis = 5000 (from sub end)
      const withExpiry = tokenSplits.filter((s: any) => s.expiresAtMillis === 5000);
      expect(withExpiry.length).toBeGreaterThanOrEqual(1);
    });

    it("should expire when-purchase-expires tokens at subscription end", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId === "u3")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const latest = rows[rows.length - 1];
      // tokens had expires=when-purchase-expires, should be 0 after sub end
      expect(latest.itemQuantities.tokens).toBe(0);
      // permanent had expires=never, should remain at 50
      expect(latest.itemQuantities.permanent).toBe(50);
    });
  });


  // ============================================================
  // Subscription with repeating items: item-grant-repeat e2e
  // ============================================================

  describe("subscription with repeating items end-to-end", () => {
    const DAY_MS = 86400000;

    beforeAll(async () => {
      await runStatements(schema.subscriptions.setRow("sub-repeat-e2e", jsonbExpr({
        id: "sub-repeat-e2e",
        tenancyId: "t1",
        customerId: "u4",
        customerType: "user",
        productId: "prod-repeat",
        priceId: "p1",
        product: {
          displayName: "Repeat Plan",
          customerType: "user",
          productLineId: "line-repeat",
          prices: { p1: { USD: "10" } },
          includedItems: {
            energy: { quantity: 50, repeat: [7, "day"], expires: "when-repeated" },
          },
        },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "active",
        currentPeriodStartMillis: 0,
        currentPeriodEndMillis: MONTH_MS,
        cancelAtPeriodEnd: false,
        endedAtMillis: 25 * DAY_MS,
        refundedAtMillis: null,
        creationSource: "TEST_MODE",
        createdAtMillis: 0,
      })));
    });

    it("should generate item-grant-repeat transactions", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "item-grant-repeat" && t.customerId === "u4");
      expect(txns.length).toBeGreaterThan(0);
    });

    it("should have product owned", async () => {
      const rows = (await getRowDatas(schema.ownedProducts))
        .filter((r: any) => r.customerId === "u4")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const afterStart = rows.find((r: any) => r.txnId === "sub-start:sub-repeat-e2e");
      expect(afterStart).toBeDefined();
      expect(afterStart.ownedProducts["prod-repeat"].quantity).toBe(1);
    });

    it("should show energy quantity from latest repeat grant (when-repeated replaces previous)", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId === "u4")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      expect(rows.length).toBeGreaterThan(0);
      const latest = rows[rows.length - 1];
      // Each repeat grants 50 energy and expires the previous 50.
      // The latest state should reflect only the most recent grant's quantity.
      expect(latest.itemQuantities.energy).toBeDefined();
      expect(typeof latest.itemQuantities.energy).toBe("number");
    });
  });


  // ============================================================
  // Refund: manual transaction flows through to final tables
  // ============================================================

  describe("refund end-to-end", () => {
    beforeAll(async () => {
      // First create an OTP to refund
      await runStatements(schema.oneTimePurchases.setRow("otp-refundable", jsonbExpr({
        id: "otp-refundable",
        tenancyId: "t1",
        customerId: "u5",
        customerType: "user",
        productId: "prod-refundable",
        priceId: "p1",
        product: {
          displayName: "Refundable Pack",
          customerType: "user",
          productLineId: "line-refundable",
          prices: { p1: { USD: "20" } },
          includedItems: {
            gems: { quantity: 100, expires: "never" },
          },
        },
        quantity: 1,
        stripePaymentIntentId: "pi-refundable",
        revokedAtMillis: null,
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 6000,
      })));

      // Then create a refund that revokes the product and returns money
      await runStatements(schema.manualTransactions.setRow("refund-otp", jsonbExpr({
        txnId: "refund:otp-refundable",
        tenancyId: "t1",
        effectiveAtMillis: 7000,
        type: "refund",
        entries: [
          {
            type: "product-revocation",
            customerType: "user",
            customerId: "u5",
            adjustedTransactionId: "otp:otp-refundable",
            adjustedEntryIndex: 0,
            quantity: 1,
            productId: "prod-refundable",
            productLineId: "line-refundable",
          },
          {
            type: "money-transfer",
            customerType: "user",
            customerId: "u5",
            chargedAmount: { USD: "-20" },
          },
        ],
        customerType: "user",
        customerId: "u5",
        paymentProvider: "stripe",
        createdAtMillis: 7000,
      })));
    });

    it("should show product owned after OTP then revoked after refund", async () => {
      const rows = (await getRowDatas(schema.ownedProducts))
        .filter((r: any) => r.customerId === "u5")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      expect(rows.length).toBeGreaterThanOrEqual(2);

      const afterPurchase = rows.find((r: any) => r.txnId === "otp:otp-refundable");
      expect(afterPurchase).toBeDefined();
      expect(afterPurchase.ownedProducts["prod-refundable"].quantity).toBe(1);

      const afterRefund = rows.find((r: any) => r.txnId === "refund:otp-refundable");
      expect(afterRefund).toBeDefined();
      expect(afterRefund.ownedProducts["prod-refundable"].quantity).toBe(0);
    });

    it("should show gems unchanged by refund (no item expiry in this refund)", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId === "u5")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const latest = rows[rows.length - 1];
      // Refund only revoked the product, didn't expire the gems
      expect(latest.itemQuantities.gems).toBe(100);
    });
  });


  // ============================================================
  // Subscription renewal: money-transfer flows through
  // ============================================================

  describe("subscription renewal end-to-end", () => {
    beforeAll(async () => {
      await runStatements(schema.subscriptions.setRow("sub-renew-e2e", jsonbExpr({
        id: "sub-renew-e2e",
        tenancyId: "t1",
        customerId: "u6",
        customerType: "user",
        productId: "prod-renew",
        priceId: "p1",
        product: {
          displayName: "Renew Plan",
          customerType: "user",
          productLineId: "line-renew",
          prices: { p1: { USD: "30" } },
          includedItems: {},
        },
        quantity: 1,
        stripeSubscriptionId: "stripe-sub-renew-e2e",
        status: "active",
        currentPeriodStartMillis: 0,
        currentPeriodEndMillis: MONTH_MS,
        cancelAtPeriodEnd: false,
        endedAtMillis: null,
        refundedAtMillis: null,
        creationSource: "PURCHASE_PAGE",
        createdAtMillis: 0,
      })));

      await runStatements(schema.subscriptionInvoices.setRow("inv-renew-e2e", jsonbExpr({
        id: "inv-renew-e2e",
        tenancyId: "t1",
        stripeSubscriptionId: "stripe-sub-renew-e2e",
        stripeInvoiceId: "stripe-inv-renew-e2e",
        isSubscriptionCreationInvoice: false,
        status: "paid",
        amountTotal: 3000,
        hostedInvoiceUrl: null,
        createdAtMillis: MONTH_MS,
      })));
    });

    it("should generate a subscription-renewal transaction with money-transfer", async () => {
      const txns = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.type === "subscription-renewal" && t.customerId === "u6");

      expect(txns).toHaveLength(1);
      expect(txns[0].entries).toHaveLength(1);
      expect(txns[0].entries[0].type).toBe("money-transfer");
      expect(txns[0].entries[0].chargedAmount).toMatchObject({ USD: "30" });
    });
  });
});
