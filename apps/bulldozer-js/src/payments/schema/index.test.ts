import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { describe, expect, it } from "vitest";
import type { PiledriverObject } from "../../databases/piledriver/index.js";
import { createPaymentsSchema, mergeCompactionAggregates, repeatIntervalMs, type ItemCompactionAggregate, type ItemQuantityChangeEntry } from "./index.js";
import { asRecord, balanceAt, collect, customerGroup, initializedSnapshot, MONTH_MS, product, rowDatas, rowsBySortKey, set, subscription, type Snapshot } from "./schema-test-helpers.js";
import type { CustomerType, TransactionRow } from "./types.js";

describe("payments schema", () => {
  it("generates subscription renewal events and ignores creation invoices", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.subscriptions, "sub-renewal", subscription("sub-renewal", {
      stripeSubscriptionId: "stripe-sub-renewal",
      creationSource: "PURCHASE_PAGE",
      createdAtMillis: 1_000,
    }) as unknown as PiledriverObject);
    snapshot = await set(snapshot, schema.subscriptionInvoices, "inv-renewal", {
      id: "inv-renewal",
      tenancyId: "t1",
      stripeSubscriptionId: "stripe-sub-renewal",
      stripeInvoiceId: "stripe-inv-renewal",
      isSubscriptionCreationInvoice: false,
      status: "paid",
      amountTotal: 1000,
      hostedInvoiceUrl: null,
      createdAtMillis: 2_000,
    });
    snapshot = await set(snapshot, schema.subscriptionInvoices, "inv-creation", {
      id: "inv-creation",
      tenancyId: "t1",
      stripeSubscriptionId: "stripe-sub-renewal",
      stripeInvoiceId: "stripe-inv-creation",
      isSubscriptionCreationInvoice: true,
      status: "paid",
      amountTotal: 1000,
      hostedInvoiceUrl: null,
      createdAtMillis: 3_000,
    });

    const events = await rowDatas(snapshot, schema.subscriptionRenewalEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      subscriptionId: "sub-renewal",
      invoiceId: "inv-renewal",
      paymentProvider: "stripe",
      effectiveAtMillis: 2_000,
      chargedAmount: { USD: "10" },
    });
  });

  it("maps one-time purchases through events, transactions, owned products, and item quantities", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.oneTimePurchases, "otp-1", {
      id: "otp-1",
      tenancyId: "t1",
      customerId: "u-otp",
      customerType: "user",
      productId: "prod-coins",
      priceId: "p1",
      product: product({ coins: { quantity: 100, expires: "never" } }),
      quantity: 2,
      stripePaymentIntentId: "pi-1",
      revokedAtMillis: null,
      refundedAtMillis: null,
      creationSource: "PURCHASE_PAGE",
      createdAtMillis: 3_000,
    });

    const events = await rowDatas(snapshot, schema.oneTimePurchaseEvents);
    expect(events[0]).toMatchObject({ purchaseId: "otp-1", chargedAmount: { USD: "20" }, itemGrants: [{ itemId: "coins", quantity: 200, expiresWhen: null }] });

    const group = customerGroup("u-otp");
    const txns = (await rowDatas(snapshot, schema.transactions, group)) as unknown as TransactionRow[];
    expect(txns.map(txn => txn.txnId)).toEqual(["otp:otp-1"]);
    expect(txns[0].entries).toMatchObject([
      { type: "product-grant", productId: "prod-coins", oneTimePurchaseId: "otp-1" },
      { type: "money-transfer", chargedAmount: { USD: "20" } },
      { type: "item-quantity-change", itemId: "coins", quantity: 200 },
    ]);

    const owned = asRecord((await rowsBySortKey(snapshot, schema.ownedProducts, group)).at(-1)?.rowData ?? null);
    expect(asRecord(asRecord(owned.ownedProducts)["prod-coins"]).quantity).toBe(2);

    const quantities = asRecord((await rowDatas(snapshot, schema.itemQuantities, group)).at(-1) ?? null);
    expect(asRecord(quantities.itemQuantities).coins).toBe(200);
  });

  it("keeps grant entry indices aligned for a free non-test-mode one-time purchase on repeat", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.oneTimePurchases, "otp-free", {
      id: "otp-free",
      tenancyId: "t1",
      customerId: "u-otp-free",
      customerType: "user",
      productId: "prod-free",
      priceId: null,
      product: product({ credits: { quantity: 10, repeat: [1, "month"], expires: "when-repeated" } }),
      quantity: 1,
      stripePaymentIntentId: "pi-free",
      revokedAtMillis: null,
      refundedAtMillis: null,
      creationSource: "PURCHASE_PAGE",
      createdAtMillis: 0,
    });

    const group = customerGroup("u-otp-free");
    const txns = (await rowDatas(snapshot, schema.transactions, group)) as unknown as TransactionRow[];
    expect(txns[0].entries).toMatchObject([
      { type: "product-grant", productId: "prod-free" },
      { type: "item-quantity-change", itemId: "credits", quantity: 10 },
    ]);

    snapshot = await snapshot.tick(new Date(MONTH_MS));

    expect(await balanceAt(snapshot, group, "credits", 0)).toBe(10);
    expect(await balanceAt(snapshot, group, "credits", MONTH_MS)).toBe(10);
  });

  it("handles subscription start, repeat replacement, and end expiry", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.subscriptions, "sub-repeat", subscription("sub-repeat", {
      customerId: "u-repeat",
      productId: "prod-repeat",
      product: product({
        credits: { quantity: 10, repeat: [1, "month"], expires: "when-repeated" },
      }),
      currentPeriodEndMillis: 2 * MONTH_MS,
      endedAtMillis: 2 * MONTH_MS,
    }) as unknown as PiledriverObject);

    snapshot = await snapshot.tick(new Date(MONTH_MS));
    snapshot = await snapshot.tick(new Date(2 * MONTH_MS));

    const group = customerGroup("u-repeat");
    const txns = ((await rowDatas(snapshot, schema.transactions, group)) as unknown as TransactionRow[])
      .sort((a, b) => a.effectiveAtMillis - b.effectiveAtMillis || stringCompare(a.txnId, b.txnId));
    expect(txns.map(txn => txn.txnId)).toEqual(["sub-start:sub-repeat", `igr:sub-repeat:${MONTH_MS}`, "sub-end:sub-repeat"]);
    expect(txns[1].entries).toMatchObject([
      { type: "item-quantity-expire", adjustedTransactionId: "sub-start:sub-repeat", itemId: "credits", quantity: 10 },
      { type: "item-quantity-change", itemId: "credits", quantity: 10, expiresWhen: "when-repeated" },
    ]);
    expect(txns[2].entries).toMatchObject([
      { type: "active-subscription-end", subscriptionId: "sub-repeat" },
      { type: "product-revocation", adjustedTransactionId: "sub-start:sub-repeat", quantity: 1 },
      { type: "item-quantity-expire", adjustedTransactionId: `igr:sub-repeat:${MONTH_MS}`, itemId: "credits", quantity: 10 },
    ]);

    const quantities = (await rowsBySortKey(snapshot, schema.itemQuantities, group)).map(row => asRecord(row.rowData));
    expect(asRecord(quantities.at(-1)!.itemQuantities).credits).toBe(0);
    const owned = asRecord((await rowsBySortKey(snapshot, schema.ownedProducts, group)).at(-1)?.rowData ?? null);
    expect(asRecord(asRecord(owned.ownedProducts)["prod-repeat"]).quantity).toBe(0);
  });

  it("treats a manual item quantity change whose expiry is at/before its grant as a no-op", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    // expiresAtMillis (3000) is before createdAtMillis (4000): the grant is already expired,
    // so the net quantity must be 0, not a permanent grant.
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "manual-past-expiry", {
      id: "manual-past-expiry",
      tenancyId: "t1",
      customerId: "u-past",
      customerType: "user",
      itemId: "boosts",
      quantity: 4,
      description: null,
      expiresAtMillis: 3000,
      createdAtMillis: 4000,
    });

    const group = customerGroup("u-past");
    expect(await rowDatas(snapshot, schema.splitChanges, group)).toEqual([]);
    const quantities = (await rowsBySortKey(snapshot, schema.itemQuantities, group)).map(row => asRecord(row.rowData));
    const latest = quantities.at(-1);
    expect(latest === undefined ? 0 : Number(asRecord(latest.itemQuantities).boosts ?? 0)).toBe(0);
  });

  it("maps manual item quantity changes with absolute expiry", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "manual-1", {
      id: "manual-1",
      tenancyId: "t1",
      customerId: "u-manual",
      customerType: "user",
      itemId: "boosts",
      quantity: 5,
      description: null,
      expiresAtMillis: 5000,
      createdAtMillis: 4000,
    });

    const group = customerGroup("u-manual");
    const splits = (await rowDatas(snapshot, schema.splitChanges, group)).map(asRecord);
    // The grant is emitted with its expiry, plus a zero-quantity expire marker at the expiry time
    // that references the grant's id (so expiry drops that grant's remaining, not a blind -5).
    expect(splits.map(row => ({ quantity: row.quantity, at: row.txnEffectiveAtMillis }))).toEqual([
      { quantity: 5, at: 4000 },
      { quantity: 0, at: 5000 },
    ]);
    expect(splits[1].expireGrantId).toBe("miqc:manual-1:0");
    const quantities = (await rowDatas(snapshot, schema.itemQuantities, group)).map(asRecord);
    expect(asRecord(quantities[0].itemQuantities).boosts).toBe(5);
    expect(asRecord(quantities[1].itemQuantities).boosts).toBe(0);
  });

  it("compacts non-expiring item quantity changes by item", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "compact-a", {
      id: "compact-a",
      tenancyId: "t1",
      customerId: "u-compact",
      customerType: "user",
      itemId: "credits",
      quantity: 5,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 1000,
    });
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "compact-b", {
      id: "compact-b",
      tenancyId: "t1",
      customerId: "u-compact",
      customerType: "user",
      itemId: "credits",
      quantity: 7,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 2000,
    });

    const group = customerGroup("u-compact");
    const compacted = (await rowDatas(snapshot, schema.compactedItemQuantityChangeEntries, group)).map(asRecord);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).toMatchObject({
      type: "compacted-item-quantity-change",
      itemId: "credits",
      quantity: 12,
      expiresWhen: null,
    });
    expect(await rowDatas(snapshot, schema.nonCompactableItemQuantityChangeEntries, group)).toEqual([]);

    const quantities = asRecord((await rowsBySortKey(snapshot, schema.itemQuantities, group)).at(-1)?.rowData ?? null);
    expect(asRecord(quantities.itemQuantities).credits).toBe(12);
  });

  it("does not compact non-expiring changes across an expiring grant of the same item, and drops it on expiry", async () => {
    /*
     * credits timeline (one customer):
     *   t=1000  +5  (no expiry)         -> compactable "before" grant
     *   t=1000  +3  expires at 1500     -> a real, identity-bearing expiring grant
     *   t=2000  +7  (no expiry)         -> compactable "after" grant
     *
     * The expiring grant's expiry at 1500 is a per-item compaction boundary, so the +5 and +7
     * permanent changes must NOT merge into one compacted entry (they'd otherwise sum to 12 at t=1000
     * and corrupt point-in-time balances). The expiring grant then actually drops its remaining 3 at
     * 1500.
     */
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "perm-before", {
      id: "perm-before", tenancyId: "t1", customerId: "u-boundary", customerType: "user",
      itemId: "credits", quantity: 5, description: null, expiresAtMillis: null, createdAtMillis: 1000,
    });
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "expiring", {
      id: "expiring", tenancyId: "t1", customerId: "u-boundary", customerType: "user",
      itemId: "credits", quantity: 3, description: null, expiresAtMillis: 1500, createdAtMillis: 1000,
    });
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "perm-after", {
      id: "perm-after", tenancyId: "t1", customerId: "u-boundary", customerType: "user",
      itemId: "credits", quantity: 7, description: null, expiresAtMillis: null, createdAtMillis: 2000,
    });

    const group = customerGroup("u-boundary");
    // The two permanent grants stay as separate compacted entries (5 and 7), never merged to 12.
    const compacted = (await rowDatas(snapshot, schema.compactedItemQuantityChangeEntries, group)).map(asRecord);
    expect(compacted.map(row => Number(row.quantity)).sort((a, b) => a - b)).toEqual([5, 7]);

    expect(await balanceAt(snapshot, group, "credits", 1200)).toBe(8); // 5 + 3
    expect(await balanceAt(snapshot, group, "credits", 1600)).toBe(5); // expiring grant dropped
    expect(await balanceAt(snapshot, group, "credits", 2500)).toBe(12); // 5 + 7
  });

  it("passes refund manual transactions through and applies product revocation", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.manualTransactions, "refund-1", {
      txnId: "refund-1",
      tenancyId: "t1",
      effectiveAtMillis: 8000,
      type: "refund",
      entries: [{
        type: "product-revocation",
        customerType: "user",
        customerId: "u-refund",
        adjustedTransactionId: "otp:old",
        adjustedEntryIndex: 0,
        quantity: 1,
        productId: "prod-refund",
        productLineId: "line-refund",
      }],
      customerType: "user",
      customerId: "u-refund",
      paymentProvider: "stripe",
      createdAtMillis: 8000,
    });

    const group = customerGroup("u-refund");
    const txns = await rowDatas(snapshot, schema.transactions, group);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ txnId: "refund-1", type: "refund" });
    const owned = asRecord((await rowDatas(snapshot, schema.ownedProducts, group)).at(-1) ?? null);
    expect(asRecord(asRecord(owned.ownedProducts)["prod-refund"]).quantity).toBe(0);
  });

  it("maintains a per-customer subscription map", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.subscriptions, "sub-map-a", subscription("sub-map-a", { customerId: "u-map", createdAtMillis: 1000 }) as unknown as PiledriverObject);
    snapshot = await set(snapshot, schema.subscriptions, "sub-map-b", subscription("sub-map-b", { customerId: "u-map", createdAtMillis: 2000 }) as unknown as PiledriverObject);
    snapshot = await set(snapshot, schema.subscriptions, "sub-map-a", subscription("sub-map-a", { customerId: "u-map", status: "past_due", createdAtMillis: 3000 }) as unknown as PiledriverObject);

    const rowsForCustomer = (await rowsBySortKey(snapshot, schema.subscriptionMapByCustomer, customerGroup("u-map"))).map(row => asRecord(row.rowData));
    const latest = rowsForCustomer.at(-1);
    expect(Object.keys(asRecord(latest!.subscriptions)).sort()).toEqual(["sub-map-a", "sub-map-b"]);
    expect(asRecord(asRecord(latest!.subscriptions)["sub-map-a"]).status).toBe("past_due");
  });
});

describe("transactions-by-tenancy date index", () => {
  // The tenancy date index is what lets listTransactions read one page (~limit rows) in
  // newest-first order without scanning the whole tenancy. These tests pin the ordering,
  // cursor-range semantics, and tenancy isolation that the index.ts pagination relies on.
  const refundTxn = (opts: { txnId: string, customerId: string, createdAtMillis: number, tenancyId?: string, customerType?: CustomerType }) => ({
    txnId: opts.txnId,
    tenancyId: opts.tenancyId ?? "t1",
    effectiveAtMillis: opts.createdAtMillis,
    type: "refund" as const,
    entries: [] as unknown[],
    customerType: opts.customerType ?? "user",
    customerId: opts.customerId,
    paymentProvider: "stripe" as const,
    createdAtMillis: opts.createdAtMillis,
  });
  const setRefund = async (snapshot: Snapshot, opts: Parameters<typeof refundTxn>[0]) =>
    await set(snapshot, "payments-manual-transactions", opts.txnId, refundTxn(opts) as unknown as PiledriverObject);
  // Mirror the index.ts (createdAtMillis, txnId) recency key and its reverse-walk read.
  const recencyKey = (createdAtMillis: number, txnId: string): PiledriverObject => [createdAtMillis, txnId];
  const readPage = async (snapshot: Snapshot, tenancyId: string, opts: { lt?: PiledriverObject, limit?: number } = {}) =>
    (await collect(snapshot.listRowsInGroup({
      tableId: createPaymentsSchema().transactionsByTenancy,
      groupKey: { tenancyId },
      range: { reverse: true, lt: opts.lt, limit: opts.limit },
    }))).map(row => (row.rowData as unknown as TransactionRow).txnId);

  const seedTenancies = async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await setRefund(snapshot, { txnId: "r-a", customerId: "c1", createdAtMillis: 100 });
    snapshot = await setRefund(snapshot, { txnId: "r-b", customerId: "c2", createdAtMillis: 200 });
    snapshot = await setRefund(snapshot, { txnId: "r-c", customerId: "c1", createdAtMillis: 300 });
    snapshot = await setRefund(snapshot, { txnId: "r-d", customerId: "c2", createdAtMillis: 300 }); // tie at 300
    snapshot = await setRefund(snapshot, { txnId: "r-e", customerId: "c1", createdAtMillis: 400 });
    snapshot = await setRefund(snapshot, { txnId: "r-f", customerId: "c3", createdAtMillis: 250, tenancyId: "t2" });
    return { schema, snapshot };
  };

  it("orders a tenancy newest-first, breaking createdAt ties by txnId", async () => {
    const { snapshot } = await seedTenancies();
    expect(await readPage(snapshot, "t1")).toEqual(["r-e", "r-d", "r-c", "r-b", "r-a"]);
  });

  it("isolates tenancies", async () => {
    const { snapshot } = await seedTenancies();
    expect(await readPage(snapshot, "t2")).toEqual(["r-f"]);
  });

  it("pages with a cursor lower bound and covers every row exactly once", async () => {
    const { snapshot } = await seedTenancies();
    const page1 = await readPage(snapshot, "t1", { limit: 2 });
    expect(page1).toEqual(["r-e", "r-d"]);
    // Cursor from the last row of page1 (createdAtMillis=300, txnId="r-d").
    const page2 = await readPage(snapshot, "t1", { limit: 2, lt: recencyKey(300, "r-d") });
    expect(page2).toEqual(["r-c", "r-b"]);
    const page3 = await readPage(snapshot, "t1", { limit: 2, lt: recencyKey(200, "r-b") });
    expect(page3).toEqual(["r-a"]);
    expect([...page1, ...page2, ...page3]).toEqual(["r-e", "r-d", "r-c", "r-b", "r-a"]);
  });

  it("keeps per-customer reads scoped to that customer (the customer-scoped list path)", async () => {
    const { schema, snapshot } = await seedTenancies();
    const c1 = ((await rowDatas(snapshot, schema.transactions, customerGroup("c1"))) as unknown as TransactionRow[])
      .map(txn => txn.txnId).sort(stringCompare);
    expect(c1).toEqual(["r-a", "r-c", "r-e"]);
  });

  it("co-locates a source txn, its igr repeats, and refunds in one customer group (the single-group refund-read invariant)", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    // A subscription with a repeating, expiring item produces sub-start + igr repeat txns
    // in the customer's group; a refund for the source lands in the same group. The
    // index.ts refund reads depend on all of these living together.
    snapshot = await set(snapshot, schema.subscriptions, "sub-grant", subscription("sub-grant", {
      customerId: "u-grant",
      productId: "prod-grant",
      product: product({ credits: { quantity: 10, repeat: [1, "month"], expires: "when-repeated" } }),
      currentPeriodEndMillis: 2 * MONTH_MS,
    }) as unknown as PiledriverObject);
    snapshot = await snapshot.tick(new Date(MONTH_MS));
    snapshot = await setRefund(snapshot, { txnId: "refund:sub-start:sub-grant:uuid1", customerId: "u-grant", createdAtMillis: 5_000 });

    const txnIds = ((await rowDatas(snapshot, schema.transactions, customerGroup("u-grant"))) as unknown as TransactionRow[])
      .map(txn => txn.txnId).sort(stringCompare);
    expect(txnIds).toEqual([`igr:sub-grant:${MONTH_MS}`, "refund:sub-start:sub-grant:uuid1", "sub-start:sub-grant"]);
  });
});

describe("mergeCompactionAggregates", () => {
  const compactionEntry = (overrides: { itemId: string, quantity: number, txnId: string, index: number }): ItemQuantityChangeEntry => ({
    type: "item-quantity-change",
    index: overrides.index,
    txnId: overrides.txnId,
    txnEffectiveAtMillis: overrides.index,
    txnCreatedAtMillis: overrides.index,
    txnType: "manual-item-quantity-change",
    tenancyId: "t1",
    paymentProvider: null,
    customerType: "user",
    customerId: "c1",
    quantity: overrides.quantity,
    itemId: overrides.itemId,
    expiresWhen: null,
  });
  const aggregate = (txnId: string, index: number, items: Record<string, number>): ItemCompactionAggregate => ({
    type: "item-quantity-compaction-aggregate",
    txnEffectiveAtMillis: index,
    txnId,
    index,
    items: Object.fromEntries(
      Object.entries(items).map(([itemId, quantity]) => [itemId, { firstRow: compactionEntry({ itemId, quantity, txnId, index }), quantity }]),
    ),
  });
  const itemQuantities = (aggregate: ItemCompactionAggregate) =>
    Object.fromEntries(Object.entries(aggregate.items).map(([itemId, item]) => [itemId, item.quantity]));

  it("produces the same result regardless of merge grouping", () => {
    // overlapping (credits, seats, gpu) and distinct (ram) items cover both branches
    const a = aggregate("a", 0, { credits: 1, seats: 2 });
    const b = aggregate("b", 1, { credits: 3, gpu: 5 });
    const c = aggregate("c", 2, { seats: 7, gpu: 11, ram: 13 });

    const leftAssociative = mergeCompactionAggregates(mergeCompactionAggregates(a, b), c);
    const rightAssociative = mergeCompactionAggregates(a, mergeCompactionAggregates(b, c));

    expect(leftAssociative).toEqual(rightAssociative);
    expect(itemQuantities(leftAssociative)).toEqual({ credits: 4, seats: 9, gpu: 16, ram: 13 });
    expect(leftAssociative.txnId).toBe("a");
    expect(leftAssociative.index).toBe(0);
  });
});

describe("repeatIntervalMs", () => {
  const DAY_MS = 86_400_000;

  it("converts a positive interval to milliseconds", () => {
    expect(repeatIntervalMs([1, "day"])).toBe(DAY_MS);
    expect(repeatIntervalMs([2, "week"])).toBe(2 * 7 * DAY_MS);
    expect(repeatIntervalMs([1, "month"])).toBe(30 * DAY_MS);
    expect(repeatIntervalMs([1, "year"])).toBe(365 * DAY_MS);
  });

  it("treats a zero/negative/non-finite count as no-repeat (null)", () => {
    // A zero (or negative) repeat interval would produce a next-repeat time that
    // never advances, wedging the tick loop forever — so it must mean "no repeat".
    expect(repeatIntervalMs([0, "day"])).toBeNull();
    expect(repeatIntervalMs([-1, "month"])).toBeNull();
    expect(repeatIntervalMs([Number.NaN, "day"])).toBeNull();
  });

  it("treats 'never'/null/undefined as no-repeat (null)", () => {
    expect(repeatIntervalMs("never")).toBeNull();
    expect(repeatIntervalMs(null)).toBeNull();
    expect(repeatIntervalMs(undefined)).toBeNull();
  });
});
