/**
 * Queue-drained variant of the phase 1→3 integration tests: subscription
 * lifecycle events scheduled in the future (sub-end on
 * `cancelAtPeriodEnd`, monthly item-grant-repeat ticks) defer to the
 * BulldozerTimeFoldQueue and must propagate through the downstream cascade
 * — events → transactions → itemQuantities / ownedProducts — when drained
 * by `public.bulldozer_timefold_process_queue()` (the pg_cron path).
 *
 * The sibling `integration-1-3.test.ts` seeds lastProcessedAt = 2099 so
 * every scheduled tick fires inline at setRow time and the queue is never
 * exercised. These tests instead keep lastProcessedAt at the present, let
 * future ticks stay queued, then advance the clock and invoke the drain
 * function — mirroring real pg_cron behaviour.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBulldozerExecutionContext, type BulldozerExecutionContext } from "@/lib/bulldozer/db/index";
import { createPaymentsSchema } from "../index";
import { createTestDb, jsonbExpr } from "./test-helpers";

const DAY_MS = 86400000;
const MONTH_MS = 2592000000;

describe.sequential("payments schema integration phase 1→3, queue-drained path (real postgres)", () => {
  // Clock starts at now() so that future scheduledAt values stay queued
  // (vs the default `createTestDb` behaviour of lastProcessedAt = 2099,
  // which would fire every tick inline). `installProcessQueueFn` installs
  // the rewritten process_queue function body from the cascade migration
  // so `processQueue()` exercises the real prod function.
  const db = createTestDb({
    lastProcessedAt: "now()",
    installProcessQueueFn: true,
  });
  const { runStatements, readRows, setLastProcessedAt, processQueue, countQueueRows } = db;
  const schema = createPaymentsSchema();
  let executionContext = createBulldozerExecutionContext();

  const getRowDatas = async (table: { listRowsInGroup: (ctx: BulldozerExecutionContext, opts: any) => any }) => {
    const rows = await readRows(table.listRowsInGroup(executionContext, {
      start: "start", end: "end", startInclusive: true, endInclusive: true,
    }));
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
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });


  // ============================================================
  // Test 6: mid-period upgrade with pg_cron-drained end event
  //
  // Free sub ending mid-period + team sub starting the next day.
  // With lastProcessedAt in the recent past, the free sub's end event
  // gets QUEUED (not fired inline). Once drained, downstream ledgers
  // must reflect: only team's 500 emails, not 100 + 500 = 600.
  // ============================================================
  describe("mid-period upgrade with queue-drained end event", () => {
    it("queues the subscription-end event instead of firing inline", async () => {
      // subscription-timefold-algo derives nextTimestamp from millis fields
      // like endedAtMillis / repeat intervals. These are raw epoch millis,
      // so they map to ~1970. To make the inline recursion's
      // `nextTimestamp > lastProcessedAt` check hold (= "defer to queue"),
      // we set lastProcessedAt to pre-epoch.
      await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);

      await runStatements(schema.subscriptions.setRow(executionContext, "sub-q-free", jsonbExpr({
        id: "sub-q-free",
        tenancyId: "t1",
        customerId: "u-q-upgrade",
        customerType: "user",
        productId: "prod-q-free",
        priceId: "p-free",
        product: {
          displayName: "Free (queued)",
          customerType: "user",
          productLineId: "line-q-upgrade",
          prices: { "p-free": { USD: "0" } },
          includedItems: {
            emails: { quantity: 100, repeat: [1, "month"], expires: "when-repeated" },
          },
        },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "canceled",
        currentPeriodStartMillis: 0,
        currentPeriodEndMillis: MONTH_MS,
        cancelAtPeriodEnd: false,
        canceledAtMillis: 10 * DAY_MS,
        endedAtMillis: 10 * DAY_MS,
        refundedAtMillis: null,
        creationSource: "TEST_MODE",
        createdAtMillis: 0,
      })));

      // The subscription-end tick is scheduled at `endedAtMillis` which is
      // > lastProcessedAt (10 days from epoch > "one hour ago"). It must
      // therefore be queued, not emitted inline.
      const queued = await countQueueRows();
      expect(queued).toBeGreaterThan(0);

      const endEventsBeforeDrain = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-q-free");
      expect(endEventsBeforeDrain).toEqual([]);
    });

    it("after drain, end event fires AND downstream cascade runs; upgrade does not stack", async () => {
      // Now bring the team sub online.
      await runStatements(schema.subscriptions.setRow(executionContext, "sub-q-team", jsonbExpr({
        id: "sub-q-team",
        tenancyId: "t1",
        customerId: "u-q-upgrade",
        customerType: "user",
        productId: "prod-q-team",
        priceId: "p-team",
        product: {
          displayName: "Team (queued)",
          customerType: "user",
          productLineId: "line-q-upgrade",
          prices: { "p-team": { USD: "30" } },
          includedItems: {
            emails: { quantity: 500, repeat: [1, "month"], expires: "when-repeated" },
          },
        },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "canceled",
        currentPeriodStartMillis: 11 * DAY_MS,
        currentPeriodEndMillis: 11 * DAY_MS + MONTH_MS,
        cancelAtPeriodEnd: true,
        canceledAtMillis: 20 * DAY_MS,
        endedAtMillis: 20 * DAY_MS,
        refundedAtMillis: null,
        creationSource: "TEST_MODE",
        createdAtMillis: 11 * DAY_MS,
      })));

      // Bump clock far enough forward to make every queued tick due, then drain.
      await setLastProcessedAt(`'2099-01-01T00:00:00Z'`);
      await processQueue();
      expect(await countQueueRows()).toBe(0);

      const endEvents = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId === "sub-q-free");
      expect(endEvents).toHaveLength(1);

      const transactions = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.customerId === "u-q-upgrade");
      const endTxns = transactions.filter((t: any) => t.txnId === "sub-end:sub-q-free");
      expect(endTxns).toHaveLength(1);

      const itemQuantityRows = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId === "u-q-upgrade")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      const atTeamStart = itemQuantityRows.find((r: any) => r.txnId === "sub-start:sub-q-team");
      expect(atTeamStart).toBeDefined();
      // Stacking regression: without downstream-cascade propagation on the
      // queue path, sub-free's end event never fires the cascade, so
      // atTeamStart.emails accumulates free.100 + team.500 = 600 instead of
      // the team-only 500.
      expect(atTeamStart.itemQuantities.emails).toBe(500);
    });
  });


  // ============================================================
  // Test 7: monthly repeat reset via pg_cron
  //
  // Sub with a monthly-repeating quota item. Between sub-start and the
  // first repeat, balance must reflect the initial grant. After pg_cron
  // drains the repeat tick, balance must reflect the REFRESHED grant
  // (not doubled, not zero).
  // ============================================================
  describe("monthly repeat reset via queue drain", () => {
    it("repeat tick is queued until the clock is advanced past it", async () => {
      await setLastProcessedAt(`'1969-01-01T00:00:00Z'`);

      await runStatements(schema.subscriptions.setRow(executionContext, "sub-q-repeat", jsonbExpr({
        id: "sub-q-repeat",
        tenancyId: "t1",
        customerId: "u-q-repeat",
        customerType: "user",
        productId: "prod-q-repeat",
        priceId: "p1",
        product: {
          displayName: "Repeat (queued)",
          customerType: "user",
          productLineId: "line-q-repeat",
          prices: { p1: { USD: "10" } },
          includedItems: {
            quota: { quantity: 200, repeat: [1, "month"], expires: "when-repeated" },
          },
        },
        quantity: 1,
        stripeSubscriptionId: null,
        status: "active",
        currentPeriodStartMillis: 0,
        currentPeriodEndMillis: MONTH_MS,
        cancelAtPeriodEnd: false,
        canceledAtMillis: null,
        endedAtMillis: 45 * DAY_MS,
        refundedAtMillis: null,
        creationSource: "TEST_MODE",
        createdAtMillis: 0,
      })));

      expect(await countQueueRows()).toBeGreaterThan(0);

      const initialRows = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId === "u-q-repeat")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);
      const atStart = initialRows.find((r: any) => r.txnId === "sub-start:sub-q-repeat");
      expect(atStart).toBeDefined();
      expect(atStart.itemQuantities.quota).toBe(200);
    });

    it("after drain, quota is refreshed (not doubled, not stuck)", async () => {
      // Advance clock past all repeats (and past endedAt).
      await setLastProcessedAt(`'2099-01-01T00:00:00Z'`);
      await processQueue();
      expect(await countQueueRows()).toBe(0);

      const rows = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId === "u-q-repeat")
        .sort((a: any, b: any) => a.txnEffectiveAtMillis - b.txnEffectiveAtMillis);

      // After every repeat and the final subscription-end, quota must drop
      // to 0 — both repeat grants and the final one expire. Without the
      // downstream cascade on the queue path, queued events never reach
      // itemQuantities and this stays at the initial 200 (or whatever the
      // inline path wrote at setRow time).
      const latest = rows[rows.length - 1];
      expect(latest.itemQuantities.quota).toBe(0);

      // Between repeats, there should be exactly one active repeat grant at
      // a time — never doubled. The queue drain is expected to emit at
      // least one `igr:sub-q-repeat:*` row into itemQuantities (the
      // 30-day repeat fires once between sub-start at t=0 and sub-end at
      // t=45d). Asserting its presence unconditionally is the whole point
      // of this test — the original regression was that the cascade
      // dropped these emissions entirely, so a `find() == null` must fail
      // loud, not silently skip.
      const midPeriodRow = rows.find((r: any) =>
        r.txnId?.startsWith("igr:sub-q-repeat:") && r.itemQuantities?.quota != null
      );
      expect(
        midPeriodRow,
        "expected at least one igr:sub-q-repeat:* row in itemQuantities; if this is null the queue-drain cascade dropped the repeat emission entirely",
      ).toBeDefined();
      expect(midPeriodRow.itemQuantities.quota).toBe(200);
    });
  });


  // ============================================================
  // Test 8: re-drain idempotency at the payments layer
  //
  // Draining twice with nothing new in between must not duplicate
  // subscription-end events, transactions, or item-quantity changes.
  // ============================================================
  describe("re-drain idempotency at the payments layer", () => {
    it("second process_queue call with no new queue rows is a no-op", async () => {
      // Snapshot counts after prior tests' drains.
      const endEventsBefore = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId?.startsWith("sub-q-"));
      const endTxnsBefore = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId?.startsWith("sub-end:sub-q-"));
      const itemQuantitiesBefore = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId?.startsWith("u-q-"));

      expect(await countQueueRows()).toBe(0);
      await processQueue();

      const endEventsAfter = (await getRowDatas(schema.subscriptionEndEvents))
        .filter((e: any) => e.subscriptionId?.startsWith("sub-q-"));
      const endTxnsAfter = (await getRowDatas(schema.transactions))
        .filter((t: any) => t.txnId?.startsWith("sub-end:sub-q-"));
      const itemQuantitiesAfter = (await getRowDatas(schema.itemQuantities))
        .filter((r: any) => r.customerId?.startsWith("u-q-"));

      expect(endEventsAfter).toHaveLength(endEventsBefore.length);
      expect(endTxnsAfter).toHaveLength(endTxnsBefore.length);
      expect(itemQuantitiesAfter).toHaveLength(itemQuantitiesBefore.length);
    });
  });
});
