import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { SUPPORTED_CURRENCIES, type Currency } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";

export type TransactionFilter = {
  customerType?: "user" | "team" | "custom",
  customerId?: string,
};

export type TransactionOrderBy = "createdAt-desc";

type SelectedPriceMetadata = {
  interval?: unknown,
};

type SelectedPrice = Record<string, unknown> & SelectedPriceMetadata;

type ProductPriceEntryExtras = {
  serverOnly?: unknown,
  freeTrial?: unknown,
};

type ProductPriceEntry = SelectedPrice & ProductPriceEntryExtras;

export type ProductWithPrices = {
  displayName?: string,
  prices?: Record<string, ProductPriceEntry> | "include-by-default",
} | null | undefined;

export type ProductSnapshot = (TransactionEntry & { type: "product_grant" })["product"];

const REFUND_TRANSACTION_SUFFIX = ":refund";

export function resolveSelectedPriceFromProduct(product: ProductWithPrices, priceId?: string | null): SelectedPrice | null {
  if (!product) return null;
  if (!priceId) return null;
  const prices = product.prices;
  if (!prices || prices === "include-by-default") return null;
  const selected = prices[priceId as keyof typeof prices] as ProductPriceEntry | undefined;
  if (!selected) return null;
  const { serverOnly: _serverOnly, freeTrial: _freeTrial, ...rest } = selected as any;
  return rest as SelectedPrice;
}

export function multiplyMoneyAmount(amount: string, quantity: number, currency: Currency): string {
  if (!Number.isFinite(quantity) || Math.trunc(quantity) !== quantity) {
    throw new Error("Quantity must be an integer when multiplying money amounts");
  }
  if (quantity === 0) return "0";

  const multiplierNegative = quantity < 0;
  const safeQuantity = BigInt(Math.abs(quantity));

  const isNegative = amount.startsWith("-");
  const normalized = isNegative ? amount.slice(1) : amount;
  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const paddedFractional = fractionalPart.padEnd(currency.decimals, "0");
  const smallestUnit = BigInt(`${wholePart || "0"}${paddedFractional.padEnd(currency.decimals, "0")}`);
  const multiplied = smallestUnit * safeQuantity;

  const totalDecimals = currency.decimals;
  let multipliedStr = multiplied.toString();
  if (totalDecimals > 0) {
    if (multipliedStr.length <= totalDecimals) {
      multipliedStr = multipliedStr.padStart(totalDecimals + 1, "0");
    }
  }

  let integerPart: string;
  let fractionalResult: string | null = null;
  if (totalDecimals === 0) {
    integerPart = multipliedStr;
  } else {
    integerPart = multipliedStr.slice(0, -totalDecimals) || "0";
    const rawFraction = multipliedStr.slice(-totalDecimals);
    const trimmedFraction = rawFraction.replace(/0+$/, "");
    fractionalResult = trimmedFraction.length > 0 ? trimmedFraction : null;
  }

  integerPart = integerPart.replace(/^0+(?=\d)/, "") || "0";

  let result = fractionalResult ? `${integerPart}.${fractionalResult}` : integerPart;
  const shouldBeNegative = (isNegative ? -1 : 1) * (multiplierNegative ? -1 : 1) === -1;
  if (shouldBeNegative && result !== "0") {
    result = `-${result}`;
  }

  return result;
}

export function buildChargedAmount(price: SelectedPrice | null, quantity: number): Record<string, string> {
  if (!price) return {};
  const result: Record<string, string> = {};
  for (const currency of SUPPORTED_CURRENCIES) {
    const rawAmount = price[currency.code as keyof typeof price];
    if (typeof rawAmount !== "string") continue;
    const multiplied = multiplyMoneyAmount(rawAmount, quantity, currency);
    if (multiplied === "0") continue;
    result[currency.code] = multiplied;
  }
  return result;
}

export function createMoneyTransferEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  chargedAmount: Record<string, string | undefined>,
  skip: boolean,
}): TransactionEntry | null {
  if (options.skip) return null;
  const chargedCurrencies = Object.keys(options.chargedAmount);
  if (chargedCurrencies.length === 0) return null;
  const netUsd = options.chargedAmount.USD ?? "0";
  return {
    type: "money_transfer",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    charged_amount: options.chargedAmount,
    net_amount: {
      USD: netUsd,
    },
  };
}

export function createProductGrantEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  productId: string | null,
  product: ProductSnapshot,
  priceId: string | null,
  quantity: number,
  cycleAnchor: number,
  subscriptionId?: string,
  oneTimePurchaseId?: string,
  itemQuantityChangeIndices?: Record<string, number>,
}): TransactionEntry {
  return {
    type: "product_grant",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    product_id: options.productId,
    product: options.product,
    price_id: options.priceId,
    quantity: options.quantity,
    cycle_anchor: options.cycleAnchor,
    subscription_id: options.subscriptionId,
    one_time_purchase_id: options.oneTimePurchaseId,
    item_quantity_change_indices: options.itemQuantityChangeIndices,
  };
}

export function createActiveSubscriptionStartEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  subscriptionId: string,
  productId: string | null,
  product: ProductSnapshot,
}): TransactionEntry {
  return {
    type: "active_subscription_start",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    subscription_id: options.subscriptionId,
    product_id: options.productId,
    product: options.product,
  };
}

export function createActiveSubscriptionStopEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  subscriptionId: string,
}): TransactionEntry {
  return {
    type: "active_subscription_stop",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    subscription_id: options.subscriptionId,
  };
}

export function createActiveSubscriptionChangeEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  subscriptionId: string,
  changeType: "cancel" | "reactivate" | "switch",
  productId?: string | null,
  product?: ProductSnapshot,
}): TransactionEntry {
  return {
    type: "active_subscription_change",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    subscription_id: options.subscriptionId,
    change_type: options.changeType,
    ...(options.productId !== undefined ? { product_id: options.productId } : {}),
    ...(options.product !== undefined ? { product: options.product } : {}),
  };
}

export function createItemQuantityChangeEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  itemId: string,
  quantity: number,
}): TransactionEntry {
  return {
    type: "item_quantity_change",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    item_id: options.itemId,
    quantity: options.quantity,
  };
}

export function createItemQuantityExpireEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  itemId: string,
  quantity: number,
  adjustedTransactionId: string,
  adjustedEntryIndex: number,
}): TransactionEntry {
  return {
    type: "item_quantity_expire",
    adjusted_transaction_id: options.adjustedTransactionId,
    adjusted_entry_index: options.adjustedEntryIndex,
    customer_type: options.customerType,
    customer_id: options.customerId,
    item_id: options.itemId,
    quantity: options.quantity,
  };
}

/**
 * Creates item_quantity_change entries for each included item in a product.
 */
export function createItemQuantityChangeEntriesForProduct(options: {
  product: ProductSnapshot,
  purchaseQuantity: number,
  customerType: "user" | "team" | "custom",
  customerId: string,
}): TransactionEntry[] {
  const entries: TransactionEntry[] = [];
  for (const [itemId, item] of Object.entries(options.product.included_items)) {
    const qty = (item.quantity ?? 0) * options.purchaseQuantity;
    if (qty <= 0) continue;
    entries.push(createItemQuantityChangeEntry({
      customerType: options.customerType,
      customerId: options.customerId,
      itemId,
      quantity: qty,
    }));
  }
  return entries;
}

/**
 * Creates item_quantity_expire entries for each included item in a product
 * that has `expires: "when-purchase-expires"`.
 */
export function createItemQuantityExpireEntriesForProduct(options: {
  product: ProductSnapshot,
  purchaseQuantity: number,
  customerType: "user" | "team" | "custom",
  customerId: string,
  adjustedTransactionId: string,
  itemQuantityChangeIndices: Record<string, number>,
}): TransactionEntry[] {
  const entries: TransactionEntry[] = [];
  for (const [itemId, item] of Object.entries(options.product.included_items)) {
    if (item.expires !== "when-purchase-expires") continue;
    const qty = (item.quantity ?? 0) * options.purchaseQuantity;
    if (qty <= 0) continue;
    entries.push(createItemQuantityExpireEntry({
      customerType: options.customerType,
      customerId: options.customerId,
      itemId,
      quantity: qty,
      adjustedTransactionId: options.adjustedTransactionId,
      adjustedEntryIndex: options.itemQuantityChangeIndices[itemId] ?? throwErr(`item_quantity_change index not found for item ${itemId}`),
    }));
  }
  return entries;
}

export function createProductRevocationEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  adjustedTransactionId: string,
  adjustedEntryIndex: number,
  quantity: number,
}): TransactionEntry {
  return {
    type: "product_revocation",
    adjusted_transaction_id: options.adjustedTransactionId,
    adjusted_entry_index: options.adjustedEntryIndex,
    customer_type: options.customerType,
    customer_id: options.customerId,
    quantity: options.quantity,
  };
}

export function createDefaultProductsChangeEntry(options: {
  snapshot: Record<string, ProductSnapshot>,
}): TransactionEntry {
  // Type assertion needed until dist types are rebuilt to include the new entry type
  return {
    type: "default_products_change" as any,
    snapshot: options.snapshot,
  } as any;
}

export function buildRefundAdjustments(options: { refundedAt?: Date | null, entries: TransactionEntry[], transactionId: string }): Transaction["adjusted_by"] {
  if (!options.refundedAt) {
    return [];
  }
  const productGrantIndex = options.entries.findIndex((entry) => entry.type === "product_grant");
  const entryIndex = productGrantIndex >= 0 ? productGrantIndex : 0;
  return [{
    transaction_id: `${options.transactionId}${REFUND_TRANSACTION_SUFFIX}`,
    entry_index: entryIndex,
  }];
}

export function compareTransactions(_orderBy: TransactionOrderBy, a: Transaction, b: Transaction): number {
  if (a.created_at_millis === b.created_at_millis) {
    return a.id < b.id ? 1 : -1;
  }
  return a.created_at_millis < b.created_at_millis ? 1 : -1;
}

/**
 * Returns an empty PaginatedList with the correct compare function for transactions.
 * Unlike PaginatedList.empty(), this ensures the compare function is consistent
 * with other transaction lists when used in PaginatedList.merge().
 */
export function emptyTransactionList(): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  class EmptyTransactionList extends PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
    override _getFirstCursor() { return ""; }
    override _getLastCursor() { return ""; }
    override _compare(orderBy: TransactionOrderBy, a: Transaction, b: Transaction) {
      return compareTransactions(orderBy, a, b);
    }
    override async _nextOrPrev() {
      return { items: [], isFirst: true, isLast: true, cursor: "" };
    }
  }
  return new EmptyTransactionList();
}

/**
 * Creates a PaginatedList backed by a single Prisma table. Each per-type transaction
 * file uses this to avoid duplicating the cursor/pagination boilerplate.
 */
export function createSingleTableTransactionList<Row extends { id: string, createdAt: Date }>(options: {
  query: (prisma: PrismaClientTransaction, tenancyId: string, filter: TransactionFilter, cursorWhere: object | undefined, limit: number) => Promise<Row[]>,
  cursorLookup: (prisma: PrismaClientTransaction, tenancyId: string, cursorId: string) => Promise<{ createdAt: Date } | null>,
  toTransaction: (row: Row) => Transaction,
  prisma: PrismaClientTransaction,
  tenancyId: string,
}): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  class SingleTableList extends PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
    override _getFirstCursor() { return ""; }
    override _getLastCursor() { return ""; }
    override _compare(orderBy: TransactionOrderBy, a: Transaction, b: Transaction) {
      return compareTransactions(orderBy, a, b);
    }

    override async _nextOrPrev(
      _type: "next" | "prev",
      opts: { cursor: string, limit: number, limitPrecision: "approximate", filter: TransactionFilter, orderBy: TransactionOrderBy },
    ) {
      const prisma = options.prisma;
      let cursorWhere: object | undefined;
      if (opts.cursor) {
        const pivot = await options.cursorLookup(prisma, options.tenancyId, opts.cursor);
        if (pivot) {
          cursorWhere = {
            OR: [
              { createdAt: { lt: pivot.createdAt } },
              { AND: [{ createdAt: { equals: pivot.createdAt } }, { id: { lt: opts.cursor } }] },
            ],
          };
        }
      }

      const rows = await options.query(prisma, options.tenancyId, opts.filter, cursorWhere, opts.limit);
      const items = rows.map((row) => {
        const tx = options.toTransaction(row);
        return { item: tx, prevCursor: row.id, nextCursor: row.id };
      });

      const lastId = rows.length > 0 ? rows[rows.length - 1].id : opts.cursor;

      return {
        items,
        isFirst: !opts.cursor,
        isLast: rows.length < opts.limit,
        cursor: lastId,
      };
    }
  }
  return new SingleTableList();
}
