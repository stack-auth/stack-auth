import { Tenancy } from "@/lib/tenancies";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { addInterval, getIntervalsElapsed } from "@stackframe/stack-shared/dist/utils/dates";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import {
  compareTransactions,
  createItemQuantityChangeEntry,
  createItemQuantityExpireEntry,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";
import { getDefaultProductsChangeTransactions } from "./default-products-change";
import { getSubscriptionStartTransactions } from "./subscription-start";
import { getOneTimePurchaseTransactions } from "./one-time-purchase";
import { getSubscriptionEndTransactions } from "./subscription-end";
import { getPurchaseRefundTransactions } from "./purchase-refund";

type RepeatInterval = [number, "day" | "week" | "month" | "year"];

type RenewalSource = {
  grantTransactionId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
  cycleAnchor: Date,
  revokedAt: Date | null,
  items: Array<{
    itemId: string,
    quantity: number,
    repeat: RepeatInterval,
    expires: string,
  }>,
};

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

function extractRenewalSourcesFromGrants(grantTxs: Transaction[], revocationMap: Map<string, Date>): RenewalSource[] {
  const sources: RenewalSource[] = [];
  for (const tx of grantTxs) {
    for (const entry of tx.entries) {
      if (entry.type !== "product_grant") continue;
      const product = entry.product;
      const repeatingItems: RenewalSource["items"] = [];
      for (const [itemId, item] of Object.entries(product.included_items)) {
        const repeat = item.repeat;
        if (!repeat || repeat === "never") continue;
        const qty = (item.quantity ?? 0) * entry.quantity;
        if (qty <= 0) continue;
        repeatingItems.push({
          itemId, quantity: qty,
          repeat: repeat as RepeatInterval,
          expires: item.expires ?? "never",
        });
      }
      if (repeatingItems.length === 0) continue;
      sources.push({
        grantTransactionId: tx.id,
        customerType: entry.customer_type,
        customerId: entry.customer_id,
        cycleAnchor: new Date(entry.cycle_anchor),
        revokedAt: revocationMap.get(tx.id) ?? null,
        items: repeatingItems,
      });
    }
  }
  return sources;
}

function generateRenewalsForSource(source: RenewalSource, now: Date): Transaction[] {
  const renewals: Transaction[] = [];
  const endTime = source.revokedAt ?? now;
  for (const item of source.items) {
    const elapsed = getIntervalsElapsed(source.cycleAnchor, endTime, item.repeat);
    for (let i = 1; i <= elapsed; i++) {
      const windowStart = addInterval(new Date(source.cycleAnchor), [item.repeat[0] * i, item.repeat[1]]);
      const renewalId = `${source.grantTransactionId}:renewal:${item.itemId}:${i}`;
      const entries: TransactionEntry[] = [];
      if (item.expires === "when-repeated") {
        entries.push(createItemQuantityExpireEntry({
          customerType: source.customerType, customerId: source.customerId,
          itemId: item.itemId, quantity: item.quantity,
        }));
      }
      entries.push(createItemQuantityChangeEntry({
        customerType: source.customerType, customerId: source.customerId,
        itemId: item.itemId, quantity: item.quantity,
      }));
      renewals.push({
        id: renewalId,
        created_at_millis: windowStart.getTime(),
        effective_at_millis: windowStart.getTime(),
        type: "item-grant-renewal",
        entries, adjusted_by: [], test_mode: false,
      });
    }
  }
  return renewals;
}

/**
 * Given ownership intervals for a product line, computes the time gaps where
 * no non-default product covers the line.
 */
function computeGaps(coverage: Array<{ start: Date, end: Date }>, now: Date): Array<{ start: Date, end: Date }> {
  if (coverage.length === 0) {
    return [{ start: now, end: new Date(8640000000000000) }];
  }
  const sorted = [...coverage].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date, end: Date }> = [];
  for (const interval of sorted) {
    if (merged.length > 0 && interval.start <= merged[merged.length - 1].end) {
      const last = merged[merged.length - 1];
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
    }
  }
  const gaps: Array<{ start: Date, end: Date }> = [];
  if (now < merged[0].start) {
    gaps.push({ start: now, end: merged[0].start });
  }
  for (let i = 0; i < merged.length - 1; i++) {
    if (merged[i].end < merged[i + 1].start) {
      const gapStart = merged[i].end;
      const gapEnd = merged[i + 1].start;
      if (gapEnd > now || gapStart <= now) {
        gaps.push({ start: gapStart < now ? gapStart : now, end: gapEnd });
      }
    }
  }
  if (now >= merged[merged.length - 1].end) {
    gaps.push({ start: merged[merged.length - 1].end, end: new Date(8640000000000000) });
  }
  return gaps;
}

/**
 * Generates item_quantity_change entries for default products during gaps
 * where no non-default product in the same product line is owned.
 */
function generateDefaultProductItemGrants(
  defaultProductsTxs: Transaction[],
  grantTxs: Transaction[],
  revocationMap: Map<string, Date>,
  now: Date,
  customerType: string,
  customerId: string,
): Transaction[] {
  let latestSnapshot: Record<string, any> | null = null;
  for (const tx of defaultProductsTxs) {
    for (const entry of tx.entries) {
      if ((entry.type as string) === "default_products_change") {
        latestSnapshot = (entry as any).snapshot;
        break;
      }
    }
    if (latestSnapshot) break;
  }
  if (!latestSnapshot || Object.keys(latestSnapshot).length === 0) return [];

  // Build product line ownership timeline from non-default grants
  const productLineOwnership = new Map<string, Array<{ start: Date, end: Date }>>();
  for (const tx of grantTxs) {
    for (const entry of tx.entries) {
      if (entry.type !== "product_grant") continue;
      if (entry.subscription_id == null && entry.one_time_purchase_id == null) continue;
      const pl = (entry.product as any).productLineId;
      if (!pl) continue;
      if (!productLineOwnership.has(pl)) productLineOwnership.set(pl, []);
      productLineOwnership.get(pl)!.push({
        start: new Date(tx.effective_at_millis),
        end: revocationMap.get(tx.id) ?? new Date(8640000000000000),
      });
    }
  }

  const renewals: Transaction[] = [];

  for (const [productId, product] of Object.entries(latestSnapshot)) {
    const inlineProduct = product as any;
    const productLineId = inlineProduct.productLineId;

    if (productLineId) {
      const coverage = productLineOwnership.get(productLineId) ?? [];
      const gaps = computeGaps(coverage, now);

      for (const [itemId, item] of Object.entries(inlineProduct.included_items ?? {})) {
        const qty = (item as any).quantity ?? 0;
        if (qty <= 0) continue;
        for (const gap of gaps) {
          renewals.push({
            id: `default:${productId}:${itemId}:${gap.start.getTime()}`,
            created_at_millis: gap.start.getTime(),
            effective_at_millis: gap.start.getTime(),
            type: "item-grant-renewal",
            entries: [
              createItemQuantityChangeEntry({
                customerType: customerType as any,
                customerId,
                itemId,
                quantity: qty,
              }),
            ],
            adjusted_by: [],
            test_mode: false,
          });
        }
      }
    } else {
      // Ungrouped default: only if no product with same ID is purchased
      const isOwned = grantTxs.some((tx) =>
        tx.entries.some((e) =>
          e.type === "product_grant" &&
          e.product_id === productId &&
          (e.subscription_id != null || e.one_time_purchase_id != null)
        )
      );
      if (!isOwned) {
        for (const [itemId, item] of Object.entries(inlineProduct.included_items ?? {})) {
          const qty = (item as any).quantity ?? 0;
          if (qty <= 0) continue;
          renewals.push({
            id: `default:${productId}:${itemId}:ungrouped`,
            created_at_millis: now.getTime(),
            effective_at_millis: now.getTime(),
            type: "item-grant-renewal",
            entries: [
              createItemQuantityChangeEntry({
                customerType: customerType as any,
                customerId,
                itemId,
                quantity: qty,
              }),
            ],
            adjusted_by: [],
            test_mode: false,
          });
        }
      }
    }
  }

  return renewals;
}

export function getItemGrantRenewalTransactions(tenancy: Tenancy): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  const grantSources = PaginatedList.merge(
    getSubscriptionStartTransactions(tenancy),
    getOneTimePurchaseTransactions(tenancy),
  );

  const revocationSources = PaginatedList.merge(
    getSubscriptionEndTransactions(tenancy),
    getPurchaseRefundTransactions(tenancy),
  );

  const defaultProductsSources = getDefaultProductsChangeTransactions(tenancy);

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

      // Renewals from purchased products
      const purchaseSources = extractRenewalSourcesFromGrants(allGrants, revocationMap);
      const allRenewals: Transaction[] = [];
      for (const source of purchaseSources) {
        allRenewals.push(...generateRenewalsForSource(source, now));
      }

      // Renewals from default products during ownership gaps
      const customerType = opts.filter.customerType ?? "custom";
      const customerId = opts.filter.customerId ?? "";
      if (customerId) {
        allRenewals.push(...generateDefaultProductItemGrants(
          allDefaultProducts, allGrants, revocationMap, now, customerType, customerId,
        ));
      }

      allRenewals.sort((a, b) => this._compare(opts.orderBy, a, b));

      const cursorMillis = opts.cursor ? Number(opts.cursor.split(":").pop() ?? "0") : 0;
      const filtered = opts.cursor
        ? allRenewals.filter((tx) => tx.created_at_millis < cursorMillis || (tx.created_at_millis === cursorMillis && tx.id < opts.cursor))
        : allRenewals;

      const page = filtered.slice(0, opts.limit);
      const lastId = page.length > 0 ? `${page[page.length - 1].id}:${page[page.length - 1].created_at_millis}` : opts.cursor;

      return {
        items: page.map((tx) => ({
          item: tx,
          prevCursor: `${tx.id}:${tx.created_at_millis}`,
          nextCursor: `${tx.id}:${tx.created_at_millis}`,
        })),
        isFirst: !opts.cursor,
        isLast: page.length < opts.limit,
        cursor: lastId,
      };
    }
  }

  return new ItemGrantRenewalList();
}
