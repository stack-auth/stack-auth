import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import {
  declareBulldozerDatabase,
  declareGroupByTable,
  declareLeftFoldTable,
  declareLeftJoinTable,
  declareTimeFoldTable,
  defineCompactTable,
  defineConcatTable,
  defineFilterTable,
  defineFlatMapTable,
  defineMapTable,
  defineSortTable,
  defineStoredTable,
} from "../../databases/bulldozer/index.js";
import type { PiledriverObject } from "../../databases/piledriver/index.js";
import type {
  CustomerType,
  DayInterval,
  IncludedItemConfig,
  ManualItemQuantityChangeRow,
  ManualTransactionRow,
  OneTimePurchaseRow,
  PaymentProvider,
  ProductSnapshot,
  SubscriptionInvoiceRow,
  SubscriptionRow,
  TransactionEntryData,
  TransactionRow,
} from "./types.js";

export type * from "./types.js";

type Migration = Parameters<typeof declareBulldozerDatabase>[1]["migrations"][number];
type InitTableStep = Extract<Migration[number], { type: "initTable" }>;
type Row = { groupKey: PiledriverObject, rowIdentifier: string, rowSortKey: PiledriverObject, rowData: PiledriverObject };
type ItemGrant = { itemId: string, quantity: number, expiresWhen: "when-purchase-expires" | "when-repeated" | null, expiresAtMillis: number | null };
type OutstandingGrant = { txnId: string, entryIndex: number, itemId: string, quantity: number, expiresWhen: "when-purchase-expires" | "when-repeated" | null };
type RepeatSchedule = Record<string, { quantity: number, expiresWhen: "when-purchase-expires" | "when-repeated" | null, repeatIntervalMs: number | null, nextRepeatMillis: number | null }>;
type SubscriptionFoldState = {
  subscriptionId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  productId: string | null,
  product: ProductSnapshot,
  productLineId: string | null,
  priceId: string | null,
  quantity: number,
  paymentProvider: PaymentProvider,
  endedAtMillis: number | null,
  productRevokedAtMillis: number | null,
  chargedAmount: Record<string, string>,
  startTxnId: string,
  startProductGrantEntryIndex: number,
  startItemChangeBaseIndex: number,
  itemRepeatSchedule: RepeatSchedule,
  outstandingGrants: OutstandingGrant[],
  repeatCount: number,
};
type OtpFoldState = {
  purchaseId: string,
  tenancyId: string,
  customerId: string,
  customerType: CustomerType,
  paymentProvider: PaymentProvider,
  revokedAtMillis: number | null,
  itemRepeatSchedule: RepeatSchedule,
  outstandingGrants: OutstandingGrant[],
  repeatCount: number,
};
export type ItemQuantityChangeEntry = {
  type: "item-quantity-change",
  index: number,
  txnId: string,
  txnEffectiveAtMillis: number,
  txnCreatedAtMillis: number,
  txnType: string,
  tenancyId: string,
  paymentProvider: PaymentProvider | null,
  customerType: CustomerType,
  customerId: string,
  quantity: number,
  itemId: string,
  expiresWhen: "when-purchase-expires" | "when-repeated" | number | null,
};
export type ItemCompactionAggregate = {
  type: "item-quantity-compaction-aggregate",
  txnEffectiveAtMillis: number,
  txnId: string,
  index: number,
  items: Record<string, { firstRow: ItemQuantityChangeEntry, quantity: number }>,
};
type ItemCompactionBoundary = {
  type: "item-quantity-compaction-boundary",
  txnEffectiveAtMillis: number,
  txnId: string,
  index: number,
  // The item this expiry belongs to; compaction windows are per-item, so a boundary only stops
  // merges of its own item.
  itemId: string,
};

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

const compareNumbers = (a: PiledriverObject, b: PiledriverObject) => Number(a) - Number(b);
const compareJson = (a: PiledriverObject, b: PiledriverObject) => stringCompare(JSON.stringify(a), JSON.stringify(b));
const table = (tableId: string, tableImplementation: InitTableStep["table"], inputTables: Record<string, string> = {}, debugMetadata?: InitTableStep["debugMetadata"]): InitTableStep => ({
  type: "initTable",
  tableId,
  table: tableImplementation,
  inputTables,
  debugMetadata,
});
const customerGroupKey = (row: { tenancyId: string, customerType: CustomerType, customerId: string }) => ({
  tenancyId: row.tenancyId,
  customerType: row.customerType,
  customerId: row.customerId,
});
const rowObject = <T>(rowData: PiledriverObject) => rowData as unknown as T;
const toPiledriverObject = (value: unknown): PiledriverObject => JSON.parse(JSON.stringify(value)) as PiledriverObject;
const tenancyGroupKey = (row: { tenancyId: string }) => ({ tenancyId: row.tenancyId });
// Recency key for the tenancy-wide list: newest-first ordering is (createdAtMillis, txnId).
// txnId is unique so it's a deterministic tiebreak for same-millisecond transactions, which
// keeps cursor paging stable.
const transactionRecencySortKey = (txn: TransactionRow): PiledriverObject => toPiledriverObject([txn.createdAtMillis, txn.txnId]);
const compareTransactionRecencyKeys = (a: PiledriverObject, b: PiledriverObject) => {
  const aKey = rowObject<[number, string]>(a);
  const bKey = rowObject<[number, string]>(b);
  return compareNumbers(aKey[0], bKey[0]) || stringCompare(aKey[1], bKey[1]);
};
const isObject = (value: PiledriverObject): value is Record<string, PiledriverObject> => typeof value === "object" && value !== null && !Array.isArray(value);
const paymentProvider = (creationSource: string): PaymentProvider => creationSource === "TEST_MODE" ? "test_mode" : "stripe";
export const repeatIntervalMs = (interval: DayInterval | "never" | null | undefined): number | null => {
  if (!Array.isArray(interval)) return null;
  const [count, unit] = interval;
  // A zero/negative (or non-finite) repeat count means "doesn't repeat". Without
  // this, count<=0 yields a next-repeat time that never advances, which the
  // timefold rejects ("nextTriggerTime must move forward") — and that throw lands
  // in the once-per-second tick loop, retrying forever. Treat it as no-repeat
  // instead. (count>0 is also false for NaN, so this covers garbage values too.)
  if (!(count > 0)) return null;
  switch (unit) {
    case "day": {
      return count * DAY_MS;
    }
    case "week": {
      return count * WEEK_MS;
    }
    case "month": {
      return count * MONTH_MS;
    }
    case "year": {
      return count * YEAR_MS;
    }
  }
};
const normalizedExpiresWhen = (item: IncludedItemConfig): "when-purchase-expires" | "when-repeated" | null =>
  item.expires === "when-purchase-expires" || item.expires === "when-repeated" ? item.expires : null;
const productLineId = (product: ProductSnapshot): string | null => product.productLineId ?? null;
const chargedAmount = (product: ProductSnapshot, priceId: string | null, quantity: number): Record<string, string> => {
  const price = priceId === null ? undefined : product.prices[priceId];
  const result: Record<string, string> = {};
  if (price === undefined) return result;
  for (const [currency, amount] of Object.entries(price)) {
    if (currency === "interval" || currency === "serverOnly" || currency === "freeTrial") continue;
    if (typeof amount !== "string" && typeof amount !== "number") continue;
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) continue;
    result[currency] = String(numeric * quantity);
  }
  return result;
};
// The concrete millis at which a stamped (subscription/one-time-purchase) grant expires, so the
// ledger can rank grants by real expiry (soonest-first) instead of treating them all as permanent.
// `when-repeated` grants drop at the sooner of their next reset or the purchase end; `when-purchase-
// expires` grants drop at the purchase end; `null` never expires. This always matches the time of
// the id-referencing expire marker that actually removes the grant (or is a harmless over-estimate
// when no marker ever fires — e.g. an ongoing purchase — in which case the grant stays live anyway).
const grantExpiryMillis = (
  expiresWhen: "when-purchase-expires" | "when-repeated" | null,
  nextResetMillis: number | null,
  endMillis: number | null,
): number | null => {
  const candidates: number[] = [];
  if (expiresWhen === "when-repeated" && nextResetMillis !== null) candidates.push(nextResetMillis);
  if ((expiresWhen === "when-repeated" || expiresWhen === "when-purchase-expires") && endMillis !== null) candidates.push(endMillis);
  return candidates.length === 0 ? null : Math.min(...candidates);
};
const itemGrants = (product: ProductSnapshot, quantity: number, anchorMillis: number, endMillis: number | null): ItemGrant[] => Object.entries(product.includedItems).map(([itemId, item]) => {
  const expiresWhen = normalizedExpiresWhen(item);
  const intervalMs = repeatIntervalMs(item.repeat);
  return {
    itemId,
    quantity: item.quantity * quantity,
    expiresWhen,
    expiresAtMillis: grantExpiryMillis(expiresWhen, intervalMs === null ? null : anchorMillis + intervalMs, endMillis),
  };
});
const repeatSchedule = (product: ProductSnapshot, quantity: number, anchorMillis: number): RepeatSchedule => Object.fromEntries(
  Object.entries(product.includedItems).map(([itemId, item]) => {
    const intervalMs = repeatIntervalMs(item.repeat);
    return [itemId, {
      quantity: item.quantity * quantity,
      expiresWhen: normalizedExpiresWhen(item),
      repeatIntervalMs: intervalMs,
      nextRepeatMillis: intervalMs === null ? null : anchorMillis + intervalMs,
    }];
  }),
);
const outstandingGrants = (product: ProductSnapshot, quantity: number, txnId: string, baseIndex: number): OutstandingGrant[] =>
  Object.entries(product.includedItems).map(([itemId, item], index) => ({
    txnId,
    entryIndex: baseIndex + index,
    itemId,
    quantity: item.quantity * quantity,
    expiresWhen: normalizedExpiresWhen(item),
  }));
const soonestNextMillis = (state: { itemRepeatSchedule: RepeatSchedule }, endMillis: number | null): number | null => {
  const candidates = Object.values(state.itemRepeatSchedule).flatMap(schedule => schedule.nextRepeatMillis === null ? [] : [schedule.nextRepeatMillis]);
  if (endMillis !== null) candidates.push(endMillis);
  return candidates.length === 0 ? null : Math.min(...candidates);
};
const dateFromMillis = (millis: number | null): Date | null => millis === null ? null : new Date(millis);
const dueItemEntries = (state: { itemRepeatSchedule: RepeatSchedule }, currentMillis: number) =>
  Object.entries(state.itemRepeatSchedule).filter(([, schedule]) => schedule.nextRepeatMillis !== null && schedule.nextRepeatMillis <= currentMillis);
const grantRefsToExpire = (grants: OutstandingGrant[], expiresWhen: "when-repeated" | "when-purchase-expires" | "both", dueItemIds?: Set<string>) =>
  grants
    .filter(grant => (expiresWhen === "both" ? grant.expiresWhen === "when-repeated" || grant.expiresWhen === "when-purchase-expires" : grant.expiresWhen === expiresWhen))
    .filter(grant => dueItemIds === undefined || dueItemIds.has(grant.itemId))
    .map(grant => ({ transactionId: grant.txnId, entryIndex: grant.entryIndex, itemId: grant.itemId, quantity: grant.quantity }));

function subscriptionInitialState(row: SubscriptionRow): SubscriptionFoldState {
  const provider = paymentProvider(row.creationSource);
  const charged = chargedAmount(row.product, row.priceId, row.quantity);
  const hasMoneyTransfer = provider !== "test_mode" && Object.keys(charged).length > 0;
  const startTxnId = `sub-start:${row.id}`;
  return {
    subscriptionId: row.id,
    tenancyId: row.tenancyId,
    customerId: row.customerId,
    customerType: row.customerType,
    productId: row.productId,
    product: row.product,
    productLineId: productLineId(row.product),
    priceId: row.priceId,
    quantity: row.quantity,
    paymentProvider: provider,
    endedAtMillis: row.endedAtMillis,
    productRevokedAtMillis: row.productRevokedAtMillis,
    chargedAmount: charged,
    startTxnId,
    // These indices must match the entry order in payments-txn-subscription-start:
    // [0] sub-start, [1] product-grant, [2] money-transfer (only if charged), then
    // item changes. If you reorder entries there, update these too.
    startProductGrantEntryIndex: 1,
    startItemChangeBaseIndex: hasMoneyTransfer ? 3 : 2,
    itemRepeatSchedule: repeatSchedule(row.product, row.quantity, row.createdAtMillis),
    outstandingGrants: outstandingGrants(row.product, row.quantity, startTxnId, hasMoneyTransfer ? 3 : 2),
    repeatCount: 0,
  };
}

function subscriptionStartEvent(row: SubscriptionRow) {
  const provider = paymentProvider(row.creationSource);
  return {
    type: "subscription-start",
    subscriptionId: row.id,
    tenancyId: row.tenancyId,
    customerId: row.customerId,
    customerType: row.customerType,
    productId: row.productId,
    product: row.product,
    productLineId: productLineId(row.product),
    priceId: row.priceId,
    quantity: row.quantity,
    chargedAmount: chargedAmount(row.product, row.priceId, row.quantity),
    itemGrants: itemGrants(row.product, row.quantity, row.createdAtMillis, row.endedAtMillis),
    paymentProvider: provider,
    effectiveAtMillis: row.createdAtMillis,
    createdAtMillis: row.createdAtMillis,
  };
}

function subscriptionEndEvent(state: SubscriptionFoldState) {
  return {
    type: "subscription-end",
    subscriptionId: state.subscriptionId,
    tenancyId: state.tenancyId,
    customerId: state.customerId,
    customerType: state.customerType,
    productId: state.productId,
    productLineId: state.productLineId,
    quantity: state.quantity,
    startProductGrantRef: { transactionId: state.startTxnId, entryIndex: state.startProductGrantEntryIndex },
    itemQuantityChangesToExpire: grantRefsToExpire(state.outstandingGrants, "both"),
    productRevokedAtMillis: state.productRevokedAtMillis,
    paymentProvider: state.paymentProvider,
    effectiveAtMillis: state.endedAtMillis,
    createdAtMillis: state.endedAtMillis,
  };
}

function subscriptionRepeatStep(state: SubscriptionFoldState, currentMillis: number): { state: SubscriptionFoldState, event: PiledriverObject } {
  const dueItems = dueItemEntries(state, currentMillis);
  const dueIds = new Set(dueItems.map(([itemId]) => itemId));
  const previousGrantsToExpire = grantRefsToExpire(state.outstandingGrants, "when-repeated", dueIds);
  const nextSchedule = Object.fromEntries(Object.entries(state.itemRepeatSchedule).map(([itemId, schedule]) => [
    itemId,
    schedule.nextRepeatMillis !== null && schedule.nextRepeatMillis <= currentMillis && schedule.repeatIntervalMs !== null
      ? { ...schedule, nextRepeatMillis: schedule.nextRepeatMillis + schedule.repeatIntervalMs }
      : schedule,
  ]));
  const itemRepeatGrants = dueItems.map(([itemId, schedule]) => ({ itemId, quantity: schedule.quantity, expiresWhen: schedule.expiresWhen, expiresAtMillis: grantExpiryMillis(schedule.expiresWhen, nextSchedule[itemId].nextRepeatMillis, state.endedAtMillis) }));
  const txnId = `igr:${state.subscriptionId}:${currentMillis}`;
  const nextOutstanding = [
    ...state.outstandingGrants.filter(grant => !(grant.expiresWhen === "when-repeated" && dueIds.has(grant.itemId))),
    ...dueItems.map(([itemId, schedule], index) => ({ txnId, entryIndex: previousGrantsToExpire.length + index, itemId, quantity: schedule.quantity, expiresWhen: schedule.expiresWhen })),
  ];
  return {
    state: { ...state, outstandingGrants: nextOutstanding, itemRepeatSchedule: nextSchedule, repeatCount: state.repeatCount + 1 },
    event: toPiledriverObject({
      type: "item-grant-repeat",
      sourceType: "subscription",
      sourceId: state.subscriptionId,
      tenancyId: state.tenancyId,
      customerId: state.customerId,
      customerType: state.customerType,
      itemGrants: itemRepeatGrants,
      previousGrantsToExpire,
      paymentProvider: state.paymentProvider,
      effectiveAtMillis: currentMillis,
      createdAtMillis: currentMillis,
    }),
  };
}

function otpInitialState(row: OneTimePurchaseRow): OtpFoldState {
  const provider = paymentProvider(row.creationSource);
  const hasMoneyTransfer = provider !== "test_mode" && Object.keys(chargedAmount(row.product, row.priceId, row.quantity)).length > 0;
  const txnId = `otp:${row.id}`;
  return {
    purchaseId: row.id,
    tenancyId: row.tenancyId,
    customerId: row.customerId,
    customerType: row.customerType,
    paymentProvider: provider,
    revokedAtMillis: row.revokedAtMillis,
    itemRepeatSchedule: Object.fromEntries(Object.entries(repeatSchedule(row.product, row.quantity, row.createdAtMillis)).filter(([, schedule]) => schedule.repeatIntervalMs !== null)),
    // Must match entry order in payments-txn-one-time-purchase: [0] product-grant,
    // [1] money-transfer (only if charged), then item changes.
    outstandingGrants: outstandingGrants(row.product, row.quantity, txnId, hasMoneyTransfer ? 2 : 1),
    repeatCount: 0,
  };
}

function otpRepeatStep(state: OtpFoldState, currentMillis: number): { state: OtpFoldState, event: PiledriverObject } {
  const dueItems = dueItemEntries(state, currentMillis);
  const dueIds = new Set(dueItems.map(([itemId]) => itemId));
  const previousGrantsToExpire = grantRefsToExpire(state.outstandingGrants, "when-repeated", dueIds);
  const nextSchedule = Object.fromEntries(Object.entries(state.itemRepeatSchedule).map(([itemId, schedule]) => [
    itemId,
    schedule.nextRepeatMillis !== null && schedule.nextRepeatMillis <= currentMillis && schedule.repeatIntervalMs !== null
      ? { ...schedule, nextRepeatMillis: schedule.nextRepeatMillis + schedule.repeatIntervalMs }
      : schedule,
  ]));
  const itemRepeatGrants = dueItems.map(([itemId, schedule]) => ({ itemId, quantity: schedule.quantity, expiresWhen: schedule.expiresWhen, expiresAtMillis: grantExpiryMillis(schedule.expiresWhen, nextSchedule[itemId].nextRepeatMillis, state.revokedAtMillis) }));
  const txnId = `igr:${state.purchaseId}:${currentMillis}`;
  const nextOutstanding = [
    ...state.outstandingGrants.filter(grant => !(grant.expiresWhen === "when-repeated" && dueIds.has(grant.itemId))),
    ...dueItems.map(([itemId, schedule], index) => ({ txnId, entryIndex: previousGrantsToExpire.length + index, itemId, quantity: schedule.quantity, expiresWhen: schedule.expiresWhen })),
  ];
  return {
    state: { ...state, outstandingGrants: nextOutstanding, itemRepeatSchedule: nextSchedule, repeatCount: state.repeatCount + 1 },
    event: toPiledriverObject({
      type: "item-grant-repeat",
      sourceType: "one_time_purchase",
      sourceId: state.purchaseId,
      tenancyId: state.tenancyId,
      customerId: state.customerId,
      customerType: state.customerType,
      itemGrants: itemRepeatGrants,
      previousGrantsToExpire,
      paymentProvider: state.paymentProvider,
      effectiveAtMillis: currentMillis,
      createdAtMillis: currentMillis,
    }),
  };
}

const sortTxnRows = (rows: TransactionRow[]) => rows.sort((a, b) => a.effectiveAtMillis - b.effectiveAtMillis || stringCompare(a.txnId, b.txnId));
// A live grant in the item-quantities ledger. `q` is the granted amount minus any frozen debt baked
// in at arrival (see the fold reducer). `e` is the grant's expiry (null = never; sorted last). `id`
// is the granting entry's identity (`${txnId}:${entryIndex}`) so an expiry can drop the *specific*
// grant it belongs to; `id` is null for grants that can never be expired (permanent/compacted).
type LedgerGrant = { q: number, e: number | null, id: string | null };
// Per-item ledger state. `consumption` is the running total of covered removals, distributed over
// the grants soonest-expiring-first (never materialized — recomputed on demand), so a later,
// sooner-expiring grant automatically absorbs it (reassignment). `debt` is removals that had no
// grant to land on; it freezes onto the first grant(s) to arrive (baked into their `q`) and never
// reassigns. Balance = sum(grant.q) - consumption - debt.
type LedgerItemState = { grants: LedgerGrant[], consumption: number, debt: number };
type LedgerState = Record<string, LedgerItemState>;
const grantExpiry = (grant: LedgerGrant) => grant.e ?? Number.POSITIVE_INFINITY;
// Soonest-expiring first, with a stable id tiebreak so the soonest-first distribution is
// deterministic among grants that expire at the same instant.
const compareGrantsByExpiry = (a: LedgerGrant, b: LedgerGrant) => grantExpiry(a) - grantExpiry(b) || stringCompare(a.id ?? "", b.id ?? "");
const sumGrantQuantities = (grants: LedgerGrant[]) => grants.reduce((sum, grant) => sum + grant.q, 0);
const sumItemQuantity = (item: LedgerItemState) => sumGrantQuantities(item.grants) - item.consumption - item.debt;
const currentItemQuantities = (state: LedgerState) => Object.fromEntries(Object.keys(state).map(itemId => [itemId, sumItemQuantity(state[itemId])]));
const isCompactionBoundary = (value: PiledriverObject): value is ItemCompactionBoundary =>
  isObject(value) && value.type === "item-quantity-compaction-boundary";
const compactableEntryToAggregate = (entry: ItemQuantityChangeEntry): ItemCompactionAggregate => ({
  type: "item-quantity-compaction-aggregate",
  txnEffectiveAtMillis: entry.txnEffectiveAtMillis,
  txnId: entry.txnId,
  index: entry.index,
  items: {
    [entry.itemId]: { firstRow: entry, quantity: entry.quantity },
  },
});
const asCompactionAggregate = (value: PiledriverObject): ItemCompactionAggregate => {
  if (isObject(value) && value.type === "item-quantity-compaction-aggregate") return rowObject<ItemCompactionAggregate>(value);
  return compactableEntryToAggregate(rowObject<ItemQuantityChangeEntry>(value));
};
// The compact table merges rows in any order, so this merge has to be associative:
// merge(a, merge(b, c)) === merge(merge(a, b), c). Keep it that way (there's a test
// in index.test.ts) — quantities are summed and the header/firstRow come from `a`.
export const mergeCompactionAggregates = (a: ItemCompactionAggregate, b: ItemCompactionAggregate): ItemCompactionAggregate => {
  const items = new Map(Object.entries(a.items));
  for (const [itemId, item] of Object.entries(b.items)) {
    const existing = items.get(itemId);
    items.set(itemId, existing === undefined
      ? item
      : { firstRow: existing.firstRow, quantity: existing.quantity + item.quantity });
  }
  return { type: "item-quantity-compaction-aggregate", txnEffectiveAtMillis: a.txnEffectiveAtMillis, txnId: a.txnId, index: a.index, items: Object.fromEntries(items) };
};
// The item a compaction row belongs to: boundaries carry `itemId`; aggregates hold exactly one item
// (single-item at creation, and the compactor only merges same-item aggregates), so its sole key.
const compactionRowItemId = (value: PiledriverObject): string => {
  if (isCompactionBoundary(value)) return value.itemId;
  return Object.keys(rowObject<ItemCompactionAggregate>(value).items)[0] ?? throwErr("compaction aggregate has no item");
};
const compactionSortKey = (row: { rowIdentifier: string, rowData: PiledriverObject }) => {
  const data = rowObject<{ txnEffectiveAtMillis: number, txnId?: string, index?: number, type?: string }>(row.rowData);
  return {
    itemId: compactionRowItemId(row.rowData),
    txnEffectiveAtMillis: data.txnEffectiveAtMillis,
    boundaryOrder: data.type === "item-quantity-compaction-boundary" ? 0 : 1,
    txnId: data.txnId ?? row.rowIdentifier,
    index: data.index ?? 0,
    rowIdentifier: row.rowIdentifier,
  };
};
const compareCompactionSortKeys = (a: PiledriverObject, b: PiledriverObject) => {
  const left = rowObject<{ itemId: string, txnEffectiveAtMillis: number, boundaryOrder: number, txnId: string, index: number, rowIdentifier: string }>(a);
  const right = rowObject<{ itemId: string, txnEffectiveAtMillis: number, boundaryOrder: number, txnId: string, index: number, rowIdentifier: string }>(b);
  // itemId first so each item's compactable changes are contiguous (the compactor only merges
  // adjacent same-item aggregates); an interleaving other item would otherwise split them.
  return stringCompare(left.itemId, right.itemId)
    || left.txnEffectiveAtMillis - right.txnEffectiveAtMillis
    || left.boundaryOrder - right.boundaryOrder
    || stringCompare(left.txnId, right.txnId)
    || left.index - right.index
    || stringCompare(left.rowIdentifier, right.rowIdentifier);
};

// Ledger tie-order for equal-timestamp changes: apply non-expiry changes before expiry markers
// (so a removal at the expiry instant lands before the grant is dropped), then soonest-expiring
// grants first (so removals/debt hit the grant that will expire first), then positive before
// negative, then a stable id tiebreak.
const ledgerSortKey = (row: { rowIdentifier: string, rowData: PiledriverObject }) => {
  const data = rowObject<{ txnEffectiveAtMillis: number, quantity: number, expiresAtMillis: number | null, grantId?: string | null, expireGrantId?: string | null, txnId?: string }>(row.rowData);
  return {
    txnEffectiveAtMillis: data.txnEffectiveAtMillis,
    kind: (data.expireGrantId ?? null) !== null ? 1 : 0,
    expiresAtMillis: data.expiresAtMillis ?? null,
    sign: data.quantity < 0 ? 1 : 0,
    id: data.grantId ?? data.expireGrantId ?? data.txnId ?? row.rowIdentifier,
  };
};
const compareLedgerSortKeys = (a: PiledriverObject, b: PiledriverObject) => {
  const left = rowObject<{ txnEffectiveAtMillis: number, kind: number, expiresAtMillis: number | null, sign: number, id: string }>(a);
  const right = rowObject<{ txnEffectiveAtMillis: number, kind: number, expiresAtMillis: number | null, sign: number, id: string }>(b);
  return left.txnEffectiveAtMillis - right.txnEffectiveAtMillis
    || left.kind - right.kind
    || (left.expiresAtMillis ?? Number.POSITIVE_INFINITY) - (right.expiresAtMillis ?? Number.POSITIVE_INFINITY)
    || left.sign - right.sign
    || stringCompare(left.id, right.id);
};

// Builds one compaction sub-pipeline for a single sign of non-expiring changes. Compaction must
// only ever merge changes of the *same* sign: a non-expiring deduction has to reach the ledger as a
// deduction so it consumes the soonest-expiring grant. If we merged it with permanent grants
// (opposite sign) it would silently net against them and never touch the expiring grant. The
// `boundaries` input (one marker per item-quantity-expire) is shared across both signs so neither
// merges across an expiry event in time.
const compactionSubPipelineSteps = (suffix: string, signedAggregatesTable: string, boundariesTable: string): { steps: InitTableStep[], output: string } => {
  const inputTable = `payments-entries-compaction-input-${suffix}`;
  const sortedTable = `${inputTable}-sorted`;
  const rawTable = `payments-entries-compacted-raw-${suffix}`;
  const aggregatesTable = `payments-entries-compacted-aggregates-${suffix}`;
  const output = `payments-entries-compacted-item-quantity-change-${suffix}`;
  return {
    output,
    steps: [
      table(inputTable, defineConcatTable(), { compactable: signedAggregatesTable, boundary: boundariesTable }),
      table(sortedTable, defineSortTable({ sortKeyExtractor: compactionSortKey, sortKeyComparator: compareCompactionSortKeys }), { input: inputTable }),
      table(rawTable, defineCompactTable({
        compactor: (left, right) => {
          // A boundary (an expiry of this item) stops the merge; different items never merge (the
          // sort groups by item, so this only happens at the edge between two items' windows).
          if (isCompactionBoundary(left) || isCompactionBoundary(right)) return [{ newRowData: left }, { newRowData: right }];
          if (compactionRowItemId(left) !== compactionRowItemId(right)) return [{ newRowData: left }, { newRowData: right }];
          return [{ newRowData: toPiledriverObject(mergeCompactionAggregates(asCompactionAggregate(left), asCompactionAggregate(right))) }];
        },
      }), { input: sortedTable }),
      table(aggregatesTable, defineFilterTable(row => rowObject<{ type: string }>(row.rowData).type === "item-quantity-compaction-aggregate"), { input: rawTable }),
      table(output, defineFlatMapTable(row => {
        const aggregate = rowObject<ItemCompactionAggregate>(row.rowData);
        return Object.values(aggregate.items).map(item => toPiledriverObject({
          ...item.firstRow,
          type: "compacted-item-quantity-change",
          quantity: item.quantity,
          expiresWhen: null,
        }));
      }), { input: aggregatesTable }),
    ],
  };
};

export function createPaymentsSchema() {
  const positiveCompaction = compactionSubPipelineSteps("positive", "payments-entries-item-quantity-change-compactable-positive-aggregates", "payments-entries-compaction-boundaries");
  const negativeCompaction = compactionSubPipelineSteps("negative", "payments-entries-item-quantity-change-compactable-negative-aggregates", "payments-entries-compaction-boundaries");
  const migrations: Migration[] = [[
    table("payments-subscriptions", defineStoredTable()),
    table("payments-subscription-invoices", defineStoredTable()),
    table("payments-one-time-purchases", defineStoredTable()),
    table("payments-manual-item-quantity-changes", defineStoredTable()),
    table("payments-manual-transactions", defineStoredTable()),

    table("payments-subscriptions-with-invoices", declareLeftJoinTable({
      leftJoinKeyExtractor: async row => {
        const invoice = rowObject<SubscriptionInvoiceRow>(row.rowData);
        return { tenancyId: invoice.tenancyId, stripeSubscriptionId: invoice.stripeSubscriptionId };
      },
      rightJoinKeyExtractor: async row => {
        const subscription = rowObject<SubscriptionRow>(row.rowData);
        return { tenancyId: subscription.tenancyId, stripeSubscriptionId: subscription.stripeSubscriptionId };
      },
      joinKeyComparator: compareJson,
      joiner: async (left, right) => ({ leftRowData: left.rowData, rightRowData: right?.rowData ?? null }),
    }), { left: "payments-subscription-invoices", right: "payments-subscriptions" }),
    table("payments-renewal-invoice-rows", defineFilterTable(row => {
      const joined = rowObject<{ leftRowData: SubscriptionInvoiceRow, rightRowData: SubscriptionRow | null }>(row.rowData);
      return joined.rightRowData !== null && !joined.leftRowData.isSubscriptionCreationInvoice;
    }), { input: "payments-subscriptions-with-invoices" }),
    table("payments-subscription-renewal-events", defineMapTable(row => {
      const joined = rowObject<{ leftRowData: SubscriptionInvoiceRow, rightRowData: SubscriptionRow }>(row.rowData);
      const sub = joined.rightRowData;
      const invoice = joined.leftRowData;
      return toPiledriverObject({
        subscriptionId: sub.id,
        tenancyId: sub.tenancyId,
        customerId: sub.customerId,
        customerType: sub.customerType,
        invoiceId: invoice.id,
        chargedAmount: chargedAmount(sub.product, sub.priceId, sub.quantity),
        paymentProvider: paymentProvider(sub.creationSource),
        effectiveAtMillis: invoice.createdAtMillis,
        createdAtMillis: invoice.createdAtMillis,
      });
    }), { input: "payments-renewal-invoice-rows" }),
    table("payments-cancel-pending-subscriptions", defineFilterTable(row => {
      const sub = rowObject<SubscriptionRow>(row.rowData);
      return sub.cancelAtPeriodEnd && (sub.status === "active" || sub.status === "trialing");
    }), { input: "payments-subscriptions" }),
    table("payments-subscription-cancel-events", defineMapTable(row => {
      const sub = rowObject<SubscriptionRow>(row.rowData);
      return toPiledriverObject({
        subscriptionId: sub.id,
        tenancyId: sub.tenancyId,
        customerId: sub.customerId,
        customerType: sub.customerType,
        changeType: "cancel",
        paymentProvider: paymentProvider(sub.creationSource),
        effectiveAtMillis: sub.canceledAtMillis ?? sub.createdAtMillis,
        createdAtMillis: sub.createdAtMillis,
      });
    }), { input: "payments-cancel-pending-subscriptions" }),
    table("payments-subscription-timefold", declareTimeFoldTable({
      initialState: {},
      reducer: async (_state, row, triggerTime) => {
        if (triggerTime === null) {
          const sub = rowObject<SubscriptionRow>(row.rowData);
          const initial = subscriptionInitialState(sub);
          const hasRepeat = Object.values(initial.itemRepeatSchedule).some(schedule => schedule.nextRepeatMillis !== null);
          const immediateEnd = initial.endedAtMillis !== null && !hasRepeat && initial.endedAtMillis < sub.currentPeriodEndMillis;
          const events = immediateEnd ? [subscriptionStartEvent(sub), subscriptionEndEvent(initial)] : [subscriptionStartEvent(sub)];
          return { newState: toPiledriverObject(initial), newRowData: toPiledriverObject(events), nextTriggerTime: immediateEnd ? null : dateFromMillis(soonestNextMillis(initial, initial.endedAtMillis)) };
        }
        const state = rowObject<SubscriptionFoldState>(_state);
        const currentMillis = triggerTime.getTime();
        if (state.endedAtMillis !== null && state.endedAtMillis <= currentMillis) {
          return { newState: _state, newRowData: toPiledriverObject([subscriptionEndEvent(state)]), nextTriggerTime: null };
        }
        const repeat = subscriptionRepeatStep(state, currentMillis);
        return { newState: toPiledriverObject(repeat.state), newRowData: toPiledriverObject([repeat.event]), nextTriggerTime: dateFromMillis(soonestNextMillis(repeat.state, repeat.state.endedAtMillis)) };
      },
    }), { input: "payments-subscriptions" }),
    table("payments-subscription-timefold-events", defineFlatMapTable(row => Array.isArray(row.rowData) ? row.rowData : []), { input: "payments-subscription-timefold" }),
    table("payments-subscription-start-events", defineFilterTable(row => isObject(row.rowData) && row.rowData.type === "subscription-start"), { input: "payments-subscription-timefold-events" }),
    table("payments-subscription-end-events", defineFilterTable(row => isObject(row.rowData) && row.rowData.type === "subscription-end"), { input: "payments-subscription-timefold-events" }),
    table("payments-item-grant-repeat-from-subscriptions", defineFilterTable(row => isObject(row.rowData) && row.rowData.type === "item-grant-repeat"), { input: "payments-subscription-timefold-events" }),

    table("payments-one-time-purchase-events", defineMapTable(row => {
      const purchase = rowObject<OneTimePurchaseRow>(row.rowData);
      return toPiledriverObject({
        purchaseId: purchase.id,
        tenancyId: purchase.tenancyId,
        customerId: purchase.customerId,
        customerType: purchase.customerType,
        productId: purchase.productId,
        product: purchase.product,
        productLineId: productLineId(purchase.product),
        priceId: purchase.priceId,
        quantity: purchase.quantity,
        chargedAmount: chargedAmount(purchase.product, purchase.priceId, purchase.quantity),
        itemGrants: itemGrants(purchase.product, purchase.quantity, purchase.createdAtMillis, purchase.revokedAtMillis),
        paymentProvider: paymentProvider(purchase.creationSource),
        effectiveAtMillis: purchase.createdAtMillis,
        createdAtMillis: purchase.createdAtMillis,
      });
    }), { input: "payments-one-time-purchases" }),
    table("payments-otp-timefold", declareTimeFoldTable({
      initialState: {},
      reducer: async (_state, row, triggerTime) => {
        if (triggerTime === null) {
          const purchase = rowObject<OneTimePurchaseRow>(row.rowData);
          const initial = otpInitialState(purchase);
          const next = soonestNextMillis(initial, null);
          const cappedNext = initial.revokedAtMillis !== null && next !== null && next > initial.revokedAtMillis ? null : next;
          return { newState: toPiledriverObject(initial), newRowData: [], nextTriggerTime: dateFromMillis(cappedNext) };
        }
        const state = rowObject<OtpFoldState>(_state);
        const repeat = otpRepeatStep(state, triggerTime.getTime());
        const next = soonestNextMillis(repeat.state, null);
        const cappedNext = repeat.state.revokedAtMillis !== null && next !== null && next > repeat.state.revokedAtMillis ? null : next;
        return { newState: toPiledriverObject(repeat.state), newRowData: toPiledriverObject([repeat.event]), nextTriggerTime: dateFromMillis(cappedNext) };
      },
    }), { input: "payments-one-time-purchases" }),
    table("payments-otp-timefold-events", defineFlatMapTable(row => Array.isArray(row.rowData) ? row.rowData : []), { input: "payments-otp-timefold" }),
    table("payments-item-grant-repeat-from-otps", defineFilterTable(row => isObject(row.rowData) && row.rowData.type === "item-grant-repeat"), { input: "payments-otp-timefold-events" }),
    table("payments-item-grant-repeat-events", defineConcatTable(), { subscription: "payments-item-grant-repeat-from-subscriptions", otp: "payments-item-grant-repeat-from-otps" }),
    table("payments-manual-item-quantity-change-events", defineMapTable(row => {
      const change = rowObject<ManualItemQuantityChangeRow>(row.rowData);
      return toPiledriverObject({
        changeId: change.id,
        tenancyId: change.tenancyId,
        customerId: change.customerId,
        customerType: change.customerType,
        itemId: change.itemId,
        quantity: change.quantity,
        expiresAtMillis: change.expiresAtMillis,
        effectiveAtMillis: change.createdAtMillis,
        createdAtMillis: change.createdAtMillis,
      });
    }), { input: "payments-manual-item-quantity-changes" }),

    table("payments-txn-subscription-renewal", defineMapTable(row => {
      const event = rowObject<{ invoiceId: string, tenancyId: string, effectiveAtMillis: number, customerType: CustomerType, customerId: string, chargedAmount: Record<string, string>, paymentProvider: PaymentProvider, createdAtMillis: number }>(row.rowData);
      return toPiledriverObject({
        txnId: `sub-renewal:${event.invoiceId}`,
        tenancyId: event.tenancyId,
        effectiveAtMillis: event.effectiveAtMillis,
        type: "subscription-renewal",
        entries: [{ type: "money-transfer", customerType: event.customerType, customerId: event.customerId, chargedAmount: event.chargedAmount }],
        customerType: event.customerType,
        customerId: event.customerId,
        paymentProvider: event.paymentProvider,
        createdAtMillis: event.createdAtMillis,
      });
    }), { input: "payments-subscription-renewal-events" }),
    table("payments-txn-subscription-cancel", defineMapTable(row => {
      const event = rowObject<{ subscriptionId: string, tenancyId: string, effectiveAtMillis: number, customerType: CustomerType, customerId: string, changeType: "cancel", paymentProvider: PaymentProvider, createdAtMillis: number }>(row.rowData);
      return toPiledriverObject({
        txnId: `sub-cancel:${event.subscriptionId}`,
        tenancyId: event.tenancyId,
        effectiveAtMillis: event.effectiveAtMillis,
        type: "subscription-cancel",
        entries: [{ type: "active-subscription-change", customerType: event.customerType, customerId: event.customerId, subscriptionId: event.subscriptionId, changeType: event.changeType }],
        customerType: event.customerType,
        customerId: event.customerId,
        paymentProvider: event.paymentProvider,
        createdAtMillis: event.createdAtMillis,
      });
    }), { input: "payments-subscription-cancel-events" }),
    table("payments-txn-subscription-start", defineMapTable(row => {
      const event = rowObject<{ subscriptionId: string, tenancyId: string, effectiveAtMillis: number, customerType: CustomerType, customerId: string, productId: string | null, product: ProductSnapshot, productLineId: string | null, priceId: string | null, quantity: number, chargedAmount: Record<string, string>, itemGrants: ItemGrant[], paymentProvider: PaymentProvider, createdAtMillis: number }>(row.rowData);
      // subscriptionInitialState hardcodes these entry indices, so keep the order:
      // [0] sub-start, [1] product-grant, optional money-transfer before item changes.
      const entries: TransactionEntryData[] = [
        { type: "active-subscription-start", customerType: event.customerType, customerId: event.customerId, subscriptionId: event.subscriptionId },
        { type: "product-grant", customerType: event.customerType, customerId: event.customerId, productId: event.productId, priceId: event.priceId, product: event.product, productLineId: event.productLineId, quantity: event.quantity, subscriptionId: event.subscriptionId },
      ];
      if (event.paymentProvider !== "test_mode" && Object.keys(event.chargedAmount).length > 0) entries.push({ type: "money-transfer", customerType: event.customerType, customerId: event.customerId, chargedAmount: event.chargedAmount });
      entries.push(...event.itemGrants.map(grant => ({ type: "item-quantity-change" as const, customerType: event.customerType, customerId: event.customerId, itemId: grant.itemId, quantity: grant.quantity, expiresWhen: grant.expiresWhen, stampedExpiresAtMillis: grant.expiresAtMillis })));
      return toPiledriverObject({ txnId: `sub-start:${event.subscriptionId}`, tenancyId: event.tenancyId, effectiveAtMillis: event.effectiveAtMillis, type: "subscription-start", entries, customerType: event.customerType, customerId: event.customerId, paymentProvider: event.paymentProvider, createdAtMillis: event.createdAtMillis });
    }), { input: "payments-subscription-start-events" }),
    table("payments-subscription-end-events-natural", defineFilterTable(row => rowObject<{ productRevokedAtMillis: number | null }>(row.rowData).productRevokedAtMillis === null), { input: "payments-subscription-end-events" }),
    table("payments-txn-subscription-end", defineMapTable(row => {
      const event = rowObject<{ subscriptionId: string, tenancyId: string, effectiveAtMillis: number, customerType: CustomerType, customerId: string, quantity: number, productId: string | null, productLineId: string | null, startProductGrantRef: { transactionId: string, entryIndex: number }, itemQuantityChangesToExpire: Array<{ transactionId: string, entryIndex: number, itemId: string, quantity: number }>, paymentProvider: PaymentProvider, createdAtMillis: number }>(row.rowData);
      const entries: TransactionEntryData[] = [
        { type: "active-subscription-end", customerType: event.customerType, customerId: event.customerId, subscriptionId: event.subscriptionId },
        { type: "product-revocation", customerType: event.customerType, customerId: event.customerId, adjustedTransactionId: event.startProductGrantRef.transactionId, adjustedEntryIndex: event.startProductGrantRef.entryIndex, quantity: event.quantity, productId: event.productId, productLineId: event.productLineId },
        ...event.itemQuantityChangesToExpire.map(entry => ({ type: "item-quantity-expire" as const, customerType: event.customerType, customerId: event.customerId, adjustedTransactionId: entry.transactionId, adjustedEntryIndex: entry.entryIndex, quantity: entry.quantity, itemId: entry.itemId })),
      ];
      return toPiledriverObject({ txnId: `sub-end:${event.subscriptionId}`, tenancyId: event.tenancyId, effectiveAtMillis: event.effectiveAtMillis, type: "subscription-end", entries, customerType: event.customerType, customerId: event.customerId, paymentProvider: event.paymentProvider, createdAtMillis: event.createdAtMillis });
    }), { input: "payments-subscription-end-events-natural" }),
    table("payments-txn-item-grant-repeat", defineMapTable(row => {
      const event = rowObject<{ sourceId: string, tenancyId: string, effectiveAtMillis: number, customerType: CustomerType, customerId: string, previousGrantsToExpire: Array<{ transactionId: string, entryIndex: number, itemId: string, quantity: number }>, itemGrants: ItemGrant[], paymentProvider: PaymentProvider, createdAtMillis: number }>(row.rowData);
      const entries: TransactionEntryData[] = [
        ...event.previousGrantsToExpire.map(entry => ({ type: "item-quantity-expire" as const, customerType: event.customerType, customerId: event.customerId, adjustedTransactionId: entry.transactionId, adjustedEntryIndex: entry.entryIndex, quantity: entry.quantity, itemId: entry.itemId })),
        ...event.itemGrants.map(grant => ({ type: "item-quantity-change" as const, customerType: event.customerType, customerId: event.customerId, itemId: grant.itemId, quantity: grant.quantity, expiresWhen: grant.expiresWhen, stampedExpiresAtMillis: grant.expiresAtMillis })),
      ];
      return toPiledriverObject({ txnId: `igr:${event.sourceId}:${event.effectiveAtMillis}`, tenancyId: event.tenancyId, effectiveAtMillis: event.effectiveAtMillis, type: "item-grant-repeat", entries, customerType: event.customerType, customerId: event.customerId, paymentProvider: event.paymentProvider, createdAtMillis: event.createdAtMillis });
    }), { input: "payments-item-grant-repeat-events" }),
    table("payments-txn-one-time-purchase", defineMapTable(row => {
      const event = rowObject<{ purchaseId: string, tenancyId: string, effectiveAtMillis: number, customerType: CustomerType, customerId: string, productId: string | null, priceId: string | null, product: ProductSnapshot, productLineId: string | null, quantity: number, chargedAmount: Record<string, string>, itemGrants: ItemGrant[], paymentProvider: PaymentProvider, createdAtMillis: number }>(row.rowData);
      // otpInitialState hardcodes these entry indices, so keep the order:
      // [0] product-grant, optional money-transfer before item changes.
      const entries: TransactionEntryData[] = [{ type: "product-grant", customerType: event.customerType, customerId: event.customerId, productId: event.productId, priceId: event.priceId, product: event.product, productLineId: event.productLineId, quantity: event.quantity, oneTimePurchaseId: event.purchaseId }];
      if (event.paymentProvider !== "test_mode" && Object.keys(event.chargedAmount).length > 0) entries.push({ type: "money-transfer", customerType: event.customerType, customerId: event.customerId, chargedAmount: event.chargedAmount });
      entries.push(...event.itemGrants.map(grant => ({ type: "item-quantity-change" as const, customerType: event.customerType, customerId: event.customerId, itemId: grant.itemId, quantity: grant.quantity, expiresWhen: grant.expiresWhen, stampedExpiresAtMillis: grant.expiresAtMillis })));
      return toPiledriverObject({ txnId: `otp:${event.purchaseId}`, tenancyId: event.tenancyId, effectiveAtMillis: event.effectiveAtMillis, type: "one-time-purchase", entries, customerType: event.customerType, customerId: event.customerId, paymentProvider: event.paymentProvider, createdAtMillis: event.createdAtMillis });
    }), { input: "payments-one-time-purchase-events" }),
    table("payments-txn-manual-item-quantity-change", defineMapTable(row => {
      const event = rowObject<{ changeId: string, tenancyId: string, effectiveAtMillis: number, customerType: CustomerType, customerId: string, itemId: string, quantity: number, expiresAtMillis: number | null, createdAtMillis: number }>(row.rowData);
      return toPiledriverObject({ txnId: `miqc:${event.changeId}`, tenancyId: event.tenancyId, effectiveAtMillis: event.effectiveAtMillis, type: "manual-item-quantity-change", entries: [{ type: "item-quantity-change", customerType: event.customerType, customerId: event.customerId, itemId: event.itemId, quantity: event.quantity, expiresWhen: event.expiresAtMillis }], customerType: event.customerType, customerId: event.customerId, paymentProvider: null, createdAtMillis: event.createdAtMillis });
    }), { input: "payments-manual-item-quantity-change-events" }),
    table("payments-txn-refund", defineFilterTable(row => rowObject<ManualTransactionRow>(row.rowData).type === "refund"), { input: "payments-manual-transactions" }),
    table("payments-transactions", defineConcatTable(), {
      renewal: "payments-txn-subscription-renewal",
      cancel: "payments-txn-subscription-cancel",
      start: "payments-txn-subscription-start",
      end: "payments-txn-subscription-end",
      repeat: "payments-txn-item-grant-repeat",
      otp: "payments-txn-one-time-purchase",
      manual: "payments-txn-manual-item-quantity-change",
      refund: "payments-txn-refund",
    }),
    table("payments-transactions-by-customer", declareGroupByTable({
      groupKeyExtractor: async row => customerGroupKey(rowObject<TransactionRow>(row.rowData)),
      groupKeyComparator: compareJson,
    }), { input: "payments-transactions" }),
    // Tenancy-wide date index: lets listTransactions read one page (~limit rows) in
    // newest-first order instead of scanning the whole tenancy. Mirrors the old SQL server's
    // ORDER BY createdAt DESC, txnId DESC + LIMIT.
    table("payments-transactions-by-tenancy", declareGroupByTable({
      groupKeyExtractor: async row => tenancyGroupKey(rowObject<TransactionRow>(row.rowData)),
      groupKeyComparator: compareJson,
    }), { input: "payments-transactions" }),
    table("payments-transactions-by-tenancy-sorted", defineSortTable({
      sortKeyExtractor: row => transactionRecencySortKey(rowObject<TransactionRow>(row.rowData)),
      sortKeyComparator: compareTransactionRecencyKeys,
    }), { input: "payments-transactions-by-tenancy" }),

    table("payments-transaction-entries", defineFlatMapTable(row => rowObject<TransactionRow>(row.rowData).entries.map((entry, index) => ({
      ...entry,
      index,
      txnId: rowObject<TransactionRow>(row.rowData).txnId,
      txnEffectiveAtMillis: rowObject<TransactionRow>(row.rowData).effectiveAtMillis,
      txnCreatedAtMillis: rowObject<TransactionRow>(row.rowData).createdAtMillis,
      txnType: rowObject<TransactionRow>(row.rowData).type,
      tenancyId: rowObject<TransactionRow>(row.rowData).tenancyId,
      paymentProvider: rowObject<TransactionRow>(row.rowData).paymentProvider,
    }))), { input: "payments-transactions-by-customer" }),
    table("payments-entries-item-quantity-change-all", defineFilterTable(row => rowObject<{ type: string }>(row.rowData).type === "item-quantity-change"), { input: "payments-transaction-entries" }),
    table("payments-entries-item-quantity-change-compactable", defineFilterTable(row => rowObject<{ expiresWhen: unknown }>(row.rowData).expiresWhen === null), { input: "payments-entries-item-quantity-change-all" }),
    table("payments-entries-item-quantity-change-non-compactable", defineFilterTable(row => rowObject<{ expiresWhen: unknown }>(row.rowData).expiresWhen !== null), { input: "payments-entries-item-quantity-change-all" }),
    // Split compactable (non-expiring) changes by sign and compact each sign on its own — see the
    // note on compactionSubPipelineSteps. A zero-quantity non-expiring change is a no-op and is
    // dropped by both filters.
    table("payments-entries-item-quantity-change-compactable-positive", defineFilterTable(row => rowObject<{ quantity: number }>(row.rowData).quantity > 0), { input: "payments-entries-item-quantity-change-compactable" }),
    table("payments-entries-item-quantity-change-compactable-negative", defineFilterTable(row => rowObject<{ quantity: number }>(row.rowData).quantity < 0), { input: "payments-entries-item-quantity-change-compactable" }),
    table("payments-entries-item-quantity-change-compactable-positive-aggregates", defineMapTable(row => toPiledriverObject(compactableEntryToAggregate(rowObject<ItemQuantityChangeEntry>(row.rowData)))), { input: "payments-entries-item-quantity-change-compactable-positive" }),
    table("payments-entries-item-quantity-change-compactable-negative-aggregates", defineMapTable(row => toPiledriverObject(compactableEntryToAggregate(rowObject<ItemQuantityChangeEntry>(row.rowData)))), { input: "payments-entries-item-quantity-change-compactable-negative" }),
    table("payments-entries-item-quantity-expire", defineFilterTable(row => rowObject<{ type: string }>(row.rowData).type === "item-quantity-expire"), { input: "payments-transaction-entries" }),
    // Compaction boundaries mark, per item, the instants at which a grant of that item expires, so
    // non-expiring changes on either side don't compact across them (which would move a change
    // relative to the expiry and corrupt point-in-time balances). They come from two sources:
    // subscription/one-time-purchase expiry markers, and manual absolute-expiry grants (whose expiry
    // marker is synthesized later in the split, so we derive the boundary here from the grant's own
    // absolute expiry time).
    table("payments-entries-expire-marker-boundaries", defineMapTable(row => {
      const entry = rowObject<{ txnEffectiveAtMillis: number, txnId: string, index: number, itemId: string }>(row.rowData);
      return toPiledriverObject({
        type: "item-quantity-compaction-boundary",
        txnEffectiveAtMillis: entry.txnEffectiveAtMillis,
        txnId: entry.txnId,
        index: entry.index,
        itemId: entry.itemId,
      });
    }), { input: "payments-entries-item-quantity-expire" }),
    table("payments-entries-absolute-expiry-boundaries", defineFlatMapTable(row => {
      const entry = rowObject<{ txnEffectiveAtMillis: number, txnId: string, index: number, itemId: string, quantity: number, expiresWhen?: number | string | null }>(row.rowData);
      // Only manual grants with a real, still-future absolute expiry create a boundary at that time.
      if (typeof entry.expiresWhen !== "number" || entry.quantity <= 0 || entry.expiresWhen <= entry.txnEffectiveAtMillis) return [];
      return [toPiledriverObject({
        type: "item-quantity-compaction-boundary",
        txnEffectiveAtMillis: entry.expiresWhen,
        txnId: entry.txnId,
        index: entry.index,
        itemId: entry.itemId,
      })];
    }), { input: "payments-entries-item-quantity-change-non-compactable" }),
    table("payments-entries-compaction-boundaries", defineConcatTable(), {
      markers: "payments-entries-expire-marker-boundaries",
      absolute: "payments-entries-absolute-expiry-boundaries",
    }),
    ...positiveCompaction.steps,
    ...negativeCompaction.steps,
    table("payments-entries-compacted-item-quantity-change", defineConcatTable(), {
      positive: positiveCompaction.output,
      negative: negativeCompaction.output,
    }),
    table("payments-entries-passthrough-non-item-quantity-change", defineFilterTable(row => rowObject<{ type: string }>(row.rowData).type !== "item-quantity-change"), { input: "payments-transaction-entries" }),
    table("payments-compacted-transaction-entries", defineConcatTable(), {
      passthrough: "payments-entries-passthrough-non-item-quantity-change",
      compacted: "payments-entries-compacted-item-quantity-change",
      nonCompactable: "payments-entries-item-quantity-change-non-compactable",
    }),
    table("payments-entries-product-grant", defineFilterTable(row => rowObject<{ type: string }>(row.rowData).type === "product-grant"), { input: "payments-compacted-transaction-entries" }),
    table("payments-entries-product-revocation", defineFilterTable(row => rowObject<{ type: string }>(row.rowData).type === "product-revocation"), { input: "payments-compacted-transaction-entries" }),

    table("payments-product-entries", defineFilterTable(row => {
      const entry = rowObject<{ type: string }>(row.rowData);
      return entry.type === "product-grant" || entry.type === "product-revocation";
    }), { input: "payments-compacted-transaction-entries" }),
    // Sorts only by time, no tiebreak. A grant and revocation for the same product on
    // the exact same millisecond have undefined order, which can change the owned count.
    // Not reachable today; add a tiebreak (e.g. revocations first) if it ever is.
    table("payments-product-entries-sorted", defineSortTable({
      sortKeyExtractor: row => rowObject<{ txnEffectiveAtMillis: number }>(row.rowData).txnEffectiveAtMillis,
      sortKeyComparator: compareNumbers,
    }), { input: "payments-product-entries" }),
    table("payments-owned-products", declareLeftFoldTable({
      initialState: {},
      reducer: async (state, row) => {
        const current = rowObject<Record<string, { quantity: number, product: ProductSnapshot | null, productLineId: string | null }>>(state);
        const entry = rowObject<{ type: "product-grant" | "product-revocation", productId: string | null, product?: ProductSnapshot, productLineId: string | null, quantity: number, txnEffectiveAtMillis: number, txnId: string, customerType: CustomerType, customerId: string, tenancyId: string }>(row.rowData);
        // Entries with no productId share one bucket. Assumes no real product id is
        // literally "__null__", or it'd collide with this bucket.
        const key = entry.productId ?? "__null__";
        const old = current[key] ?? { quantity: 0, product: null, productLineId: null };
        const nextQuantity = Math.max(0, old.quantity + (entry.type === "product-grant" ? entry.quantity : -entry.quantity));
        const next = { ...current, [key]: { quantity: nextQuantity, product: entry.type === "product-grant" ? entry.product ?? null : old.product, productLineId: entry.type === "product-grant" ? entry.productLineId : old.productLineId } };
        return { newState: toPiledriverObject(next), newRowData: toPiledriverObject({ txnEffectiveAtMillis: entry.txnEffectiveAtMillis, txnId: entry.txnId, ownedProducts: next, customerType: entry.customerType, customerId: entry.customerId, tenancyId: entry.tenancyId }) };
      },
    }), { input: "payments-product-entries-sorted" }),

    table("payments-split-item-changes-with-expiry", defineFlatMapTable(row => {
      const entry = rowObject<{ type: string, index: number, txnId: string, txnEffectiveAtMillis: number, customerType: CustomerType, customerId: string, tenancyId: string, itemId: string, quantity: number, expiresWhen?: number | string | null, stampedExpiresAtMillis?: number | null, adjustedTransactionId?: string, adjustedEntryIndex?: number }>(row.rowData);
      const base = { txnId: entry.txnId, customerType: entry.customerType, customerId: entry.customerId, tenancyId: entry.tenancyId, itemId: entry.itemId };
      // The id under which a grant entry is pushed into the ledger, and which an expiry references
      // to drop that exact grant. It matches the granting item-quantity-change entry's identity:
      // for absolute expiries that's this entry itself; for subscription/repeat expiries the
      // item-quantity-expire entry carries the granting entry's (adjustedTransactionId, index).
      const grantId = `${entry.txnId}:${entry.index}`;
      // An expiry drops the specific grant it belongs to (clamped to whatever remains of it). We
      // model it as an explicit expire marker carrying the target grant's id — NOT as a negative
      // change — so the ledger never applies it as a cross-grant, debt-creating deduction.
      if (entry.type === "item-quantity-expire") {
        return [toPiledriverObject({ ...base, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, quantity: 0, expiresAtMillis: null, expireGrantId: `${entry.adjustedTransactionId}:${entry.adjustedEntryIndex}` })];
      }
      if (entry.type === "compacted-item-quantity-change") return [toPiledriverObject({ ...base, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, quantity: entry.quantity, expiresAtMillis: null, grantId: null })];
      if (entry.type !== "item-quantity-change") return [];
      // A deduction applies immediately and permanently, and never needs an id (nothing expires it).
      if (entry.quantity < 0) {
        return [toPiledriverObject({ ...base, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, quantity: entry.quantity, expiresAtMillis: null, grantId: null })];
      }
      // A subscription/one-time-purchase grant (`expiresWhen` is a string) carries its stamped
      // expiry so the ledger ranks it soonest-first; the id-referencing expire marker that actually
      // drops it is emitted separately from the transaction's item-quantity-expire entries.
      if (typeof entry.expiresWhen === "string") {
        return [toPiledriverObject({ ...base, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, quantity: entry.quantity, expiresAtMillis: entry.stampedExpiresAtMillis ?? null, grantId })];
      }
      // A grant with no expiry applies permanently. It gets an id anyway (harmless — nothing expires it).
      if (typeof entry.expiresWhen !== "number") {
        return [toPiledriverObject({ ...base, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, quantity: entry.quantity, expiresAtMillis: null, grantId })];
      }
      // A manual grant with an absolute expiry: grant row + a synthesized expire marker for it. If
      // the grant expires at or before the moment it's granted it's already expired — emit nothing.
      if (entry.expiresWhen <= entry.txnEffectiveAtMillis) return [];
      return [
        toPiledriverObject({ ...base, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, quantity: entry.quantity, expiresAtMillis: entry.expiresWhen, grantId }),
        toPiledriverObject({ ...base, txnEffectiveAtMillis: entry.expiresWhen, quantity: 0, expiresAtMillis: null, expireGrantId: grantId }),
      ];
    }), { input: "payments-compacted-transaction-entries" }),
    table("payments-changes-sorted-for-ledger", defineSortTable({
      sortKeyExtractor: ledgerSortKey,
      sortKeyComparator: compareLedgerSortKeys,
    }), { input: "payments-split-item-changes-with-expiry" }),
    table("payments-item-quantities", declareLeftFoldTable({
      initialState: {},
      reducer: async (state, row) => {
        const current = rowObject<LedgerState>(state);
        const change = rowObject<{ txnId: string, txnEffectiveAtMillis: number, customerType: CustomerType, customerId: string, tenancyId: string, itemId: string, quantity: number, expiresAtMillis: number | null, grantId?: string | null, expireGrantId?: string | null }>(row.rowData);
        const oldItem = current[change.itemId] ?? { grants: [], consumption: 0, debt: 0 };
        let nextItem = oldItem;
        if (change.expireGrantId != null) {
          // Expiry: drop the one grant it belongs to. The consumption that had landed on it settles
          // with it — under the soonest-first distribution that grant absorbed `alloc`, so we drop
          // `alloc` from the running consumption too. Everything left keeps re-distributing over the
          // remaining grants. A grant already gone (never existed / earlier duplicate) is a no-op.
          const target = oldItem.grants.find(grant => grant.id === change.expireGrantId);
          if (target !== undefined) {
            const consumedBefore = sumGrantQuantities(oldItem.grants.filter(grant => grant !== target && compareGrantsByExpiry(grant, target) < 0));
            const alloc = Math.max(0, Math.min(target.q, oldItem.consumption - consumedBefore));
            nextItem = { grants: oldItem.grants.filter(grant => grant !== target), consumption: oldItem.consumption - alloc, debt: oldItem.debt };
          }
        } else if (change.quantity > 0) {
          // Grant: pay down any frozen debt right here (baked into this grant's quantity so it never
          // reassigns — "debt applies to the first grant that comes in"). Keep the grant if it has
          // anything left or an id an expiry marker will later target.
          const baked = Math.min(change.quantity, oldItem.debt);
          const q = change.quantity - baked;
          const grantId = change.grantId ?? null;
          const grant = { q, e: change.expiresAtMillis, id: grantId };
          nextItem = { grants: q > 0 || grantId !== null ? [...oldItem.grants, grant] : oldItem.grants, consumption: oldItem.consumption, debt: oldItem.debt - baked };
        } else if (change.quantity < 0) {
          // Removal: as much as the grants can currently cover joins the reassigning consumption
          // total; the overflow becomes frozen debt. (Invariant: debt only grows once grants are
          // fully consumed, i.e. sum(q) - consumption == 0.)
          const amount = -change.quantity;
          const covered = Math.max(0, Math.min(amount, sumGrantQuantities(oldItem.grants) - oldItem.consumption));
          nextItem = { grants: oldItem.grants, consumption: oldItem.consumption + covered, debt: oldItem.debt + (amount - covered) };
        }
        const next = { ...current, [change.itemId]: nextItem };
        return { newState: toPiledriverObject(next), newRowData: toPiledriverObject({ txnEffectiveAtMillis: change.txnEffectiveAtMillis, txnId: change.txnId, itemQuantities: currentItemQuantities(next), customerType: change.customerType, customerId: change.customerId, tenancyId: change.tenancyId }) };
      },
    }), { input: "payments-changes-sorted-for-ledger" }),

    table("payments-subscriptions-by-customer", declareGroupByTable({
      groupKeyExtractor: async row => customerGroupKey(rowObject<SubscriptionRow>(row.rowData)),
      groupKeyComparator: compareJson,
    }), { input: "payments-subscriptions" }),
    table("payments-subscriptions-sorted", defineSortTable({
      sortKeyExtractor: row => rowObject<SubscriptionRow>(row.rowData).createdAtMillis,
      sortKeyComparator: compareNumbers,
    }), { input: "payments-subscriptions-by-customer" }),
    table("payments-subscription-map-by-customer", declareLeftFoldTable({
      initialState: {},
      reducer: async (state, row) => {
        const sub = rowObject<SubscriptionRow>(row.rowData);
        const next = { ...rowObject<Record<string, SubscriptionRow>>(state), [sub.id]: sub };
        return { newState: toPiledriverObject(next), newRowData: toPiledriverObject({ subscriptions: next, tenancyId: sub.tenancyId, customerType: sub.customerType, customerId: sub.customerId }) };
      },
    }), { input: "payments-subscriptions-sorted" }),
  ]];

  // Only looks at migrations[0], so this assumes one migration batch. Rebuild from all
  // migrations if we ever add a second. Also, replacing "-" with "_" would clash if two
  // table ids differed only by that — fine today since ids only use "-".
  const tableIds = Object.fromEntries(migrations[0].map(step => [step.tableId.replaceAll("-", "_"), step.tableId]));
  return {
    migrations,
    tableIds,
    subscriptions: "payments-subscriptions",
    subscriptionInvoices: "payments-subscription-invoices",
    oneTimePurchases: "payments-one-time-purchases",
    manualItemQuantityChanges: "payments-manual-item-quantity-changes",
    manualTransactions: "payments-manual-transactions",
    subscriptionRenewalEvents: "payments-subscription-renewal-events",
    subscriptionCancelEvents: "payments-subscription-cancel-events",
    subscriptionStartEvents: "payments-subscription-start-events",
    subscriptionEndEvents: "payments-subscription-end-events",
    itemGrantRepeatEvents: "payments-item-grant-repeat-events",
    oneTimePurchaseEvents: "payments-one-time-purchase-events",
    manualItemQuantityChangeEvents: "payments-manual-item-quantity-change-events",
    transactions: "payments-transactions-by-customer",
    transactionsByTenancy: "payments-transactions-by-tenancy-sorted",
    transactionEntries: "payments-transaction-entries",
    compactedTransactionEntries: "payments-compacted-transaction-entries",
    productGrantEntries: "payments-entries-product-grant",
    productRevocationEntries: "payments-entries-product-revocation",
    itemQuantityExpireEntries: "payments-entries-item-quantity-expire",
    allItemQuantityChangeEntries: "payments-entries-item-quantity-change-all",
    compactableItemQuantityChangeEntries: "payments-entries-item-quantity-change-compactable",
    nonCompactableItemQuantityChangeEntries: "payments-entries-item-quantity-change-non-compactable",
    compactedItemQuantityChangeEntries: "payments-entries-compacted-item-quantity-change",
    ownedProducts: "payments-owned-products",
    splitChanges: "payments-split-item-changes-with-expiry",
    itemQuantities: "payments-item-quantities",
    subscriptionMapByCustomer: "payments-subscription-map-by-customer",
    _allTables: migrations[0], // migrations[0] only — see note above tableIds.
  };
}

export type PaymentsSchema = ReturnType<typeof createPaymentsSchema>;
