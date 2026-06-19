import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { describe, expect, it } from "vitest";
import { declareInMemoryLowLevelDatabase } from "../../databases/low-level/implementations/in-memory.js";
import { declarePiledriverDatabase, PiledriverObject } from "../../databases/piledriver/index.js";
import { declareBulldozerDatabase } from "../../databases/bulldozer/index.js";
import { createPaymentsSchema } from "./index.js";
import type { CustomerType, ProductSnapshot, SubscriptionRow, TransactionRow } from "./types.js";

type Snapshot = Awaited<ReturnType<typeof initializedSnapshot>>;
type Row = { groupKey: PiledriverObject, rowIdentifier: string, rowSortKey: PiledriverObject, rowData: PiledriverObject };

const MONTH_MS = 2_592_000_000;
const byId = (a: Row, b: Row) => stringCompare(a.rowIdentifier, b.rowIdentifier);
const collect = async <T>(iterable: AsyncIterable<T>) => {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
};
const initializedSnapshot = async () => {
  const schema = createPaymentsSchema();
  const db = declareBulldozerDatabase(declarePiledriverDatabase(declareInMemoryLowLevelDatabase(crypto.randomUUID())), { migrations: schema.migrations });
  await db.applyRemainingMigrations();
  return (await db.getSnapshot()).snapshot;
};
const rows = async (snapshot: Snapshot, tableId: string, groupKey: PiledriverObject = null) =>
  (await collect(snapshot.listRowsInGroup({ tableId, groupKey, range: {} }))).sort(byId);
const rowDatas = async (snapshot: Snapshot, tableId: string, groupKey: PiledriverObject = null) =>
  (await rows(snapshot, tableId, groupKey)).map(row => row.rowData);
const rowsBySortKey = async (snapshot: Snapshot, tableId: string, groupKey: PiledriverObject = null) =>
  (await collect(snapshot.listRowsInGroup({ tableId, groupKey, range: {} }))).sort((a, b) => Number(a.rowSortKey) - Number(b.rowSortKey) || stringCompare(a.rowIdentifier, b.rowIdentifier));
const set = async (snapshot: Snapshot, tableId: string, rowIdentifier: string, newRowData: PiledriverObject | undefined) =>
  await snapshot.setOrDeleteRow({ tableId, rowIdentifier, newRowData });
const customerGroup = (customerId: string, customerType: CustomerType = "user"): PiledriverObject => ({ tenancyId: "t1", customerType, customerId });
const asRecord = (value: PiledriverObject) => value as Record<string, PiledriverObject>;

const product = (includedItems: ProductSnapshot["includedItems"] = {}): ProductSnapshot => ({
  displayName: "Test Plan",
  customerType: "user",
  productLineId: "line-main",
  prices: { p1: { USD: "10.00" } },
  includedItems,
});
const subscription = (id: string, overrides: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  id,
  tenancyId: "t1",
  customerId: `customer-${id}`,
  customerType: "user",
  productId: `prod-${id}`,
  priceId: "p1",
  product: product(),
  quantity: 1,
  stripeSubscriptionId: null,
  status: "active",
  currentPeriodStartMillis: 0,
  currentPeriodEndMillis: MONTH_MS,
  cancelAtPeriodEnd: false,
  canceledAtMillis: null,
  endedAtMillis: null,
  refundedAtMillis: null,
  productRevokedAtMillis: null,
  creationSource: "TEST_MODE",
  createdAtMillis: 0,
  ...overrides,
});

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
    expect(splits.map(row => ({ quantity: row.quantity, at: row.txnEffectiveAtMillis }))).toEqual([
      { quantity: 5, at: 4000 },
      { quantity: -5, at: 5000 },
    ]);
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

  it("does not compact item quantity changes across expiry boundaries", async () => {
    const schema = createPaymentsSchema();
    let snapshot = await initializedSnapshot();
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "boundary-before", {
      id: "boundary-before",
      tenancyId: "t1",
      customerId: "u-boundary",
      customerType: "user",
      itemId: "credits",
      quantity: 5,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 1000,
    });
    snapshot = await set(snapshot, schema.manualTransactions, "boundary-expire", {
      txnId: "boundary-expire",
      tenancyId: "t1",
      effectiveAtMillis: 1500,
      type: "refund",
      entries: [
        { type: "item-quantity-expire", customerType: "user", customerId: "u-boundary", adjustedTransactionId: "grant-before-boundary", adjustedEntryIndex: 0, quantity: 5, itemId: "credits" },
      ],
      customerType: "user",
      customerId: "u-boundary",
      paymentProvider: null,
      createdAtMillis: 1500,
    });
    snapshot = await set(snapshot, schema.manualItemQuantityChanges, "boundary-after", {
      id: "boundary-after",
      tenancyId: "t1",
      customerId: "u-boundary",
      customerType: "user",
      itemId: "credits",
      quantity: 7,
      description: null,
      expiresAtMillis: null,
      createdAtMillis: 2000,
    });

    const group = customerGroup("u-boundary");
    const compacted = (await rowDatas(snapshot, schema.compactedItemQuantityChangeEntries, group)).map(asRecord);
    expect(compacted.map(row => Number(row.quantity)).sort((a, b) => a - b)).toEqual([5, 7]);

    const finalEntries = (await rowDatas(snapshot, schema.compactedTransactionEntries, group)).map(asRecord);
    expect(finalEntries.map(row => String(row.type)).sort((a, b) => stringCompare(a, b))).toEqual([
      "compacted-item-quantity-change",
      "compacted-item-quantity-change",
      "item-quantity-expire",
    ]);

    const quantities = asRecord((await rowsBySortKey(snapshot, schema.itemQuantities, group)).at(-1)?.rowData ?? null);
    expect(asRecord(quantities.itemQuantities).credits).toBe(7);
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
