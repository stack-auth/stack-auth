/**
 * Phase 3 tests: CompactedTransactionEntries → ItemChangesWithExpiries → ItemQuantities
 *
 * Tests:
 * 1. OwnedProducts accumulation (basic grant/revoke)
 * 2. ItemQuantities ledger (basic sum with expiry-aware logic)
 * 3. Splitting algorithm: direct SQL tests
 * 4. Ledger algorithm: direct SQL tests
 *
 * Data is populated via subscriptions stored table (TimeFold generates events)
 * and manual item quantity changes. Entry indices are looked up dynamically.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPaymentsSchema } from "../index";
import { getAllNetQtysSql } from "../phase-3/ledger-algo";
import { getSplitAlgoCteSql } from "../phase-3/split-algo";
import { createTestDb, jsonbExpr } from "./test-helpers";

const MONTH_MS = 2592000000;

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

    // Subscription with credits (when-purchase-expires) and bonus (never expires).
    // Has endedAt so we get subscription-end which expires the credits.
    await runStatements(schema.subscriptions.setRow("sub-p3", jsonbExpr({
      id: "sub-p3",
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
          credits: { quantity: 100, expires: "when-purchase-expires" },
          bonus: { quantity: 10, expires: "never" },
        },
      },
      quantity: 1,
      stripeSubscriptionId: null,
      status: "active",
      currentPeriodStartMillis: 1000,
      currentPeriodEndMillis: 1000 + MONTH_MS,
      cancelAtPeriodEnd: false,
      endedAtMillis: 3000,
      refundedAtMillis: null,
      creationSource: "PURCHASE_PAGE",
      createdAtMillis: 1000,
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
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });


  // ============================================================
  // 1. OwnedProducts
  // ============================================================

  describe("owned-products", () => {
    it("should show product as owned after subscription-start", async () => {
      const rows = await getRowDatas(schema.ownedProducts);
      const afterGrant = rows.find((r: any) => r.txnId === "sub-start:sub-p3");
      expect(afterGrant).toBeDefined();
      expect(afterGrant.ownedProducts["prod-1"]).toBeDefined();
      expect(afterGrant.ownedProducts["prod-1"].quantity).toBe(1);
    });

    it("should show product revoked after subscription-end", async () => {
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
  // 2. ItemQuantities
  // ============================================================

  describe("item-quantities", () => {
    it("should accumulate item quantities across transactions", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);
      expect(rows.length).toBeGreaterThan(0);
      const lastRow = rows[rows.length - 1];
      expect(lastRow.itemQuantities).toBeDefined();
    });

    it("should show correct bonus balance: +10 (grant) -3 (manual) = 7", async () => {
      const rows = (await getRowDatas(schema.itemQuantities))
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);
      const lastRow = rows[rows.length - 1];
      expect(lastRow.itemQuantities.bonus).toBe(7);
    });

    it("should include customer info on every row", async () => {
      const rows = await getRowDatas(schema.itemQuantities);
      for (const row of rows) {
        expect(row.customerType).toBe("user");
        expect(row.customerId).toBe("u1");
        expect(row.tenancyId).toBe("t1");
      }
    });
  });


  // ============================================================
  // 3. Splitting algorithm: direct SQL tests
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
  // 4. Ledger algorithm: direct SQL tests
  // ============================================================

  describe("ledger algorithm (direct SQL)", () => {
    const runLedger = async (rows: Array<{
      itemId: string,
      quantity: number,
      expiresAtMillis: number | null,
      txnEffectiveAtMillis: number,
    }>) => {
      const state = new Map<string, { g: Array<{ q: number, e: number | null }>, r: Array<{ q: number, e: number | null }> }>();
      for (const row of rows) {
        if (!state.has(row.itemId)) {
          state.set(row.itemId, { g: [], r: [] });
        }
        const entry = { q: row.quantity, e: row.expiresAtMillis };
        const itemState = state.get(row.itemId) ?? (() => {
          throw new Error("unreachable");
        })();
        if (row.quantity >= 0) {
          itemState.g.push(entry);
        } else {
          itemState.r.push(entry);
        }
      }
      const lastTime = rows[rows.length - 1].txnEffectiveAtMillis;
      const stateJson = JSON.stringify(Object.fromEntries(state)).replaceAll("'", "''");

      const result = await db.sql.unsafe(`
        SELECT ${getAllNetQtysSql(`'${stateJson}'::jsonb`, `${lastTime}::numeric`)} AS "result"
      `);
      return result[0].result;
    };

    it("should handle simple grant with no expiry", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 100, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
      ]);
      expect(result.coins).toBe(100);
    });

    it("should consume removals from soonest-expiring grants first", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 10, expiresAtMillis: 5000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 20, expiresAtMillis: 3000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -8, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
      ]);
      expect(result.coins).toBe(22);
    });

    it("should expire grants and apply removals correctly together", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 20, expiresAtMillis: 3000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 10, expiresAtMillis: 5000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -8, expiresAtMillis: null, txnEffectiveAtMillis: 3500 },
      ]);
      expect(result.coins).toBe(10);
    });

    it("should reverse expired removals (items come back)", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 100, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -30, expiresAtMillis: 5000, txnEffectiveAtMillis: 2000 },
        { itemId: "coins", quantity: -20, expiresAtMillis: 3000, txnEffectiveAtMillis: 2000 },
        { itemId: "coins", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 4000 },
      ]);
      expect(result.coins).toBe(70);
    });

    it("should track multiple items independently", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 100, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "gems", quantity: 50, expiresAtMillis: 5000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -20, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
        { itemId: "gems", quantity: 30, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
      ]);
      expect(result.coins).toBe(80);
      expect(result.gems).toBe(80);
    });

    it("should expire a grant with no removals", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 50, expiresAtMillis: 3000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 30, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 4000 },
      ]);
      expect(result.coins).toBe(30);
    });

    it("should allow removals to push net quantity negative", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 10, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -25, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
      ]);
      expect(result.coins).toBe(-15);
    });

    it("should handle expiring penalty (removal expires, items return)", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 100, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -40, expiresAtMillis: 3000, txnEffectiveAtMillis: 2000 },
        { itemId: "coins", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 4000 },
      ]);
      expect(result.coins).toBe(100);
    });

    it("should handle mix of expiring grants, expiring removals, and non-expiring entries", async () => {
      const result = await runLedger([
        { itemId: "credits", quantity: 100, expiresAtMillis: 5000, txnEffectiveAtMillis: 1000 },
        { itemId: "credits", quantity: 20, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "credits", quantity: -30, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
        { itemId: "credits", quantity: -15, expiresAtMillis: 4000, txnEffectiveAtMillis: 2500 },
        { itemId: "credits", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 4500 },
      ]);
      expect(result.credits).toBe(90);
    });

    it("should handle multiple grants with different expiry times", async () => {
      const result = await runLedger([
        { itemId: "coins", quantity: 30, expiresAtMillis: 2000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 50, expiresAtMillis: 4000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 20, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -10, expiresAtMillis: null, txnEffectiveAtMillis: 1500 },
        { itemId: "coins", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 3000 },
      ]);
      expect(result.coins).toBe(70);
    });
  });
});
