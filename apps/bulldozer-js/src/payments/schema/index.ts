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
type ItemGrant = { itemId: string, quantity: number, expiresWhen: "when-purchase-expires" | "when-repeated" | null };
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
type ItemQuantityChangeEntry = {
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
type ItemCompactionAggregate = {
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
const isObject = (value: PiledriverObject): value is Record<string, PiledriverObject> => typeof value === "object" && value !== null && !Array.isArray(value);
const paymentProvider = (creationSource: string): PaymentProvider => creationSource === "TEST_MODE" ? "test_mode" : "stripe";
const repeatIntervalMs = (interval: DayInterval | "never" | null | undefined): number | null => {
  if (!Array.isArray(interval)) return null;
  const [count, unit] = interval;
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
const itemGrants = (product: ProductSnapshot, quantity: number): ItemGrant[] => Object.entries(product.includedItems).map(([itemId, item]) => ({
  itemId,
  quantity: item.quantity * quantity,
  expiresWhen: normalizedExpiresWhen(item),
}));
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
    itemGrants: itemGrants(row.product, row.quantity),
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
  const itemRepeatGrants = dueItems.map(([itemId, schedule]) => ({ itemId, quantity: schedule.quantity, expiresWhen: schedule.expiresWhen }));
  const txnId = `igr:${state.subscriptionId}:${currentMillis}`;
  const nextOutstanding = [
    ...state.outstandingGrants.filter(grant => !(grant.expiresWhen === "when-repeated" && dueIds.has(grant.itemId))),
    ...dueItems.map(([itemId, schedule], index) => ({ txnId, entryIndex: previousGrantsToExpire.length + index, itemId, quantity: schedule.quantity, expiresWhen: schedule.expiresWhen })),
  ];
  const nextSchedule = Object.fromEntries(Object.entries(state.itemRepeatSchedule).map(([itemId, schedule]) => [
    itemId,
    schedule.nextRepeatMillis !== null && schedule.nextRepeatMillis <= currentMillis && schedule.repeatIntervalMs !== null
      ? { ...schedule, nextRepeatMillis: schedule.nextRepeatMillis + schedule.repeatIntervalMs }
      : schedule,
  ]));
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
  const hasMoneyTransfer = provider !== "test_mode";
  const txnId = `otp:${row.id}`;
  return {
    purchaseId: row.id,
    tenancyId: row.tenancyId,
    customerId: row.customerId,
    customerType: row.customerType,
    paymentProvider: provider,
    revokedAtMillis: row.revokedAtMillis,
    itemRepeatSchedule: Object.fromEntries(Object.entries(repeatSchedule(row.product, row.quantity, row.createdAtMillis)).filter(([, schedule]) => schedule.repeatIntervalMs !== null)),
    outstandingGrants: outstandingGrants(row.product, row.quantity, txnId, hasMoneyTransfer ? 2 : 1),
    repeatCount: 0,
  };
}

function otpRepeatStep(state: OtpFoldState, currentMillis: number): { state: OtpFoldState, event: PiledriverObject } {
  const dueItems = dueItemEntries(state, currentMillis);
  const dueIds = new Set(dueItems.map(([itemId]) => itemId));
  const previousGrantsToExpire = grantRefsToExpire(state.outstandingGrants, "when-repeated", dueIds);
  const itemRepeatGrants = dueItems.map(([itemId, schedule]) => ({ itemId, quantity: schedule.quantity, expiresWhen: schedule.expiresWhen }));
  const txnId = `igr:${state.purchaseId}:${currentMillis}`;
  const nextOutstanding = [
    ...state.outstandingGrants.filter(grant => !(grant.expiresWhen === "when-repeated" && dueIds.has(grant.itemId))),
    ...dueItems.map(([itemId, schedule], index) => ({ txnId, entryIndex: previousGrantsToExpire.length + index, itemId, quantity: schedule.quantity, expiresWhen: schedule.expiresWhen })),
  ];
  const nextSchedule = Object.fromEntries(Object.entries(state.itemRepeatSchedule).map(([itemId, schedule]) => [
    itemId,
    schedule.nextRepeatMillis !== null && schedule.nextRepeatMillis <= currentMillis && schedule.repeatIntervalMs !== null
      ? { ...schedule, nextRepeatMillis: schedule.nextRepeatMillis + schedule.repeatIntervalMs }
      : schedule,
  ]));
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
const sumItemQuantity = (state: Record<string, { grants: { q: number, e: number | null }[], debt: number }>, itemId: string) => {
  const item = state[itemId];
  return item.grants.reduce((sum, grant) => sum + grant.q, 0) + item.debt;
};
const currentItemQuantities = (state: Record<string, { grants: { q: number, e: number | null }[], debt: number }>) => Object.fromEntries(Object.keys(state).map(itemId => [itemId, sumItemQuantity(state, itemId)]));
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
const mergeCompactionAggregates = (a: ItemCompactionAggregate, b: ItemCompactionAggregate): ItemCompactionAggregate => {
  const items = new Map(Object.entries(a.items));
  for (const [itemId, item] of Object.entries(b.items)) {
    const existing = items.get(itemId);
    items.set(itemId, existing === undefined
      ? item
      : { firstRow: existing.firstRow, quantity: existing.quantity + item.quantity });
  }
  return { type: "item-quantity-compaction-aggregate", txnEffectiveAtMillis: a.txnEffectiveAtMillis, txnId: a.txnId, index: a.index, items: Object.fromEntries(items) };
};
const compactionSortKey = (row: { rowIdentifier: string, rowData: PiledriverObject }) => {
  const data = rowObject<{ txnEffectiveAtMillis: number, txnId?: string, index?: number, type?: string }>(row.rowData);
  return {
    txnEffectiveAtMillis: data.txnEffectiveAtMillis,
    boundaryOrder: data.type === "item-quantity-compaction-boundary" ? 0 : 1,
    txnId: data.txnId ?? row.rowIdentifier,
    index: data.index ?? 0,
    rowIdentifier: row.rowIdentifier,
  };
};
const compareCompactionSortKeys = (a: PiledriverObject, b: PiledriverObject) => {
  const left = rowObject<{ txnEffectiveAtMillis: number, boundaryOrder: number, txnId: string, index: number, rowIdentifier: string }>(a);
  const right = rowObject<{ txnEffectiveAtMillis: number, boundaryOrder: number, txnId: string, index: number, rowIdentifier: string }>(b);
  return left.txnEffectiveAtMillis - right.txnEffectiveAtMillis
    || left.boundaryOrder - right.boundaryOrder
    || stringCompare(left.txnId, right.txnId)
    || left.index - right.index
    || stringCompare(left.rowIdentifier, right.rowIdentifier);
};

export function createPaymentsSchema() {
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
        itemGrants: itemGrants(purchase.product, purchase.quantity),
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
      const entries: TransactionEntryData[] = [
        { type: "active-subscription-start", customerType: event.customerType, customerId: event.customerId, subscriptionId: event.subscriptionId },
        { type: "product-grant", customerType: event.customerType, customerId: event.customerId, productId: event.productId, product: event.product, productLineId: event.productLineId, quantity: event.quantity, subscriptionId: event.subscriptionId },
      ];
      if (event.paymentProvider !== "test_mode" && Object.keys(event.chargedAmount).length > 0) entries.push({ type: "money-transfer", customerType: event.customerType, customerId: event.customerId, chargedAmount: event.chargedAmount });
      entries.push(...event.itemGrants.map(grant => ({ type: "item-quantity-change" as const, customerType: event.customerType, customerId: event.customerId, itemId: grant.itemId, quantity: grant.quantity, expiresWhen: grant.expiresWhen })));
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
        ...event.itemGrants.map(grant => ({ type: "item-quantity-change" as const, customerType: event.customerType, customerId: event.customerId, itemId: grant.itemId, quantity: grant.quantity, expiresWhen: grant.expiresWhen })),
      ];
      return toPiledriverObject({ txnId: `igr:${event.sourceId}:${event.effectiveAtMillis}`, tenancyId: event.tenancyId, effectiveAtMillis: event.effectiveAtMillis, type: "item-grant-repeat", entries, customerType: event.customerType, customerId: event.customerId, paymentProvider: event.paymentProvider, createdAtMillis: event.createdAtMillis });
    }), { input: "payments-item-grant-repeat-events" }),
    table("payments-txn-one-time-purchase", defineMapTable(row => {
      const event = rowObject<{ purchaseId: string, tenancyId: string, effectiveAtMillis: number, customerType: CustomerType, customerId: string, productId: string | null, product: ProductSnapshot, productLineId: string | null, quantity: number, chargedAmount: Record<string, string>, itemGrants: ItemGrant[], paymentProvider: PaymentProvider, createdAtMillis: number }>(row.rowData);
      const entries: TransactionEntryData[] = [{ type: "product-grant", customerType: event.customerType, customerId: event.customerId, productId: event.productId, product: event.product, productLineId: event.productLineId, quantity: event.quantity, oneTimePurchaseId: event.purchaseId }];
      if (event.paymentProvider !== "test_mode" && Object.keys(event.chargedAmount).length > 0) entries.push({ type: "money-transfer", customerType: event.customerType, customerId: event.customerId, chargedAmount: event.chargedAmount });
      entries.push(...event.itemGrants.map(grant => ({ type: "item-quantity-change" as const, customerType: event.customerType, customerId: event.customerId, itemId: grant.itemId, quantity: grant.quantity, expiresWhen: grant.expiresWhen })));
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
    table("payments-entries-item-quantity-change-compactable-aggregates", defineMapTable(row => toPiledriverObject(compactableEntryToAggregate(rowObject<ItemQuantityChangeEntry>(row.rowData)))), { input: "payments-entries-item-quantity-change-compactable" }),
    table("payments-entries-item-quantity-expire", defineFilterTable(row => rowObject<{ type: string }>(row.rowData).type === "item-quantity-expire"), { input: "payments-transaction-entries" }),
    table("payments-entries-compaction-boundaries", defineMapTable(row => {
      const entry = rowObject<{ txnEffectiveAtMillis: number, txnId: string, index: number }>(row.rowData);
      return toPiledriverObject({
        type: "item-quantity-compaction-boundary",
        txnEffectiveAtMillis: entry.txnEffectiveAtMillis,
        txnId: entry.txnId,
        index: entry.index,
      });
    }), { input: "payments-entries-item-quantity-expire" }),
    table("payments-entries-compaction-input", defineConcatTable(), {
      compactable: "payments-entries-item-quantity-change-compactable-aggregates",
      boundary: "payments-entries-compaction-boundaries",
    }),
    table("payments-entries-compaction-input-sorted", defineSortTable({
      sortKeyExtractor: compactionSortKey,
      sortKeyComparator: compareCompactionSortKeys,
    }), { input: "payments-entries-compaction-input" }),
    table("payments-entries-compacted-raw", defineCompactTable({
      compactor: (left, right) => {
        if (isCompactionBoundary(left) || isCompactionBoundary(right)) return [{ newRowData: left }, { newRowData: right }];
        return [{ newRowData: toPiledriverObject(mergeCompactionAggregates(asCompactionAggregate(left), asCompactionAggregate(right))) }];
      },
    }), { input: "payments-entries-compaction-input-sorted" }),
    table("payments-entries-compacted-aggregates", defineFilterTable(row => rowObject<{ type: string }>(row.rowData).type === "item-quantity-compaction-aggregate"), { input: "payments-entries-compacted-raw" }),
    table("payments-entries-compacted-item-quantity-change", defineFlatMapTable(row => {
      const aggregate = rowObject<ItemCompactionAggregate>(row.rowData);
      return Object.values(aggregate.items).map(item => toPiledriverObject({
        ...item.firstRow,
        type: "compacted-item-quantity-change",
        quantity: item.quantity,
        expiresWhen: null,
      }));
    }), { input: "payments-entries-compacted-aggregates" }),
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
    table("payments-product-entries-sorted", defineSortTable({
      sortKeyExtractor: row => rowObject<{ txnEffectiveAtMillis: number }>(row.rowData).txnEffectiveAtMillis,
      sortKeyComparator: compareNumbers,
    }), { input: "payments-product-entries" }),
    table("payments-owned-products", declareLeftFoldTable({
      initialState: {},
      reducer: async (state, row) => {
        const current = rowObject<Record<string, { quantity: number, product: ProductSnapshot | null, productLineId: string | null }>>(state);
        const entry = rowObject<{ type: "product-grant" | "product-revocation", productId: string | null, product?: ProductSnapshot, productLineId: string | null, quantity: number, txnEffectiveAtMillis: number, txnId: string, customerType: CustomerType, customerId: string, tenancyId: string }>(row.rowData);
        const key = entry.productId ?? "__null__";
        const old = current[key] ?? { quantity: 0, product: null, productLineId: null };
        const nextQuantity = Math.max(0, old.quantity + (entry.type === "product-grant" ? entry.quantity : -entry.quantity));
        const next = { ...current, [key]: { quantity: nextQuantity, product: entry.type === "product-grant" ? entry.product ?? null : old.product, productLineId: entry.type === "product-grant" ? entry.productLineId : old.productLineId } };
        return { newState: toPiledriverObject(next), newRowData: toPiledriverObject({ txnEffectiveAtMillis: entry.txnEffectiveAtMillis, txnId: entry.txnId, ownedProducts: next, customerType: entry.customerType, customerId: entry.customerId, tenancyId: entry.tenancyId }) };
      },
    }), { input: "payments-product-entries-sorted" }),

    table("payments-split-item-changes-with-expiry", defineFlatMapTable(row => {
      const entry = rowObject<{ type: string, txnId: string, txnEffectiveAtMillis: number, customerType: CustomerType, customerId: string, tenancyId: string, itemId: string, quantity: number, expiresWhen?: number | string | null }>(row.rowData);
      if (entry.type === "item-quantity-expire") return [toPiledriverObject({ txnId: entry.txnId, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, customerType: entry.customerType, customerId: entry.customerId, tenancyId: entry.tenancyId, itemId: entry.itemId, quantity: -entry.quantity, expiresAtMillis: null })];
      if (entry.type === "compacted-item-quantity-change") return [toPiledriverObject({ txnId: entry.txnId, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, customerType: entry.customerType, customerId: entry.customerId, tenancyId: entry.tenancyId, itemId: entry.itemId, quantity: entry.quantity, expiresAtMillis: null })];
      if (entry.type !== "item-quantity-change") return [];
      if (typeof entry.expiresWhen !== "number" || entry.expiresWhen <= entry.txnEffectiveAtMillis || entry.quantity < 0) {
        return [toPiledriverObject({ txnId: entry.txnId, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, customerType: entry.customerType, customerId: entry.customerId, tenancyId: entry.tenancyId, itemId: entry.itemId, quantity: entry.quantity, expiresAtMillis: null })];
      }
      return [
        toPiledriverObject({ txnId: entry.txnId, txnEffectiveAtMillis: entry.txnEffectiveAtMillis, customerType: entry.customerType, customerId: entry.customerId, tenancyId: entry.tenancyId, itemId: entry.itemId, quantity: entry.quantity, expiresAtMillis: entry.expiresWhen }),
        toPiledriverObject({ txnId: entry.txnId, txnEffectiveAtMillis: entry.expiresWhen, customerType: entry.customerType, customerId: entry.customerId, tenancyId: entry.tenancyId, itemId: entry.itemId, quantity: -entry.quantity, expiresAtMillis: null }),
      ];
    }), { input: "payments-compacted-transaction-entries" }),
    table("payments-changes-sorted-for-ledger", defineSortTable({
      sortKeyExtractor: row => rowObject<{ txnEffectiveAtMillis: number }>(row.rowData).txnEffectiveAtMillis,
      sortKeyComparator: compareNumbers,
    }), { input: "payments-split-item-changes-with-expiry" }),
    table("payments-item-quantities", declareLeftFoldTable({
      initialState: {},
      reducer: async (state, row) => {
        const current = rowObject<Record<string, { grants: { q: number, e: number | null }[], debt: number }>>(state);
        const change = rowObject<{ txnId: string, txnEffectiveAtMillis: number, customerType: CustomerType, customerId: string, tenancyId: string, itemId: string, quantity: number, expiresAtMillis: number | null }>(row.rowData);
        const oldItem = current[change.itemId] ?? { grants: [], debt: 0 };
        let nextItem = oldItem;
        if (change.quantity > 0) {
          const afterDebt = change.quantity + oldItem.debt;
          nextItem = { grants: afterDebt > 0 ? [...oldItem.grants, { q: afterDebt, e: change.expiresAtMillis }] : oldItem.grants, debt: Math.min(0, afterDebt) };
        } else if (change.quantity < 0) {
          let remaining = Math.abs(change.quantity);
          const grants = [...oldItem.grants].sort((a, b) => (a.e ?? Number.POSITIVE_INFINITY) - (b.e ?? Number.POSITIVE_INFINITY));
          const nextGrants: { q: number, e: number | null }[] = [];
          for (const grant of grants) {
            const consumed = Math.min(grant.q, remaining);
            remaining -= consumed;
            if (grant.q > consumed) nextGrants.push({ q: grant.q - consumed, e: grant.e });
          }
          nextItem = { grants: nextGrants, debt: oldItem.debt - remaining };
        } else {
          nextItem = { grants: oldItem.grants.filter(grant => grant.e === null || grant.e > change.txnEffectiveAtMillis), debt: oldItem.debt };
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
    _allTables: migrations[0],
  };
}

export type PaymentsSchema = ReturnType<typeof createPaymentsSchema>;
