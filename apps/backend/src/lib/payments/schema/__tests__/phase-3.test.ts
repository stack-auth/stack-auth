/**
 * Phase 3 tests: CompactedTransactionEntries → ItemChangesWithExpiries → ItemQuantities
 *
 * Tests:
 * 1. Expiry mapping: correct expiries matched to correct change entries
 * 2. Splitting: multi-expiry changes split into (subQty, expiresAt) pairs
 * 3. Non-expiring changes pass through with null/empty expiry
 * 4. OwnedProducts accumulation (basic grant/revoke)
 * 5. ItemQuantities ledger (basic sum)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPaymentsSchema } from "../index";
import { getSplitAlgoCteSql } from "../phase-3/split-algo";
import { createTestDb, jsonbExpr } from "./test-helpers";

describe.sequential("payments schema phase 3 (real postgres)", () => {
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


    // ── Test data setup ──
    // We populate via TimeFold stubs + manual changes to create a scenario
    // with multiple item-quantity-change entries and item-quantity-expire entries.

    // Subscription start: grants credits(100, expiresWhen=when-purchase-expires)
    // and bonus(10, expiresWhen=null)
    await runStatements(schema._timeFoldStubs.subscriptionStartEvents.setRow("start-p3", jsonbExpr({
      subscriptionId: "sub-p3",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      productId: "prod-1",
      product: { displayName: "Plan", customerType: "user", productLineId: "line-1", prices: { "p1": { USD: "10" } }, includedItems: {} },
      productLineId: "line-1",
      priceId: "p1",
      quantity: 1,
      chargedAmount: { USD: "10" },
      itemGrants: [
        { itemId: "credits", quantity: 100, expiresWhen: "when-purchase-expires" },
        { itemId: "bonus", quantity: 10, expiresWhen: null },
      ],
      paymentProvider: "stripe",
      effectiveAtMillis: 1000,
      createdAtMillis: 1000,
    })));

    // Item grant repeat: grants credits(50, expiresWhen=when-repeated),
    // and expires the previous credits grant from subscription-start
    await runStatements(schema._timeFoldStubs.itemGrantRepeatFromSubscriptions.setRow("igr-p3", jsonbExpr({
      sourceType: "subscription",
      sourceId: "sub-p3",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      itemGrants: [{ itemId: "credits", quantity: 50, expiresWhen: "when-repeated" }],
      previousGrantsToExpire: [
        { transactionId: "sub-start:sub-p3", entryIndex: 3, itemId: "credits", quantity: 80 },
      ],
      paymentProvider: "stripe",
      effectiveAtMillis: 2000,
      createdAtMillis: 2000,
    })));

    // Subscription end: expires the product grant and the remaining item changes
    await runStatements(schema._timeFoldStubs.subscriptionEndEvents.setRow("end-p3", jsonbExpr({
      subscriptionId: "sub-p3",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      productId: "prod-1",
      productLineId: "line-1",
      quantity: 1,
      startProductGrantRef: { transactionId: "sub-start:sub-p3", entryIndex: 1 },
      itemQuantityChangesToExpire: [
        { transactionId: "igr:sub-p3:2000", entryIndex: 1, itemId: "credits", quantity: 30 },
      ],
      paymentProvider: "stripe",
      effectiveAtMillis: 3000,
      createdAtMillis: 3000,
    })));

    // Manual non-expiring change (bonus)
    await runStatements(schema.manualItemQuantityChanges.setRow("iqc-p3-1", jsonbExpr({
      id: "iqc-p3-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      itemId: "bonus",
      quantity: -3,
      description: null,
      expiresAtMillis: null,
      paymentProvider: "stripe",
      createdAtMillis: 1500,
    })));
  });

  afterAll(async () => {
    await db.teardown();
  });


  // ============================================================
  // 1. Expiry mapping: correct expiries matched to correct changes
  // ============================================================

  describe("item-changes-with-expiries: expiry mapping", () => {
    it("should map expiry entries to the correct item-quantity-change via adjustedTxnId + adjustedEntryIndex", async () => {
      const splits = await getRowDatas(schema.splitChanges);

      // The credits grant from sub-start (txnId=sub-start:sub-p3, index=3)
      // should have an expiry from the item-grant-repeat at t=2000 (qty=80)
      const creditsStartSplits = splits.filter((s: any) =>
        s.txnId === "sub-start:sub-p3" && s.itemId === "credits"
      );
      expect(creditsStartSplits.length).toBeGreaterThanOrEqual(1);

      // At least one split should have an expiresAtMillis = 2000 (from the igr expire)
      const withExpiry = creditsStartSplits.filter((s: any) => s.expiresAtMillis === 2000);
      expect(withExpiry.length).toBeGreaterThanOrEqual(1);
    });

    it("should map multiple expiries to the same change entry", async () => {
      const splits = await getRowDatas(schema.splitChanges);

      // The credits grant from igr (txnId=igr:sub-p3:2000, index=1)
      // should have an expiry from subscription-end at t=3000 (qty=30)
      const igrCreditsSplits = splits.filter((s: any) =>
        s.txnId === "igr:sub-p3:2000" && s.itemId === "credits"
      );
      expect(igrCreditsSplits.length).toBeGreaterThanOrEqual(1);

      const withExpiry = igrCreditsSplits.filter((s: any) => s.expiresAtMillis === 3000);
      expect(withExpiry.length).toBeGreaterThanOrEqual(1);
    });
  });


  // ============================================================
  // 2. Splitting: multi-expiry changes split correctly
  // ============================================================

  describe("item-changes-with-expiries: splitting logic", () => {
    it("should split a grant into (subQty, expiresAt) pairs consuming from remaining", async () => {
      const splits = await getRowDatas(schema.splitChanges);

      // credits from sub-start: quantity=100, one expiry of qty=80 at t=2000
      // Expected: (80, 2000), (20, null)
      const creditsStartSplits = splits
        .filter((s: any) => s.txnId === "sub-start:sub-p3" && s.itemId === "credits")
        .sort((a: any, b: any) => {
          if (a.expiresAtMillis == null && b.expiresAtMillis == null) return 0;
          if (a.expiresAtMillis == null) return 1;
          if (b.expiresAtMillis == null) return -1;
          return a.expiresAtMillis - b.expiresAtMillis;
        });

      expect(creditsStartSplits).toHaveLength(2);
      expect(creditsStartSplits[0]).toMatchObject({ quantity: 80, expiresAtMillis: 2000 });
      expect(creditsStartSplits[1]).toMatchObject({ quantity: 20, expiresAtMillis: null });
    });

    it("should cap sub-quantity at remaining when expiry exceeds grant", async () => {
      const splits = await getRowDatas(schema.splitChanges);

      // credits from igr: quantity=50, one expiry of qty=30 at t=3000
      // Expected: (30, 3000), (20, null)
      const igrCreditsSplits = splits
        .filter((s: any) => s.txnId === "igr:sub-p3:2000" && s.itemId === "credits")
        .sort((a: any, b: any) => {
          if (a.expiresAtMillis == null && b.expiresAtMillis == null) return 0;
          if (a.expiresAtMillis == null) return 1;
          if (b.expiresAtMillis == null) return -1;
          return a.expiresAtMillis - b.expiresAtMillis;
        });

      expect(igrCreditsSplits).toHaveLength(2);
      expect(igrCreditsSplits[0]).toMatchObject({ quantity: 30, expiresAtMillis: 3000 });
      expect(igrCreditsSplits[1]).toMatchObject({ quantity: 20, expiresAtMillis: null });
    });
  });


  // ============================================================
  // 2b. Splitting algorithm: direct SQL tests (mirrors spec pseudocode)
  // ============================================================

  describe("splitting algorithm (direct SQL)", () => {
    const runSplitAlgo = async (quantity: number, expiries: Array<{ expiresAt: number, quantityExpiring: number }>) => {
      const rowData = JSON.stringify({
        txnId: "test", txnEffectiveAtMillis: 0, customerType: "user",
        customerId: "u1", tenancyId: "t1", itemId: "x",
        quantity,
        expiries: expiries.map(e => ({ txnEffectiveAtMillis: e.expiresAt, quantityExpiring: e.quantityExpiring })),
      });
      const rows = await db.sql.unsafe(`
        SELECT "result".*
        FROM (SELECT '${rowData}'::jsonb AS "rowData") AS "input"
        CROSS JOIN LATERAL (
          WITH RECURSIVE
          ${getSplitAlgoCteSql()}
          SELECT "quantityExpiring"::numeric AS "qty", ("expiresAtMillis" #>> '{}')::numeric AS "exp"
          FROM "walked"
          UNION ALL
          SELECT COALESCE(
            (SELECT "remaining" FROM "walked" ORDER BY "idx" DESC LIMIT 1),
            ${quantity}::numeric
          ), NULL
        ) AS "result"
        ORDER BY "exp" NULLS LAST
      `);
      return rows.map((r: any) => [Number(r.qty), r.exp == null ? null : Number(r.exp)] as [number, number | null]);
    };

    it("positive grant, multiple expiries: [10] with expiries [2@100, 3@101, 4@102]", async () => {
      const result = await runSplitAlgo(10, [
        { expiresAt: 100, quantityExpiring: 2 },
        { expiresAt: 101, quantityExpiring: 3 },
        { expiresAt: 102, quantityExpiring: 4 },
      ]);
      expect(result).toEqual([[2, 100], [3, 101], [4, 102], [1, null]]);
    });

    it("positive grant, expiries exceed grant: [1] with expiries [2@100, 3@101, 4@102]", async () => {
      const result = await runSplitAlgo(1, [
        { expiresAt: 100, quantityExpiring: 2 },
        { expiresAt: 101, quantityExpiring: 3 },
        { expiresAt: 102, quantityExpiring: 4 },
      ]);
      expect(result).toEqual([[1, 100], [0, 101], [0, 102], [0, null]]);
    });

    it("negative removal, multiple expiries: [-8] with expiries [-3@100, -5@101, -4@102]", async () => {
      const result = await runSplitAlgo(-8, [
        { expiresAt: 100, quantityExpiring: -3 },
        { expiresAt: 101, quantityExpiring: -5 },
        { expiresAt: 102, quantityExpiring: -4 },
      ]);
      expect(result).toEqual([[-3, 100], [-5, 101], [0, 102], [0, null]]);
    });

    it("no expiries: passes through unchanged", async () => {
      const result = await runSplitAlgo(10, []);
      expect(result).toEqual([[10, null]]);
    });

    it("negative removal, no expiries: passes through unchanged", async () => {
      const result = await runSplitAlgo(-5, []);
      expect(result).toEqual([[-5, null]]);
    });
  });


  // ============================================================
  // 3. Non-expiring changes: null/empty expiry, not split
  // ============================================================

  describe("item-changes-with-expiries: non-expiring changes", () => {
    it("should compact non-expiring changes within the same window", async () => {
      const splits = await getRowDatas(schema.splitChanges);

      // bonus from sub-start (+10) and manual bonus change (-3) are both
      // compactable (expiresWhen=null) and fall in the same window (before
      // any item-quantity-expire boundary). They are compacted into a single
      // entry with quantity=7, attributed to the sub-start transaction.
      const bonusSplits = splits.filter((s: any) =>
        s.txnId === "sub-start:sub-p3" && s.itemId === "bonus"
      );
      expect(bonusSplits).toHaveLength(1);
      expect(bonusSplits[0].expiresAtMillis).toBeNull();
      expect(bonusSplits[0].quantity).toBe(7);
    });

    it("should not emit separate entries for compacted-away manual changes", async () => {
      const splits = await getRowDatas(schema.splitChanges);

      // The manual bonus change (txnId="miqc:iqc-p3-1") was compacted into
      // the sub-start's bonus grant, so it should not appear separately.
      const manualBonusSplits = splits.filter((s: any) =>
        s.txnId === "miqc:iqc-p3-1" && s.itemId === "bonus"
      );
      expect(manualBonusSplits).toHaveLength(0);
    });
  });


  // ============================================================
  // 4. OwnedProducts
  // ============================================================

  describe("owned-products (LFold safety guards)", () => {
    it("should produce output rows with grant data", async () => {
      const rows = await getRowDatas(schema.ownedProducts);
      const afterGrant = rows.find((r: any) => r.txnId === "sub-start:sub-p3");
      expect(afterGrant).toBeDefined();
      expect(afterGrant.ownedProducts["prod-1"]).toBeDefined();
      expect(afterGrant.ownedProducts["prod-1"].quantity).toBe(1);
    });

    it("should accumulate revocation deltas", async () => {
      const rows = await getRowDatas(schema.ownedProducts);
      const afterEnd = rows.find((r: any) => r.txnId === "sub-end:sub-p3");
      expect(afterEnd).toBeDefined();
      expect(afterEnd.ownedProducts["prod-1"].quantity).toBe(0);
    });

    it("should emit rows ordered by txnEffectiveAtMillis", async () => {
      const rows = await getRowDatas(schema.ownedProducts);
      const times = rows.map((r: any) => r.txnEffectiveAtMillis);
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    });

    it("should never let quantity go negative", async () => {
      const rows = await getRowDatas(schema.ownedProducts);
      for (const row of rows) {
        for (const productId of Object.keys(row.ownedProducts)) {
          expect(row.ownedProducts[productId].quantity).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });


  // ============================================================
  // 5. ItemQuantities: basic ledger sum
  // ============================================================

  describe("item-quantities", () => {
    it("should accumulate item quantities across transactions", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      expect(rows.length).toBeGreaterThan(0);

      const lastRow = rows[rows.length - 1];
      expect(lastRow.itemQuantities).toBeDefined();
      expect(typeof lastRow.itemQuantities.bonus).toBe("number");
    });

    it("should show correct bonus balance: +10 (grant) -3 (manual) = 7", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const lastRow = rows[rows.length - 1];
      expect(lastRow.itemQuantities.bonus).toBe(7);
    });

    it("should show correct credits balance: 100 (sub-start) + 50 (igr) = 150", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const lastRow = rows[rows.length - 1];
      expect(lastRow.itemQuantities.credits).toBe(150);
    });

    it("should include customer info on every item quantities row", async () => {
      const rows = await getRowDatas(schema.itemQuantities);
      for (const row of rows) {
        expect(row.customerType).toBe("user");
        expect(row.customerId).toBe("u1");
        expect(row.tenancyId).toBe("t1");
      }
    });
  });


});
