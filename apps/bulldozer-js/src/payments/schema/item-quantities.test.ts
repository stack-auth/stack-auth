import { describe, expect, it } from "vitest";
import type { PiledriverObject } from "../../databases/piledriver/index.js";
import { createPaymentsSchema } from "./index.js";
import { asRecord, balanceAt, customerGroup, initializedSnapshot, MONTH_MS, product, rowsBySortKey, set, subscription, type Snapshot } from "./schema-test-helpers.js";

// Item-quantities parity suite: restores the ledger coverage from the retired bulldozer-server
// payments tests, driven through the real payments schema.
//
// A few cases use `it.fails`: they assert the OLD (correct) behaviour but fail today because of a
// known regression. bulldozer-js expires a grant by removing its *original* granted quantity
// instead of only what is *left*, so a grant that was consumed before it expires gets over-removed
// (it can eat into other grants and even go negative). Remove the `.fails` once the ledger expires
// only the remaining quantity. Each affected case spells out the divergence in its own comment.

const DAY_MS = 86_400_000;

type ManualChange = {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: "user",
  itemId: string,
  quantity: number,
  description: null,
  expiresAtMillis: number | null,
  createdAtMillis: number,
};
const manualChange = (id: string, customerId: string, itemId: string, quantity: number, createdAtMillis: number, expiresAtMillis: number | null): ManualChange => ({
  id, tenancyId: "t1", customerId, customerType: "user", itemId, quantity, description: null, expiresAtMillis, createdAtMillis,
});
const setManualChange = async (snapshot: Snapshot, change: ManualChange) => {
  const schema = createPaymentsSchema();
  return await set(snapshot, schema.manualItemQuantityChanges, change.id, change as unknown as PiledriverObject);
};

describe("item quantities: ledger semantics", () => {
  it("keeps a grant with no expiry indefinitely", async () => {
    /*
     * t=1000  +100 coins (no expiry)
     *
     * Expected coins:
     *   t=1000       -> 100
     *   t=9,999,999  -> 100   (a grant with no expiry stays forever)
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("g", "u", "coins", 100, 1000, null));
    expect(await balanceAt(snapshot, customerGroup("u"), "coins", 1000)).toBe(100);
    expect(await balanceAt(snapshot, customerGroup("u"), "coins", 9_999_999)).toBe(100);
  });

  it.fails("consumes a removal from the soonest-expiring grant first, then expires only what remains", async () => {
    /*
     * t=1000  +20 coins, expires at 3000   (grant A)
     * t=1000  +10 coins, expires at 5000   (grant B)
     * t=2000  -8 coins                     (consumption)
     *
     * The -8 comes out of the soonest-expiring grant first, so A drops 20 -> 12.
     *
     * Expected coins:
     *   t=2000  -> 22   (12 left in A + 10 in B)
     *   t=3100  -> 10   A expires; only its *remaining* 12 should drop, leaving B's 10
     *   t=5100  -> 0    B expires
     *
     * FAILS today: the expiry removes A's original 20 (not the remaining 12), so the balance
     * becomes 2 at t=3100 and -8 at t=5100.
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("gA", "u", "coins", 20, 1000, 3000));
    snapshot = await setManualChange(snapshot, manualChange("gB", "u", "coins", 10, 1000, 5000));
    snapshot = await setManualChange(snapshot, manualChange("rem", "u", "coins", -8, 2000, null));
    const g = customerGroup("u");
    expect(await balanceAt(snapshot, g, "coins", 2000)).toBe(22);
    expect(await balanceAt(snapshot, g, "coins", 3100)).toBe(10);
    expect(await balanceAt(snapshot, g, "coins", 5100)).toBe(0);
  });

  it.fails("applies a grant expiry and a later removal together", async () => {
    /*
     * t=1000  +20 coins, expires at 3000   (grant A)
     * t=1000  +10 coins, expires at 5000   (grant B)
     * t=3500  -8 coins                     (consumption, after A has already expired)
     *
     * Expected coins:
     *   t=2000  -> 30   both grants live
     *   t=3100  -> 10   A's full 20 expires (nothing was consumed from it)
     *   t=3600  -> 2    the -8 hits B (10 -> 2)
     *   t=5100  -> 0    B expires its remaining 2
     *
     * FAILS today: at t=5100 the expiry removes B's original 10, giving -8.
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("gA", "u", "coins", 20, 1000, 3000));
    snapshot = await setManualChange(snapshot, manualChange("gB", "u", "coins", 10, 1000, 5000));
    snapshot = await setManualChange(snapshot, manualChange("rem", "u", "coins", -8, 3500, null));
    const g = customerGroup("u");
    expect(await balanceAt(snapshot, g, "coins", 2000)).toBe(30);
    expect(await balanceAt(snapshot, g, "coins", 3100)).toBe(10);
    expect(await balanceAt(snapshot, g, "coins", 3600)).toBe(2);
    expect(await balanceAt(snapshot, g, "coins", 5100)).toBe(0);
  });

  it("treats a removal as permanent (never reverses)", async () => {
    /*
     * t=1000  +100 coins (no expiry)
     * t=2000  -30 coins
     *
     * Expected coins:
     *   t=2500       -> 70
     *   t=9,999,999  -> 70   (removals don't come back later)
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("g", "u", "coins", 100, 1000, null));
    snapshot = await setManualChange(snapshot, manualChange("rem", "u", "coins", -30, 2000, null));
    const g = customerGroup("u");
    expect(await balanceAt(snapshot, g, "coins", 2500)).toBe(70);
    expect(await balanceAt(snapshot, g, "coins", 9_999_999)).toBe(70);
  });

  it("tracks multiple items independently", async () => {
    /*
     * t=1000  +100 coins (no expiry)
     * t=1000  +50 gems, expires at 5000
     * t=2000  -20 coins
     * t=2000  +20 gems (no expiry)
     *
     * Checked at t=2500 (before the gems grant expires) so the two items line up.
     * Expected:  coins -> 80,  gems -> 70   (neither item affects the other)
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("c1", "u", "coins", 100, 1000, null));
    snapshot = await setManualChange(snapshot, manualChange("g1", "u", "gems", 50, 1000, 5000));
    snapshot = await setManualChange(snapshot, manualChange("c2", "u", "coins", -20, 2000, null));
    snapshot = await setManualChange(snapshot, manualChange("g2", "u", "gems", 20, 2000, null));
    const g = customerGroup("u");
    expect(await balanceAt(snapshot, g, "coins", 2500)).toBe(80);
    expect(await balanceAt(snapshot, g, "gems", 2500)).toBe(70);
  });

  it("expires a grant with no removals", async () => {
    /*
     * t=1000  +50 coins, expires at 3000
     * t=1000  +30 coins (no expiry)
     *
     * Expected coins:
     *   t=2000 -> 80
     *   t=3100 -> 30   (the expiring grant is gone, the permanent one stays)
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("gExp", "u", "coins", 50, 1000, 3000));
    snapshot = await setManualChange(snapshot, manualChange("gPerm", "u", "coins", 30, 1000, null));
    const g = customerGroup("u");
    expect(await balanceAt(snapshot, g, "coins", 2000)).toBe(80);
    expect(await balanceAt(snapshot, g, "coins", 3100)).toBe(30);
  });

  it("lets a removal push the balance negative (debt)", async () => {
    /*
     * t=1000  +10 coins
     * t=2000  -25 coins
     *
     * Expected coins:  t=2500 -> -15   (a removal is allowed to overdraw into debt)
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("g", "u", "coins", 10, 1000, null));
    snapshot = await setManualChange(snapshot, manualChange("rem", "u", "coins", -25, 2000, null));
    expect(await balanceAt(snapshot, customerGroup("u"), "coins", 2500)).toBe(-15);
  });

  it("nets a sequence that dips negative before recovering", async () => {
    /*
     * t=1000  +10 coins
     * t=2000  -25 coins   (running total would be -15 here)
     * t=3000  +20 coins
     *
     * All three are non-expiring, so bulldozer merges them into one summed entry — only the final
     * net is observable, which is exactly what we assert here.
     * Expected coins:  net -> 5
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("g1", "u", "coins", 10, 1000, null));
    snapshot = await setManualChange(snapshot, manualChange("rem", "u", "coins", -25, 2000, null));
    snapshot = await setManualChange(snapshot, manualChange("g2", "u", "coins", 20, 3000, null));
    expect(await balanceAt(snapshot, customerGroup("u"), "coins", 9_999_999)).toBe(5);
  });

  it.fails("handles the worked example: net grant/refill/removals then an expiry no-op", async () => {
    /*
     * t=0  +50 credits, expires at 1000
     * t=1  +30 credits
     * t=2  -40 credits
     * t=3  -60 credits
     * t=4  +25 credits
     *
     * The non-expiring changes net to -45, draining the 50 grant down to 5.
     *
     * Expected credits:
     *   t=500   -> 5   before the grant expires
     *   t=1001  -> 5   the grant is already down to 5, so its expiry removes nothing
     *
     * FAILS today: the expiry removes the original 50 again, giving -45.
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("t0", "u", "credits", 50, 0, 1000));
    snapshot = await setManualChange(snapshot, manualChange("t1", "u", "credits", 30, 1, null));
    snapshot = await setManualChange(snapshot, manualChange("t2", "u", "credits", -40, 2, null));
    snapshot = await setManualChange(snapshot, manualChange("t3", "u", "credits", -60, 3, null));
    snapshot = await setManualChange(snapshot, manualChange("t4", "u", "credits", 25, 4, null));
    const g = customerGroup("u");
    expect(await balanceAt(snapshot, g, "credits", 500)).toBe(5);
    expect(await balanceAt(snapshot, g, "credits", 1001)).toBe(5);
  });

  it.fails("handles multiple expiring grants plus a removal", async () => {
    /*
     * t=1000  +30 coins, expires at 2000   (early grant)
     * t=1000  +50 coins, expires at 4000   (late grant)
     * t=1500  -10 coins                    (consumption)
     *
     * With no permanent grant around, the -10 truly consumes the soonest-expiring grant (early: 30 -> 20).
     *
     * Expected coins:
     *   t=1500 -> 70   (20 in early + 50 in late)
     *   t=2100 -> 50   early grant expires its remaining 20
     *   t=4100 -> 0    late grant expires
     *
     * FAILS today: the expiries remove the original quantities, giving 40 then -10.
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("gEarly", "u", "coins", 30, 1000, 2000));
    snapshot = await setManualChange(snapshot, manualChange("gLate", "u", "coins", 50, 1000, 4000));
    snapshot = await setManualChange(snapshot, manualChange("rem", "u", "coins", -10, 1500, null));
    const g = customerGroup("u");
    expect(await balanceAt(snapshot, g, "coins", 1500)).toBe(70);
    expect(await balanceAt(snapshot, g, "coins", 2100)).toBe(50);
    expect(await balanceAt(snapshot, g, "coins", 4100)).toBe(0);
  });

  it("answers point-in-time queries across staggered expiries", async () => {
    /*
     * t=1000  +10 coins, expires at 2000
     * t=1000  +20 coins, expires at 3000
     * t=1000  +30 coins, expires at 4000
     *
     * Nothing is consumed, so each grant expires its full amount — this path is unaffected by the
     * regression and just checks the balance at several points as grants drop off one by one.
     *
     * Expected coins:
     *   t=1500 -> 60
     *   t=2100 -> 50   (first grant expired)
     *   t=3100 -> 30   (second expired)
     *   t=4100 -> 0    (third expired)
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("g1", "u", "coins", 10, 1000, 2000));
    snapshot = await setManualChange(snapshot, manualChange("g2", "u", "coins", 20, 1000, 3000));
    snapshot = await setManualChange(snapshot, manualChange("g3", "u", "coins", 30, 1000, 4000));
    const g = customerGroup("u");
    expect(await balanceAt(snapshot, g, "coins", 1500)).toBe(60);
    expect(await balanceAt(snapshot, g, "coins", 2100)).toBe(50);
    expect(await balanceAt(snapshot, g, "coins", 3100)).toBe(30);
    expect(await balanceAt(snapshot, g, "coins", 4100)).toBe(0);
  });
});

describe("item quantities: split algorithm (expiring grants)", () => {
  // A grant with an absolute expiry is stored as the grant row plus a negative row at the expiry
  // time. splitChanges isn't stored in time order, so we sort by (effective time, then expiry).
  const splitRows = async (snapshot: Snapshot, customerId: string) => {
    const schema = createPaymentsSchema();
    return (await rowsBySortKey(snapshot, schema.splitChanges, customerGroup(customerId)))
      .map(row => asRecord(row.rowData))
      .map(row => ({ quantity: Number(row.quantity), at: Number(row.txnEffectiveAtMillis), expiresAtMillis: row.expiresAtMillis }))
      .sort((a, b) => a.at - b.at || Number(a.expiresAtMillis ?? Infinity) - Number(b.expiresAtMillis ?? Infinity));
  };

  it("passes a non-expiring grant through as a single permanent row", async () => {
    /*
     * t=1000  +10 coins (no expiry)  ->  one row: +10 at 1000, no expiry
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("g", "u", "coins", 10, 1000, null));
    expect(await splitRows(snapshot, "u")).toEqual([{ quantity: 10, at: 1000, expiresAtMillis: null }]);
  });

  it("splits an absolute-expiry grant into a grant row and a negative expiry row", async () => {
    /*
     * t=1000  +10 coins, expires at 5000
     *   ->  +10 at 1000 (exp 5000),  then  -10 at 5000
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("g", "u", "coins", 10, 1000, 5000));
    expect(await splitRows(snapshot, "u")).toEqual([
      { quantity: 10, at: 1000, expiresAtMillis: 5000 },
      { quantity: -10, at: 5000, expiresAtMillis: null },
    ]);
  });

  it("produces one grant+expiry pair per grant for staggered expiries of the same item", async () => {
    /*
     * t=100  +2 coins, expires at 200
     * t=100  +3 coins, expires at 300
     *   ->  +2 at 100 (exp 200), +3 at 100 (exp 300),  then  -2 at 200,  -3 at 300
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("gA", "u", "coins", 2, 100, 200));
    snapshot = await setManualChange(snapshot, manualChange("gB", "u", "coins", 3, 100, 300));
    expect(await splitRows(snapshot, "u")).toEqual([
      { quantity: 2, at: 100, expiresAtMillis: 200 },
      { quantity: 3, at: 100, expiresAtMillis: 300 },
      { quantity: -2, at: 200, expiresAtMillis: null },
      { quantity: -3, at: 300, expiresAtMillis: null },
    ]);
  });
});

describe("item quantities: compaction", () => {
  it("preserves the earliest row's txnEffectiveAtMillis in the compacted entry", async () => {
    /*
     * t=1000  +5 credits
     * t=2000  +7 credits
     *
     * The two non-expiring changes merge into one compacted entry of 12, stamped with the earliest
     * effective time (1000), not the last.
     */
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("first", "u", "credits", 5, 1000, null));
    snapshot = await setManualChange(snapshot, manualChange("second", "u", "credits", 7, 2000, null));
    const compacted = (await rowsBySortKey(snapshot, schema.compactedItemQuantityChangeEntries, customerGroup("u"))).map(row => asRecord(row.rowData));
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({ type: "compacted-item-quantity-change", itemId: "credits", quantity: 12 });
    expect(Number(compacted[0].txnEffectiveAtMillis)).toBe(1000);
  });
});

describe("item quantities: full-pipeline integration", () => {
  const setOtp = async (snapshot: Snapshot, id: string, customerId: string, productId: string, includedItems: Parameters<typeof product>[0], quantity: number, createdAtMillis: number) => {
    const schema = createPaymentsSchema();
    return await set(snapshot, schema.oneTimePurchases, id, {
      id,
      tenancyId: "t1",
      customerId,
      customerType: "user",
      productId,
      priceId: "p1",
      product: product(includedItems),
      quantity,
      stripePaymentIntentId: null,
      revokedAtMillis: null,
      refundedAtMillis: null,
      creationSource: "TEST_MODE",
      createdAtMillis,
    });
  };

  it("consumes a manual change against a subscription grant, leaving other items untouched", async () => {
    /*
     * t=1000  buy a one-time purchase: 100 coins x2 = 200 coins (no expiry)
     * t=2000  a subscription grants 500 credits (no expiry)
     * t=2500  -50 credits
     *
     * Expected at t=3000:  credits -> 450,  coins -> 200 (untouched)
     */
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await setOtp(snapshot, "otp-coins", "u1", "prod-coins", { coins: { quantity: 100, expires: "never" } }, 2, 1000);
    snapshot = await set(snapshot, schema.subscriptions, "sub-pro", subscription("sub-pro", {
      customerId: "u1",
      productId: "prod-pro",
      product: product({ credits: { quantity: 500, expires: "never" } }),
      createdAtMillis: 2000,
    }) as unknown as PiledriverObject);
    snapshot = await setManualChange(snapshot, manualChange("consume", "u1", "credits", -50, 2500, null));
    const g = customerGroup("u1");
    expect(await balanceAt(snapshot, g, "credits", 3000)).toBe(450);
    expect(await balanceAt(snapshot, g, "coins", 3000)).toBe(200);
  });

  it("isolates item balances per customer", async () => {
    /*
     * t=10000  customer A buys 100 gems;  customer B buys 50 gems
     * t=11000  customer A spends -30 gems
     *
     * Expected at t=12000:  A -> 70,  B -> 50   (B is not affected by A's spend)
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setOtp(snapshot, "otp-a", "u-a", "prod-iso", { gems: { quantity: 100, expires: "never" } }, 1, 10000);
    snapshot = await setOtp(snapshot, "otp-b", "u-b", "prod-iso", { gems: { quantity: 50, expires: "never" } }, 1, 10000);
    snapshot = await setManualChange(snapshot, manualChange("burn-a", "u-a", "gems", -30, 11000, null));
    expect(await balanceAt(snapshot, customerGroup("u-a"), "gems", 12000)).toBe(70);
    expect(await balanceAt(snapshot, customerGroup("u-b"), "gems", 12000)).toBe(50);
  });

  it("nets owned-product quantity after a partial revocation", async () => {
    /*
     * t=20000  one-time purchase #1 of prod-complex (qty 1)
     * t=21000  one-time purchase #2 of prod-complex (qty 1)
     * t=22000  a refund revokes exactly purchase #1
     *
     * Expected owned quantity of prod-complex: 1  (not 0, not 2)
     */
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await setOtp(snapshot, "otp-complex-1", "u-complex", "prod-complex", {}, 1, 20000);
    snapshot = await setOtp(snapshot, "otp-complex-2", "u-complex", "prod-complex", {}, 1, 21000);
    snapshot = await set(snapshot, schema.manualTransactions, "refund-complex", {
      txnId: "refund:otp-complex-1",
      tenancyId: "t1",
      effectiveAtMillis: 22000,
      type: "refund",
      entries: [{
        type: "product-revocation",
        customerType: "user",
        customerId: "u-complex",
        adjustedTransactionId: "otp:otp-complex-1",
        adjustedEntryIndex: 0,
        quantity: 1,
        productId: "prod-complex",
        productLineId: "line-main",
      }],
      customerType: "user",
      customerId: "u-complex",
      paymentProvider: "test_mode",
      createdAtMillis: 22000,
    });
    const owned = asRecord((await rowsBySortKey(snapshot, schema.ownedProducts, customerGroup("u-complex"))).at(-1)?.rowData ?? null);
    expect(asRecord(asRecord(owned.ownedProducts)["prod-complex"]).quantity).toBe(1);
  });

  it.fails("handles consumption + staggered when-purchase-expires expiry across two subscriptions", async () => {
    /*
     * Two subscriptions grant the same item, each expiring when its purchase ends.
     *   grant A: 100 energy, subscription ends day 10
     *   grant B: 200 energy, subscription ends day 30
     * day 5:  -40 energy  (consumed from the soonest-ending grant, A: 100 -> 60)
     *
     * Expected energy:
     *   day 5       -> 260   (60 in A + 200 in B)
     *   day 10 + 1  -> 200   A expires its remaining 60
     *   day 30 + 1  -> 0     B expires
     *
     * FAILS today: the expiry removes A's original 100, giving 160, then goes negative.
     */
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.subscriptions, "sub-a", subscription("sub-a", {
      customerId: "u-energy",
      productId: "prod-a",
      product: product({ energy: { quantity: 100, expires: "when-purchase-expires" } }),
      status: "canceled",
      cancelAtPeriodEnd: true,
      canceledAtMillis: 5 * DAY_MS,
      endedAtMillis: 10 * DAY_MS,
      currentPeriodEndMillis: MONTH_MS,
      createdAtMillis: 0,
    }) as unknown as PiledriverObject);
    snapshot = await set(snapshot, schema.subscriptions, "sub-b", subscription("sub-b", {
      customerId: "u-energy",
      productId: "prod-b",
      product: product({ energy: { quantity: 200, expires: "when-purchase-expires" } }),
      status: "canceled",
      cancelAtPeriodEnd: true,
      canceledAtMillis: 15 * DAY_MS,
      endedAtMillis: 30 * DAY_MS,
      currentPeriodStartMillis: 1000,
      currentPeriodEndMillis: 1000 + MONTH_MS,
      createdAtMillis: 1000,
    }) as unknown as PiledriverObject);
    snapshot = await setManualChange(snapshot, manualChange("consume", "u-energy", "energy", -40, 5 * DAY_MS, null));
    const g = customerGroup("u-energy");
    expect(await balanceAt(snapshot, g, "energy", 5 * DAY_MS)).toBe(260);
    expect(await balanceAt(snapshot, g, "energy", 10 * DAY_MS + 1)).toBe(200);
    expect(await balanceAt(snapshot, g, "energy", 30 * DAY_MS + 1)).toBe(0);
  });

  it("does not stack when-repeated balances across a mid-period upgrade", async () => {
    /*
     * A "when-repeated" allowance must not carry over when the customer upgrades.
     *   free sub: 100 emails/month, ends day 10
     *   team sub: 500 emails/month, starts day 11
     * We tick past day 10 so the free grant expires before the upgrade lands.
     *
     * Expected emails right after the upgrade (day 11): 500, not 600.
     */
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.subscriptions, "sub-free", subscription("sub-free", {
      customerId: "u-upgrade",
      productId: "prod-free",
      product: product({ emails: { quantity: 100, repeat: [1, "month"], expires: "when-repeated" } }),
      status: "canceled",
      canceledAtMillis: 10 * DAY_MS,
      endedAtMillis: 10 * DAY_MS,
      currentPeriodEndMillis: MONTH_MS,
      createdAtMillis: 0,
    }) as unknown as PiledriverObject);
    snapshot = await set(snapshot, schema.subscriptions, "sub-team", subscription("sub-team", {
      customerId: "u-upgrade",
      productId: "prod-team",
      product: product({ emails: { quantity: 500, repeat: [1, "month"], expires: "when-repeated" } }),
      status: "canceled",
      cancelAtPeriodEnd: true,
      canceledAtMillis: 20 * DAY_MS,
      endedAtMillis: 20 * DAY_MS,
      currentPeriodStartMillis: 11 * DAY_MS,
      currentPeriodEndMillis: 11 * DAY_MS + MONTH_MS,
      createdAtMillis: 11 * DAY_MS,
    }) as unknown as PiledriverObject);
    snapshot = await snapshot.tick(new Date(11 * DAY_MS));
    expect(await balanceAt(snapshot, customerGroup("u-upgrade"), "emails", 11 * DAY_MS)).toBe(500);
  });
});

describe("item quantities: row invariants", () => {
  it("accumulates the running net across transactions", async () => {
    /*
     * t=1000  +10 bonus
     * t=2000  -3 bonus
     *
     * The materialized row is the running net, not just the last change.
     * Expected at t=2500: 7
     */
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("grant", "u", "bonus", 10, 1000, null));
    snapshot = await setManualChange(snapshot, manualChange("adjust", "u", "bonus", -3, 2000, null));
    expect(await balanceAt(snapshot, customerGroup("u"), "bonus", 2500)).toBe(7);
  });

  it("stamps every emitted row with the owning customer", async () => {
    /*
     * t=1000  +10 coins, expires at 5000
     *
     * Every emitted item-quantities row must carry the owning customer's tenancyId, customerType,
     * and customerId.
     */
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await setManualChange(snapshot, manualChange("g", "u1", "coins", 10, 1000, 5000));
    const rows = (await rowsBySortKey(snapshot, schema.itemQuantities, customerGroup("u1"))).map(row => asRecord(row.rowData));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tenancyId).toBe("t1");
      expect(row.customerType).toBe("user");
      expect(row.customerId).toBe("u1");
    }
  });
});
