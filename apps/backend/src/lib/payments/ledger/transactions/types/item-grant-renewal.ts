import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { addInterval, getIntervalsElapsed } from "@stackframe/stack-shared/dist/utils/dates";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import {
  compareTransactions,
  createItemQuantityChangeEntry,
  createItemQuantityExpireEntry,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";
import { getDefaultProductsChangeTransactions } from "./default-products-change";
import { getOneTimePurchaseTransactions } from "./one-time-purchase";
import { getPurchaseRefundTransactions } from "./purchase-refund";
import { getSubscriptionEndTransactions } from "./subscription-end";
import { getSubscriptionStartTransactions } from "./subscription-start";

type RepeatInterval = [number, "day" | "week" | "month" | "year"];

// ── Helpers ──

async function drainList(list: PaginatedList<Transaction, any, any, any>, filter: TransactionFilter, orderBy: TransactionOrderBy): Promise<Transaction[]> {
  const result: Transaction[] = [];
  let cursor = list.getFirstCursor();
  let done = false;
  while (!done) {
    const page = await list.next({ after: cursor, limit: 200, filter, orderBy, limitPrecision: "exact" });
    for (const entry of page.items) result.push(entry.item);
    cursor = page.cursor;
    done = page.isLast;
  }
  return result;
}

function buildRevocationMap(revocationTxs: Transaction[]): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const tx of revocationTxs) {
    for (const entry of tx.entries) {
      if (entry.type === "product_revocation") {
        map.set(entry.adjusted_transaction_id, new Date(tx.effective_at_millis));
      }
    }
  }
  return map;
}

function getProductLineId(product: any): string | null {
  return product.product_line_id ?? null;
}

/**
 * Merges overlapping/adjacent intervals and returns the gaps between them.
 * Returns gaps starting from `epoch` and extending to far-future after the last interval.
 */
function computeGaps(coverage: Array<{ start: Date, end: Date }>, epoch: Date): Array<{ start: Date, end: Date }> {
  if (coverage.length === 0) {
    return [{ start: epoch, end: new Date(8640000000000000) }];
  }
  const sorted = [...coverage].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date, end: Date }> = [];
  for (const interval of sorted) {
    if (merged.length > 0 && interval.start <= merged[merged.length - 1].end) {
      if (interval.end > merged[merged.length - 1].end) merged[merged.length - 1].end = interval.end;
    } else {
      merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
    }
  }
  const gaps: Array<{ start: Date, end: Date }> = [];
  if (epoch < merged[0].start) gaps.push({ start: epoch, end: merged[0].start });
  for (let i = 0; i < merged.length - 1; i++) {
    if (merged[i].end < merged[i + 1].start) gaps.push({ start: merged[i].end, end: merged[i + 1].start });
  }
  gaps.push({ start: merged[merged.length - 1].end, end: new Date(8640000000000000) });
  return gaps;
}

// ── Paid product renewals ──

type ItemRenewalDef = {
  itemId: string,
  quantity: number,
  repeat: RepeatInterval,
  expires: string,
};

/**
 * Generates renewal transactions for a purchased product's repeating items.
 * Each renewal contains ALL items for that product at that time point — not one transaction per item.
 */
function generatePaidProductRenewals(
  grantTxs: Transaction[],
  revocationMap: Map<string, Date>,
  now: Date,
): Transaction[] {
  const renewals: Transaction[] = [];

  for (const tx of grantTxs) {
    for (let ei = 0; ei < tx.entries.length; ei++) {
      const entry = tx.entries[ei];
      if (entry.type !== "product_grant") continue;

      const iqcIndices: Record<string, number> = (entry as any).item_quantity_change_indices ?? {};

      const items: ItemRenewalDef[] = [];
      for (const [itemId, item] of Object.entries(entry.product.included_items)) {
        const repeat = item.repeat;
        if (!repeat || repeat === "never") continue;
        const qty = (item.quantity ?? 0) * entry.quantity;
        if (qty <= 0) continue;
        items.push({ itemId, quantity: qty, repeat: repeat as RepeatInterval, expires: item.expires ?? "never" });
      }
      if (items.length === 0) continue;

      const cycleAnchor = new Date(entry.cycle_anchor);
      const revokedAt = revocationMap.get(tx.id) ?? null;
      const endTime = revokedAt ?? now;
      const details = { source_transaction_id: tx.id, source_entry_index: ei };

      // Group items by their repeat interval so they share renewal timestamps
      const byRepeat = new Map<string, ItemRenewalDef[]>();
      for (const item of items) {
        const key = JSON.stringify(item.repeat);
        if (!byRepeat.has(key)) byRepeat.set(key, []);
        byRepeat.get(key)!.push(item);
      }

      for (const [, groupItems] of byRepeat) {
        const repeat = groupItems[0].repeat;
        const elapsed = getIntervalsElapsed(cycleAnchor, endTime, repeat);
        const grantTxIdsAndEntryIndices = groupItems.map((item) => [tx.id, iqcIndices[item.itemId] ?? throwErr("Item's item_quantity_change_index not found in source product grant transaction", { item, iqcIndices })] as const);
        for (let i = 1; i <= elapsed; i++) {
          const renewalTime = addInterval(new Date(cycleAnchor), [repeat[0] * i, repeat[1]]);
          const entries: TransactionEntry[] = [];
          const txId = `${tx.id}:renewal:${i}:${JSON.stringify(repeat)}`;
          for (let gi = 0; gi < groupItems.length; gi++) {
            const item = groupItems[gi];
            if (item.expires === "when-repeated") {
              entries.push(createItemQuantityExpireEntry({
                customerType: entry.customer_type,
                customerId: entry.customer_id,
                itemId: item.itemId,
                quantity: item.quantity,
                adjustedTransactionId: grantTxIdsAndEntryIndices[gi][0],
                adjustedEntryIndex: grantTxIdsAndEntryIndices[gi][1],
              }));
            }
            entries.push(createItemQuantityChangeEntry({
              customerType: entry.customer_type, customerId: entry.customer_id,
              itemId: item.itemId, quantity: item.quantity,
            }));
            grantTxIdsAndEntryIndices[gi] = [txId, entries.length - 1] as const;
          }
          renewals.push({
            id: txId,
            created_at_millis: renewalTime.getTime(),
            effective_at_millis: renewalTime.getTime(),
            type: "item-grant-renewal",
            details,
            entries,
            adjusted_by: [],
            test_mode: false,
          });
        }
      }
    }
  }

  return renewals;
}

// ── Default product renewals ──

type DefaultProductSnapshot = {
  txId: string,
  txEntryIndex: number,
  createdAt: number,
  products: Array<{
    productId: string,
    productLineId: string | null,
    items: Array<{
      itemId: string,
      quantity: number,
      repeat: RepeatInterval | null,
      expires: string,
    }>,
  }>,
};

function parseDefaultSnapshots(defaultProductsTxs: Transaction[]): DefaultProductSnapshot[] {
  const snapshots: DefaultProductSnapshot[] = [];
  for (const tx of defaultProductsTxs) {
    for (let entryIndex = 0; entryIndex < tx.entries.length; entryIndex++) {
      const entry = tx.entries[entryIndex];
      if ((entry.type as string) !== "default_products_change") continue;
      const snapshot = (entry as any).snapshot as Record<string, any>;
      const products: DefaultProductSnapshot["products"] = [];
      for (const [productId, product] of Object.entries(snapshot)) {
        const items: DefaultProductSnapshot["products"][0]["items"] = [];
        for (const [itemId, item] of Object.entries((product as any).included_items ?? {})) {
          const qty = (item as any).quantity ?? 0;
          if (qty <= 0) continue;
          const repeat = (item as any).repeat;
          items.push({
            itemId,
            quantity: qty,
            repeat: (!repeat || repeat === "never") ? null : repeat as RepeatInterval,
            expires: (item as any).expires ?? "never",
          });
        }
        products.push({ productId, productLineId: getProductLineId(product), items });
      }
      snapshots.push({ txId: tx.id, txEntryIndex: entryIndex, createdAt: tx.effective_at_millis, products });
    }
  }
  return snapshots.sort((a, b) => a.createdAt - b.createdAt);
}

function buildProductLineCoverage(grantTxs: Transaction[], revocationMap: Map<string, Date>): Map<string, Array<{ start: Date, end: Date }>> {
  const map = new Map<string, Array<{ start: Date, end: Date }>>();
  for (const tx of grantTxs) {
    for (const entry of tx.entries) {
      if (entry.type !== "product_grant") continue;
      if (entry.subscription_id == null && entry.one_time_purchase_id == null) continue;
      const pl = getProductLineId(entry.product as any);
      if (!pl) continue;
      if (!map.has(pl)) map.set(pl, []);
      map.get(pl)!.push({
        start: new Date(tx.effective_at_millis),
        end: revocationMap.get(tx.id) ?? new Date(8640000000000000),
      });
    }
  }
  return map;
}

/**
 * Generates repeating item grants for default products during gaps where no
 * paid product covers the same product line. Each renewal transaction at a given
 * time point contains ALL items for that default product.
 *
 * NOTE: snapshot transition logic (expire old items when defaults change) is NOT
 * handled here — it belongs in the ledger calculation function.
 */
function generateDefaultProductRenewals(
  defaultProductsTxs: Transaction[],
  grantTxs: Transaction[],
  revocationMap: Map<string, Date>,
  now: Date,
  customerType: string,
  customerId: string,
): Transaction[] {
  const snapshots = parseDefaultSnapshots(defaultProductsTxs);
  if (snapshots.length === 0) return [];

  const plCoverage = buildProductLineCoverage(grantTxs, revocationMap);
  const renewals: Transaction[] = [];

  for (let si = 0; si < snapshots.length; si++) {
    const snap = snapshots[si];
    const periodStart = snap.createdAt;
    const periodEnd = si < snapshots.length - 1 ? snapshots[si + 1].createdAt : 8640000000000000;
    const details = { source_transaction_id: snap.txId, source_entry_index: 0, default_product_change: true };

    for (const prod of snap.products) {
      const windows = getDefaultProductWindows(prod, plCoverage, grantTxs, periodStart, periodEnd);

      for (const window of windows) {
        const repeatingItems = prod.items.filter((it) => it.repeat);
        const nonRepeatingItems = prod.items.filter((it) => !it.repeat);

        if (repeatingItems.length === 0) continue;

        // Group repeating items by interval
        const byRepeat = new Map<string, typeof repeatingItems>();
        for (const item of repeatingItems) {
          const key = JSON.stringify(item.repeat);
          if (!byRepeat.has(key)) byRepeat.set(key, []);
          byRepeat.get(key)!.push(item);
        }

        for (const [, groupItems] of byRepeat) {
          const repeat = groupItems[0].repeat!;
          const effectiveEnd = new Date(Math.min(window.end.getTime(), now.getTime()));

          // Repeating renewals
          const elapsed = getIntervalsElapsed(window.start, effectiveEnd, repeat);
          const grantTxIdsAndEntryIndices = groupItems.map((item) => [snap.txId, snap.txEntryIndex] as const);
          for (let i = 1; i <= elapsed; i++) {
            const renewalTime = addInterval(new Date(window.start), [repeat[0] * i, repeat[1]]);
            if (renewalTime >= window.end) break;
            const entries: TransactionEntry[] = [];
            const txId = `default:${prod.productId}:${window.start.getTime()}:${JSON.stringify(repeat)}:${i}`;
            for (let gi = 0; gi < groupItems.length; gi++) {
              const item = groupItems[gi];
              if (item.expires === "when-repeated") {
                entries.push(createItemQuantityExpireEntry({
                  customerType: customerType as any, customerId, itemId: item.itemId, quantity: item.quantity,
                  adjustedTransactionId: grantTxIdsAndEntryIndices[gi][0],
                  adjustedEntryIndex: grantTxIdsAndEntryIndices[gi][1],
                }));
              }
              entries.push(createItemQuantityChangeEntry({ customerType: customerType as any, customerId, itemId: item.itemId, quantity: item.quantity }));
              grantTxIdsAndEntryIndices[gi] = [txId, entries.length - 1] as const;
            }
            renewals.push({
              id: txId,
              created_at_millis: renewalTime.getTime(),
              effective_at_millis: renewalTime.getTime(),
              type: "item-grant-renewal",
              details: { ...details, default_product_id: prod.productId },
              entries,
              adjusted_by: [], test_mode: false,
            });
          }
        }
      }
    }
  }

  return renewals;
}

function getDefaultProductWindows(
  prod: DefaultProductSnapshot["products"][0],
  plCoverage: Map<string, Array<{ start: Date, end: Date }>>,
  grantTxs: Transaction[],
  periodStart: number,
  periodEnd: number,
): Array<{ start: Date, end: Date }> {
  if (!prod.productLineId) {
    const isOwned = grantTxs.some((tx) =>
      tx.entries.some((e) =>
        e.type === "product_grant" && e.product_id === prod.productId &&
        (e.subscription_id != null || e.one_time_purchase_id != null)
      )
    );
    if (isOwned) return [];
    return [{ start: new Date(periodStart), end: new Date(periodEnd) }];
  }

  const coverage = plCoverage.get(prod.productLineId) ?? [];
  const gaps = computeGaps(coverage, new Date(periodStart));
  const windows: Array<{ start: Date, end: Date }> = [];
  for (const gap of gaps) {
    const start = new Date(Math.max(gap.start.getTime(), periodStart));
    const end = new Date(Math.min(gap.end.getTime(), periodEnd));
    if (start < end) windows.push({ start, end });
  }
  return windows;
}

// ── PaginatedList export ──

export function getItemGrantRenewalTransactions(prisma: PrismaClientTransaction, tenancyId: string): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  const grantSources = PaginatedList.merge(
    getSubscriptionStartTransactions(prisma, tenancyId),
    getOneTimePurchaseTransactions(prisma, tenancyId),
  );
  const revocationSources = PaginatedList.merge(
    getSubscriptionEndTransactions(prisma, tenancyId),
    getPurchaseRefundTransactions(prisma, tenancyId),
  );
  const defaultProductsSources = getDefaultProductsChangeTransactions(prisma, tenancyId);

  class ItemGrantRenewalList extends PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
    override _getFirstCursor() { return ""; }
    override _getLastCursor() { return ""; }
    override _compare(orderBy: TransactionOrderBy, a: Transaction, b: Transaction) {
      return compareTransactions(orderBy, a, b);
    }

    override async _nextOrPrev(
      _type: "next" | "prev",
      opts: { cursor: string, limit: number, limitPrecision: "approximate", filter: TransactionFilter, orderBy: TransactionOrderBy },
    ) {
      const now = new Date();
      const [allGrants, allRevocations, allDefaultProducts] = await Promise.all([
        drainList(grantSources, opts.filter, opts.orderBy),
        drainList(revocationSources, opts.filter, opts.orderBy),
        drainList(defaultProductsSources, opts.filter, opts.orderBy),
      ]);

      const revocationMap = buildRevocationMap(allRevocations);
      const allRenewals = [
        ...generatePaidProductRenewals(allGrants, revocationMap, now),
        ...(opts.filter.customerId ? generateDefaultProductRenewals(
          allDefaultProducts, allGrants, revocationMap, now,
          opts.filter.customerType ?? "custom", opts.filter.customerId,
        ) : []),
      ];

      allRenewals.sort((a, b) => this._compare(opts.orderBy, a, b));

      const cursorMillis = opts.cursor ? Number(opts.cursor.split(":").pop() ?? "0") : 0;
      const filtered = opts.cursor
        ? allRenewals.filter((tx) => tx.created_at_millis < cursorMillis || (tx.created_at_millis === cursorMillis && tx.id < opts.cursor))
        : allRenewals;

      const page = filtered.slice(0, opts.limit);
      const lastId = page.length > 0 ? `${page[page.length - 1].id}:${page[page.length - 1].created_at_millis}` : opts.cursor;

      return {
        items: page.map((tx) => ({ item: tx, prevCursor: `${tx.id}:${tx.created_at_millis}`, nextCursor: `${tx.id}:${tx.created_at_millis}` })),
        isFirst: !opts.cursor,
        isLast: page.length < opts.limit,
        cursor: lastId,
      };
    }
  }

  return new ItemGrantRenewalList();
}
