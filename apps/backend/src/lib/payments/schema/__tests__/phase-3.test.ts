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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBulldozerExecutionContext, type BulldozerExecutionContext } from "@/lib/bulldozer/db/index";
import { createPaymentsSchema } from "../index";
import { getSplitAlgoCteSql } from "../phase-3/split-algo";
import { createTestDb, jsonbExpr } from "./test-helpers";

const MONTH_MS = 2592000000;

describe.sequential("payments schema phase 3 (real postgres)", () => {
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
    for (const table of schema._allTables) {
      await runStatements(table.init(executionContext));
    }

    // Subscription with credits (when-purchase-expires) and bonus (never expires).
    // Has endedAt so we get subscription-end which expires the credits.
    await runStatements(schema.subscriptions.setRow(executionContext, "sub-p3", jsonbExpr({
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
      canceledAtMillis: null,
      endedAtMillis: 3000,
      refundedAtMillis: null,
      creationSource: "PURCHASE_PAGE",
      createdAtMillis: 1000,
    })));

    // Manual non-expiring change (bonus)
    await runStatements(schema.manualItemQuantityChanges.setRow(executionContext, "iqc-p3-1", jsonbExpr({
      id: "iqc-p3-1",
      tenancyId: "t1",
      customerId: "u1",
      customerType: "user",
      itemId: "bonus",
      quantity: -3,
      description: null,
      expiresAtMillis: null,
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

    it("no expiries: passes through unchanged", async () => {
      const result = await runSplitAlgo(10, []);
      expect(result).toEqual([[10, null]]);
    });

    // Removals bypass the split CTE entirely — they are handled by the
    // CASE WHEN in the FlatMap. Covered by integration-2-3.test.ts
    // "removal with no prior grants" and "removal after grant" cases.
  });


  // ============================================================
  // 4. Ledger algorithm: in-place grant mutation with debt
  // ============================================================

  describe("ledger algorithm (reference implementation)", () => {
    type Grant = { q: number, e: number | null };
    type ItemState = { grants: Grant[], debt: number };

    function runLedger(rows: Array<{
      itemId: string,
      quantity: number,
      expiresAtMillis: number | null,
      txnEffectiveAtMillis: number,
    }>): Record<string, number> {
      const state = new Map<string, ItemState>();
      const getItem = (id: string): ItemState => {
        if (!state.has(id)) state.set(id, { grants: [], debt: 0 });
        return state.get(id)!;
      };
      const sortGrants = (gs: Grant[]) =>
        gs.sort((a, b) => {
          if (a.e == null && b.e == null) return 0;
          if (a.e == null) return 1;
          if (b.e == null) return -1;
          return a.e - b.e;
        });

      for (const row of rows) {
        const item = getItem(row.itemId);
        if (row.quantity > 0) {
          let qty = row.quantity + item.debt;
          item.debt = Math.min(0, qty);
          qty = Math.max(0, qty);
          if (qty > 0) {
            item.grants.push({ q: qty, e: row.expiresAtMillis });
          }
        } else if (row.quantity < 0) {
          sortGrants(item.grants);
          let remaining = Math.abs(row.quantity);
          for (const grant of item.grants) {
            const deducted = Math.min(grant.q, remaining);
            grant.q -= deducted;
            remaining -= deducted;
            if (remaining === 0) break;
          }
          item.grants = item.grants.filter(g => g.q > 0);
          if (remaining > 0) {
            item.debt -= remaining;
          }
        } else {
          item.grants = item.grants.filter(
            g => g.e == null || g.e > row.txnEffectiveAtMillis
          );
        }
      }

      const result: Record<string, number> = {};
      for (const [itemId, item] of state) {
        result[itemId] = item.grants.reduce((sum, g) => sum + g.q, 0) + item.debt;
      }
      return result;
    }

    it("should handle simple grant with no expiry", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 100, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
      ]);
      expect(result.coins).toBe(100);
    });

    it("should consume removals from soonest-expiring grants first", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 10, expiresAtMillis: 5000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 20, expiresAtMillis: 3000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -8, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
      ]);
      expect(result.coins).toBe(22);
    });

    it("should expire grants and apply removals correctly together", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 20, expiresAtMillis: 3000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 10, expiresAtMillis: 5000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 3500 },
        { itemId: "coins", quantity: -8, expiresAtMillis: null, txnEffectiveAtMillis: 3500 },
      ]);
      expect(result.coins).toBe(2);
    });

    it("removals are permanent (do not reverse)", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 100, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -30, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
      ]);
      expect(result.coins).toBe(70);
    });

    it("should track multiple items independently", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 100, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "gems", quantity: 50, expiresAtMillis: 5000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -20, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
        { itemId: "gems", quantity: 20, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
      ]);
      expect(result.coins).toBe(80);
      expect(result.gems).toBe(70);
    });

    it("should expire a grant with no removals", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 50, expiresAtMillis: 3000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 30, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 4000 },
      ]);
      expect(result.coins).toBe(30);
    });

    it("should allow removals to push net quantity negative (debt)", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 10, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -25, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
      ]);
      expect(result.coins).toBe(-15);
    });

    it("debt is absorbed by next grant", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 10, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -25, expiresAtMillis: null, txnEffectiveAtMillis: 2000 },
        { itemId: "coins", quantity: 20, expiresAtMillis: null, txnEffectiveAtMillis: 3000 },
      ]);
      expect(result.coins).toBe(5);
    });

    it("worked example from the plan", () => {
      const result = runLedger([
        { itemId: "credits", quantity: 50, expiresAtMillis: 1000, txnEffectiveAtMillis: 0 },
        { itemId: "credits", quantity: 30, expiresAtMillis: null, txnEffectiveAtMillis: 1 },
        { itemId: "credits", quantity: -40, expiresAtMillis: null, txnEffectiveAtMillis: 2 },
        { itemId: "credits", quantity: -60, expiresAtMillis: null, txnEffectiveAtMillis: 3 },
        { itemId: "credits", quantity: 25, expiresAtMillis: null, txnEffectiveAtMillis: 4 },
        { itemId: "credits", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
      ]);
      expect(result.credits).toBe(5);
    });

    it("should handle multiple grants with different expiry times and removal", () => {
      const result = runLedger([
        { itemId: "coins", quantity: 30, expiresAtMillis: 2000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 50, expiresAtMillis: 4000, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: 20, expiresAtMillis: null, txnEffectiveAtMillis: 1000 },
        { itemId: "coins", quantity: -10, expiresAtMillis: null, txnEffectiveAtMillis: 1500 },
        { itemId: "coins", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: 3000 },
      ]);
      expect(result.coins).toBe(70);
    });

    it("comprehensive edge case scenario with point-in-time queries", () => {
      const txs = [
        { amount: -70, grant_time: 47 },
        { amount: 60, grant_time: 40, expiration_time: 45 },
        { amount: 100, grant_time: 10, expiration_time: 50 },
        { amount: -20, grant_time: 5 },
        { amount: 50, grant_time: 48, expiration_time: 60 },
        { amount: -30, grant_time: 25 },
        { amount: 40, grant_time: 20 },
        { amount: -50, grant_time: 44 },
        { amount: 30, grant_time: 46 },
        { amount: -70, grant_time: 35 },
      ];

      function getBalanceAt(ts: number): number {
        const sorted = [...txs]
          .filter(tx => tx.grant_time <= ts)
          .sort((a, b) => a.grant_time - b.grant_time);
        const rows = sorted.map(tx => ({
          itemId: "x",
          quantity: tx.amount,
          expiresAtMillis: ("expiration_time" in tx ? tx.expiration_time : null) as number | null,
          txnEffectiveAtMillis: tx.grant_time,
        }));
        // Emit expiry markers at each distinct expiry time <= ts, matching
        // what the FlatMap does in the real pipeline.
        const expiryTimes = new Set(
          txs
            .filter(tx => "expiration_time" in tx && tx.expiration_time != null && tx.expiration_time <= ts)
            .map(tx => (tx as { expiration_time: number }).expiration_time)
        );
        for (const et of expiryTimes) {
          rows.push({ itemId: "x", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: et });
        }
        // Final marker at query time
        rows.push({ itemId: "x", quantity: 0, expiresAtMillis: null, txnEffectiveAtMillis: ts });
        rows.sort((a, b) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);
        const result = runLedger(rows);
        return "x" in result ? result.x : 0;
      }

      expect(getBalanceAt(0)).toBe(0);
      expect(getBalanceAt(5)).toBe(-20);
      expect(getBalanceAt(10)).toBe(80);
      expect(getBalanceAt(20)).toBe(120);
      expect(getBalanceAt(25)).toBe(90);
      expect(getBalanceAt(35)).toBe(20);
      expect(getBalanceAt(40)).toBe(80);
      expect(getBalanceAt(44)).toBe(30);
      expect(getBalanceAt(45)).toBe(20);
      expect(getBalanceAt(46)).toBe(50);
      expect(getBalanceAt(47)).toBe(-20);
      expect(getBalanceAt(48)).toBe(30);
      expect(getBalanceAt(59)).toBe(30);
      expect(getBalanceAt(60)).toBe(0);
      expect(getBalanceAt(70)).toBe(0);
    });
  });
});
