/**
 * Phase 2 tests: Transactions → TransactionEntries → CompactedTransactionEntries
 *
 * Tests:
 * 1. FlatMap correctness: entries get parent txn metadata + correct index
 * 2. Filter by type: each entry type lands in the right filtered table
 * 3. Compaction: compactable entries (expiresWhen=null) are merged between expire boundaries
 * 4. Non-compactable entries pass through unchanged
 * 5. All other entry types pass through unchanged
 * 6. Compacted entries get type "compacted-item-quantity-change"
 *
 * Data is populated via subscriptions stored table (TimeFold generates events)
 * and manual item quantity changes.
 */

import { describe, beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { createBulldozerExecutionContext, type BulldozerExecutionContext } from "@/lib/bulldozer/db/index";
import { createPaymentsSchema } from "../index";
import { createTestDb, jsonbExpr } from "./test-helpers";

const MONTH_MS = 2592000000;

describe.sequential("payments schema phase 2 (real postgres)", () => {
  const db = createTestDb();
  const { runStatements, readRows } = db;
  const schema = createPaymentsSchema();
  let executionContext = createBulldozerExecutionContext();

  const getRowDatas = async (table: { listRowsInGroup: (ctx: BulldozerExecutionContext, opts: any) => any }) => {
    const rows = await readRows(table.listRowsInGroup(executionContext, { start: "start", end: "end", startInclusive: true, endInclusive: true }));
    return rows.map((r: any) => r.rowdata);
  };

  beforeEach(() => {
    executionContext = createBulldozerExecutionContext();
  });

  beforeAll(async () => {
    await db.setup();
    for (const table of schema._allPhase1And2Tables) {
      await runStatements(table.init(executionContext));
    }

    // Subscription with 2 items: credits (compactable, expiresWhen=null)
    // and bonus (non-compactable, expiresWhen="when-purchase-expires").
    // endedAt is set so we get a subscription-end event (creates expire boundary).
    await runStatements(schema.subscriptions.setRow(executionContext, "sub-p2", jsonbExpr({
      id: "sub-p2",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      productId: "prod-1",
      priceId: "p1",
      product: {
        displayName: "Plan",
        customerType: "user",
        productLineId: "line-1",
        prices: { p1: { USD: "10" } },
        includedItems: {
          credits: { quantity: 100, expires: "never" },
          bonus: { quantity: 10, expires: "when-purchase-expires" },
        },
      },
      quantity: 1,
      stripeSubscriptionId: null,
      status: "active",
      currentPeriodStartMillis: 1000,
      currentPeriodEndMillis: 1000 + MONTH_MS,
      cancelAtPeriodEnd: false,
      canceledAtMillis: null,
      endedAtMillis: 4000,
      refundedAtMillis: null,
      creationSource: "PURCHASE_PAGE",
      createdAtMillis: 1000,
    })));

    // Manual item changes (compactable, expiresWhen=null) before the expire boundary
    await runStatements(schema.manualItemQuantityChanges.setRow(executionContext, "iqc-p2-1", jsonbExpr({
      id: "iqc-p2-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      itemId: "credits",
      quantity: -5,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 2000,
    })));

    await runStatements(schema.manualItemQuantityChanges.setRow(executionContext, "iqc-p2-2", jsonbExpr({
      id: "iqc-p2-2",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      itemId: "credits",
      quantity: -3,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 3000,
    })));

    // Another manual change after the expiry boundary (t=4000)
    await runStatements(schema.manualItemQuantityChanges.setRow(executionContext, "iqc-p2-3", jsonbExpr({
      id: "iqc-p2-3",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      itemId: "credits",
      quantity: 50,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 5000,
    })));
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });


  // ============================================================
  // 1. FlatMap: entries get parent txn metadata + index
  // ============================================================

  describe("FlatMap transactions → entries", () => {
    it("should produce individual entries with parent txn metadata and correct indexes", async () => {
      const entries = await getRowDatas(schema.transactionEntries);
      const startEntries = entries.filter((e: any) => e.txnId === "sub-start:sub-p2");

      expect(startEntries.length).toBeGreaterThanOrEqual(4);
      expect(startEntries[0].txnType).toBe("subscription-start");
      expect(startEntries[0].tenancyId).toBe("t1");
      expect(startEntries[0].paymentProvider).toBe("stripe");
      expect(startEntries[0].txnEffectiveAtMillis).toBe(1000);

      const indexes = startEntries.map((e: any) => e.index).sort((a: number, b: number) => a - b);
      expect(indexes[0]).toBe(0);
      expect(indexes[1]).toBe(1);
    });
  });


  // ============================================================
  // 2. Filter by type
  // ============================================================

  describe("entry type filtering", () => {
    it("should separate product-grant entries", async () => {
      const grants = await getRowDatas(schema.productGrantEntries);
      expect(grants.length).toBeGreaterThanOrEqual(1);
      expect(grants.every((e: any) => e.type === "product-grant")).toBe(true);
    });

    it("should separate product-revocation entries", async () => {
      const revocations = await getRowDatas(schema.productRevocationEntries);
      expect(revocations.length).toBeGreaterThanOrEqual(1);
      expect(revocations.every((e: any) => e.type === "product-revocation")).toBe(true);
    });

    it("should separate item-quantity-expire entries", async () => {
      const expires = await getRowDatas(schema.itemQuantityExpireEntries);
      expect(expires.length).toBeGreaterThanOrEqual(1);
      expect(expires.every((e: any) => e.type === "item-quantity-expire")).toBe(true);
    });

    it("should separate item-quantity-change entries", async () => {
      const changes = await getRowDatas(schema.allItemQuantityChangeEntries);
      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes.every((e: any) => e.type === "item-quantity-change")).toBe(true);
    });
  });


  // ============================================================
  // 3. Compaction
  // ============================================================

  describe("compaction of item-quantity-change entries", () => {
    it("should compact consecutive compactable entries between expire boundaries", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const compactedChanges = compacted.filter((e: any) => e.type === "compacted-item-quantity-change");

      // credits: +100 from sub-start (t=1000), -5 manual (t=2000), -3 manual (t=3000), +50 manual (t=5000)
      // Expire boundary at t=4000 (subscription-end expires bonus)
      // Window 1 (before t=4000): 100 + (-5) + (-3) = 92
      // Window 2 (after t=4000): 50
      const creditsCompacted = compactedChanges.filter((e: any) => e.itemId === "credits");
      expect(creditsCompacted).toHaveLength(2);

      const sorted = creditsCompacted.sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);
      expect(sorted[0].quantity).toBe(92);
      expect(sorted[1].quantity).toBe(50);
    });

    it("should set type to 'compacted-item-quantity-change' on compacted rows", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const compactedChanges = compacted.filter((e: any) => e.type === "compacted-item-quantity-change");
      expect(compactedChanges.length).toBeGreaterThan(0);
      for (const entry of compactedChanges) {
        expect(entry.type).toBe("compacted-item-quantity-change");
      }
    });

    it("should preserve first row's txnEffectiveAtMillis in compacted entry", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const creditsCompacted = compacted
        .filter((e: any) => e.type === "compacted-item-quantity-change" && e.itemId === "credits")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      expect(creditsCompacted[0].txnEffectiveAtMillis).toBe(1000);
    });
  });


  // ============================================================
  // 4. Non-compactable entries pass through
  // ============================================================

  describe("non-compactable entries", () => {
    it("should pass through item-quantity-change entries with expiresWhen != null as non-compactable", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const bonusChanges = compacted.filter((e: any) =>
        e.type === "item-quantity-change" && e.itemId === "bonus"
      );
      expect(bonusChanges).toHaveLength(1);
      expect(bonusChanges[0].quantity).toBe(10);
      expect(bonusChanges[0].expiresWhen).toBe("when-purchase-expires");
    });
  });


  // ============================================================
  // 5. Other entry types pass through unchanged
  // ============================================================

  describe("passthrough entry types", () => {
    it("should include active-subscription-start entries unchanged", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const starts = compacted.filter((e: any) => e.type === "active-subscription-start");
      expect(starts).toHaveLength(1);
      expect(starts[0].subscriptionId).toBe("sub-p2");
    });

    it("should include product-grant entries unchanged", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const grants = compacted.filter((e: any) => e.type === "product-grant");
      expect(grants).toHaveLength(1);
      expect(grants[0].productId).toBe("prod-1");
    });

    it("should include money-transfer entries unchanged", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const transfers = compacted.filter((e: any) => e.type === "money-transfer");
      expect(transfers).toHaveLength(1);
      expect(transfers[0].chargedAmount).toMatchObject({ USD: "10" });
    });

    it("should include item-quantity-expire entries unchanged", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const expires = compacted.filter((e: any) => e.type === "item-quantity-expire");
      expect(expires.length).toBeGreaterThanOrEqual(1);
      const bonusExpire = expires.find((e: any) => e.itemId === "bonus");
      expect(bonusExpire).toBeDefined();
    });

    it("should include active-subscription-end entries unchanged", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const ends = compacted.filter((e: any) => e.type === "active-subscription-end");
      expect(ends).toHaveLength(1);
      expect(ends[0].subscriptionId).toBe("sub-p2");
    });

    it("should include product-revocation entries unchanged", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const revocations = compacted.filter((e: any) => e.type === "product-revocation");
      expect(revocations).toHaveLength(1);
      expect(revocations[0].adjustedTransactionId).toBe("sub-start:sub-p2");
    });
  });


  // ============================================================
  // 6. Total entry count sanity check
  // ============================================================

  describe("overall compacted entries integrity", () => {
    it("should have all expected entry types in the final table", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const types = new Set(compacted.map((e: any) => e.type));

      expect(types).toContain("active-subscription-start");
      expect(types).toContain("active-subscription-end");
      expect(types).toContain("product-grant");
      expect(types).toContain("product-revocation");
      expect(types).toContain("money-transfer");
      expect(types).toContain("item-quantity-expire");
      expect(types).toContain("item-quantity-change");
      expect(types).toContain("compacted-item-quantity-change");
    });

    it("should not contain any raw compactable item-quantity-change entries (they should be compacted)", async () => {
      const compacted = await getRowDatas(schema.compactedTransactionEntries);
      const rawCompactable = compacted.filter((e: any) =>
        e.type === "item-quantity-change"
        && (e.expiresWhen == null || e.expiresWhen === "null")
      );
      expect(rawCompactable).toHaveLength(0);
    });
  });
});
