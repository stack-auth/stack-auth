import { CustomerType, ItemQuantityChange, OneTimePurchase, ProductChange, StripeRefund, Subscription, SubscriptionChange, SubscriptionInvoice } from "@/generated/prisma/client";
import { PrismaClientTransaction } from "@/prisma-client";
import { inlineProductSchema, productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { FAR_FUTURE_DATE, addInterval, getIntervalsElapsed } from "@stackframe/stack-shared/dist/utils/dates";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { stringCompare, typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { InferType } from "yup";
import { getSubscriptions, productToInlineProduct } from "./payments";
import { Tenancy } from "./tenancies";

// ============================================================================
// Transaction Entry Types
// ============================================================================

type CustomerTypeValue = "user" | "team" | "custom";

type BaseTransactionEntry = {
  adjusted_transaction_id: string | null,
  adjusted_entry_index: number | null,
};

type ActiveSubStartEntry = BaseTransactionEntry & {
  type: "active_sub_start",
  customer_type: CustomerTypeValue,
  customer_id: string,
  subscription_id: string,
  product_id: string | null,
  price_id: string | null,
};

type ActiveSubChangeEntry = BaseTransactionEntry & {
  type: "active_sub_change",
  customer_type: CustomerTypeValue,
  customer_id: string,
  subscription_id: string,
  old_product_id: string | null,
  new_product_id: string | null,
  old_price_id: string | null,
  new_price_id: string | null,
};

type ActiveSubStopEntry = BaseTransactionEntry & {
  type: "active_sub_stop",
  customer_type: CustomerTypeValue,
  customer_id: string,
  subscription_id: string,
};

type MoneyTransferEntry = BaseTransactionEntry & {
  type: "money_transfer",
  customer_type: CustomerTypeValue,
  customer_id: string,
  charged_amount: Record<string, string>,
  net_amount: { USD: string },
};

type ProductGrantEntry = BaseTransactionEntry & {
  type: "product_grant",
  customer_type: CustomerTypeValue,
  customer_id: string,
  product_id: string | null,
  product: InferType<typeof inlineProductSchema>,
  price_id: string | null,
  quantity: number,
  subscription_id?: string,
  one_time_purchase_id?: string,
};

type ProductRevocationEntry = BaseTransactionEntry & {
  type: "product_revocation",
  adjusted_transaction_id: string,
  adjusted_entry_index: number,
  quantity: number,
};

type ItemQuantityChangeEntry = BaseTransactionEntry & {
  type: "item_quantity_change",
  customer_type: CustomerTypeValue,
  customer_id: string,
  item_id: string,
  quantity: number,
};

type ItemQuantityExpireEntry = BaseTransactionEntry & {
  type: "item_quantity_expire",
  adjusted_transaction_id: string,
  adjusted_entry_index: number,
  item_id: string,
  quantity: number,
};

export type NewTransactionEntry =
  | ActiveSubStartEntry
  | ActiveSubChangeEntry
  | ActiveSubStopEntry
  | MoneyTransferEntry
  | ProductGrantEntry
  | ProductRevocationEntry
  | ItemQuantityChangeEntry
  | ItemQuantityExpireEntry;

// ============================================================================
// Transaction Types
// ============================================================================

export const NEW_TRANSACTION_TYPES = [
  "new-stripe-sub",
  "stripe-resub",
  "stripe-one-time",
  "stripe-expire",
  "stripe-refund",
  "manual-item-quantity-change",
  "product-change",
  "sub-change",
  "stripe-sub-cancel",
  "item-quantity-renewal",
] as const;

export type NewTransactionType = (typeof NEW_TRANSACTION_TYPES)[number];

export type NewTransaction = {
  id: string,
  type: NewTransactionType,
  created_at_millis: number,
  effective_at_millis: number,
  entries: NewTransactionEntry[],
  adjusted_by: Array<{
    transaction_id: string,
    entry_index: number,
  }>,
  test_mode: boolean,
};

// ============================================================================
// Filter and OrderBy Types
// ============================================================================

export type TransactionFilter = {
  tenancyId: string,
  customerType?: CustomerTypeValue,
  customerId?: string,
  transactionType?: NewTransactionType,
};

export type TransactionOrderBy = {
  field: "createdAt" | "effectiveAt",
  direction: "asc" | "desc",
};

// ============================================================================
// Cursor Type
// ============================================================================

type TransactionCursor = `cursor:${string}:${string}` | "first" | "last";

function encodeCursor(createdAt: Date, id: string): TransactionCursor {
  return `cursor:${createdAt.toISOString()}:${id}`;
}

function decodeCursor(cursor: TransactionCursor): { createdAt: Date, id: string } | null {
  if (cursor === "first" || cursor === "last") return null;
  const [, dateStr, id] = cursor.split(":");
  return { createdAt: new Date(dateStr), id };
}

// ============================================================================
// Helper Functions
// ============================================================================

function customerTypeToCrud(customerType: CustomerType): CustomerTypeValue {
  return typedToLowercase(customerType);
}

function buildChargedAmount(
  product: InferType<typeof productSchema>,
  priceId: string | null,
  quantity: number
): Record<string, string> {
  if (!priceId || product.prices === "include-by-default") return {};
  const price = getOrUndefined(product.prices, priceId);
  if (!price) return {};

  const result: Record<string, string> = {};
  const currencyCodes = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CNY", "INR", "BRL", "MXN", "CHF", "SGD", "HKD", "KRW", "SEK", "NOK", "DKK", "NZD"];

  for (const code of currencyCodes) {
    const amount = price[code as keyof typeof price];
    if (typeof amount === "string" && amount !== "0") {
      // Simple multiplication (assumes integer quantities for now)
      const numValue = parseFloat(amount);
      if (!isNaN(numValue)) {
        result[code] = (numValue * quantity).toString();
      }
    }
  }

  return result;
}

// ============================================================================
// Transaction Builders
// ============================================================================

function buildNewStripeSubTransaction(subscription: Subscription): NewTransaction {
  const product = subscription.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const customerType = customerTypeToCrud(subscription.customerType);
  const chargedAmount = buildChargedAmount(product, subscription.priceId ?? null, subscription.quantity);
  const testMode = subscription.creationSource === "TEST_MODE";

  const entries: NewTransactionEntry[] = [];

  // active_sub_start entry
  entries.push({
    type: "active_sub_start",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: customerType,
    customer_id: subscription.customerId,
    subscription_id: subscription.id,
    product_id: subscription.productId ?? null,
    price_id: subscription.priceId ?? null,
  });

  // money-transfer entry (if not test mode and has charged amount)
  if (!testMode && Object.keys(chargedAmount).length > 0) {
    entries.push({
      type: "money_transfer",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: subscription.customerId,
      charged_amount: chargedAmount,
      net_amount: { USD: getOrUndefined(chargedAmount, "USD") ?? "0" },
    });
  }

  // product-grant entry
  entries.push({
    type: "product_grant",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: customerType,
    customer_id: subscription.customerId,
    product_id: subscription.productId ?? null,
    product: inlineProduct,
    price_id: subscription.priceId ?? null,
    quantity: subscription.quantity,
    subscription_id: subscription.id,
  });

  // item-quant-change entries for included items
  const includedItems = getOrUndefined(product, "includedItems") ?? {};
  for (const [itemId, itemConfig] of Object.entries(includedItems)) {
    const itemQuantity = (itemConfig as { quantity?: number }).quantity ?? 0;
    if (itemQuantity > 0) {
      entries.push({
        type: "item_quantity_change",
        adjusted_transaction_id: null,
        adjusted_entry_index: null,
        customer_type: customerType,
        customer_id: subscription.customerId,
        item_id: itemId,
        quantity: itemQuantity * subscription.quantity,
      });
    }
  }

  return {
    id: subscription.id,
    type: "new-stripe-sub",
    created_at_millis: subscription.createdAt.getTime(),
    effective_at_millis: subscription.createdAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: testMode,
  };
}

function buildStripeResubTransaction(
  subscription: Subscription,
  invoice: SubscriptionInvoice
): NewTransaction {
  const product = subscription.product as InferType<typeof productSchema>;
  const customerType = customerTypeToCrud(subscription.customerType);
  const chargedAmount = buildChargedAmount(product, subscription.priceId ?? null, subscription.quantity);

  const entries: NewTransactionEntry[] = [];

  // money-transfer entry
  if (Object.keys(chargedAmount).length > 0) {
    entries.push({
      type: "money_transfer",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: subscription.customerId,
      charged_amount: chargedAmount,
      net_amount: { USD: getOrUndefined(chargedAmount, "USD") ?? "0" },
    });
  }

  // item-quant-expire entries (adjusts previous)
  // Note: These would need reference to the original transaction that granted items
  const includedItems = getOrUndefined(product, "includedItems") ?? {};
  for (const [itemId, itemConfig] of Object.entries(includedItems)) {
    const config = itemConfig as { quantity?: number, expires?: string };
    if (config.expires === "when-purchase-expires" && (config.quantity ?? 0) > 0) {
      entries.push({
        type: "item_quantity_expire",
        adjusted_transaction_id: subscription.id, // Reference to original subscription
        adjusted_entry_index: 0, // Would need to be calculated properly
        item_id: itemId,
        quantity: (config.quantity ?? 0) * subscription.quantity,
      });
    }
  }

  // item-quant-change entries for renewed items
  for (const [itemId, itemConfig] of Object.entries(includedItems)) {
    const itemQuantity = (itemConfig as { quantity?: number }).quantity ?? 0;
    if (itemQuantity > 0) {
      entries.push({
        type: "item_quantity_change",
        adjusted_transaction_id: null,
        adjusted_entry_index: null,
        customer_type: customerType,
        customer_id: subscription.customerId,
        item_id: itemId,
        quantity: itemQuantity * subscription.quantity,
      });
    }
  }

  return {
    id: invoice.id,
    type: "stripe-resub",
    created_at_millis: invoice.createdAt.getTime(),
    effective_at_millis: invoice.createdAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

function buildStripeOneTimeTransaction(purchase: OneTimePurchase): NewTransaction {
  const product = purchase.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const customerType = customerTypeToCrud(purchase.customerType);
  const chargedAmount = buildChargedAmount(product, purchase.priceId ?? null, purchase.quantity);
  const testMode = purchase.creationSource === "TEST_MODE";

  const entries: NewTransactionEntry[] = [];

  // money-transfer entry (if not test mode and has charged amount)
  if (!testMode && Object.keys(chargedAmount).length > 0) {
    entries.push({
      type: "money_transfer",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: purchase.customerId,
      charged_amount: chargedAmount,
      net_amount: { USD: getOrUndefined(chargedAmount, "USD") ?? "0" },
    });
  }

  // product-grant entry
  entries.push({
    type: "product_grant",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: customerType,
    customer_id: purchase.customerId,
    product_id: purchase.productId ?? null,
    product: inlineProduct,
    price_id: purchase.priceId ?? null,
    quantity: purchase.quantity,
    one_time_purchase_id: purchase.id,
  });

  // item-quant-change entries for included items
  const includedItems = getOrUndefined(product, "includedItems") ?? {};
  for (const [itemId, itemConfig] of Object.entries(includedItems)) {
    const itemQuantity = (itemConfig as { quantity?: number }).quantity ?? 0;
    if (itemQuantity > 0) {
      entries.push({
        type: "item_quantity_change",
        adjusted_transaction_id: null,
        adjusted_entry_index: null,
        customer_type: customerType,
        customer_id: purchase.customerId,
        item_id: itemId,
        quantity: itemQuantity * purchase.quantity,
      });
    }
  }

  return {
    id: purchase.id,
    type: "stripe-one-time",
    created_at_millis: purchase.createdAt.getTime(),
    effective_at_millis: purchase.createdAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: testMode,
  };
}

function buildStripeExpireTransaction(subscription: Subscription): NewTransaction {
  const product = subscription.product as InferType<typeof productSchema>;
  const customerType = customerTypeToCrud(subscription.customerType);

  const entries: NewTransactionEntry[] = [];

  // product-revocation entry (adjusts the original product grant)
  entries.push({
    type: "product_revocation",
    adjusted_transaction_id: subscription.id,
    adjusted_entry_index: 0, // Index of product_grant in original transaction
    quantity: subscription.quantity,
  });

  // item-quant-expire entries for included items
  const includedItems = getOrUndefined(product, "includedItems") ?? {};
  let entryIndex = 1; // Start after product_grant
  for (const [itemId, itemConfig] of Object.entries(includedItems)) {
    const config = itemConfig as { quantity?: number, expires?: string };
    if (config.expires === "when-purchase-expires" && (config.quantity ?? 0) > 0) {
      entries.push({
        type: "item_quantity_expire",
        adjusted_transaction_id: subscription.id,
        adjusted_entry_index: entryIndex,
        item_id: itemId,
        quantity: (config.quantity ?? 0) * subscription.quantity,
      });
      entryIndex++;
    }
  }

  // effectiveAt is the period end, not createdAt
  const effectiveAt = subscription.currentPeriodEnd;

  return {
    id: `${subscription.id}:expire`,
    type: "stripe-expire",
    created_at_millis: subscription.createdAt.getTime(),
    effective_at_millis: effectiveAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: subscription.creationSource === "TEST_MODE",
  };
}

function buildStripeSubCancelTransaction(subscription: Subscription): NewTransaction {
  const customerType = customerTypeToCrud(subscription.customerType);

  const entries: NewTransactionEntry[] = [];

  // active_sub_stop entry (adjusts the active_sub_start)
  entries.push({
    type: "active_sub_stop",
    adjusted_transaction_id: subscription.id,
    adjusted_entry_index: 0, // Index of active_sub_start in original transaction
    customer_type: customerType,
    customer_id: subscription.customerId,
    subscription_id: subscription.id,
  });

  return {
    id: `${subscription.id}:cancel`,
    type: "stripe-sub-cancel",
    created_at_millis: subscription.updatedAt.getTime(),
    effective_at_millis: subscription.updatedAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: subscription.creationSource === "TEST_MODE",
  };
}

function buildManualItemQuantityChangeTransaction(change: ItemQuantityChange): NewTransaction {
  const customerType = customerTypeToCrud(change.customerType);

  const entries: NewTransactionEntry[] = [{
    type: "item_quantity_change",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: customerType,
    customer_id: change.customerId,
    item_id: change.itemId,
    quantity: change.quantity,
  }];

  return {
    id: change.id,
    type: "manual-item-quantity-change",
    created_at_millis: change.createdAt.getTime(),
    effective_at_millis: change.createdAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

function buildStripeRefundTransaction(refund: StripeRefund): NewTransaction {
  const customerType = customerTypeToCrud(refund.customerType);

  // Convert cents to decimal string (e.g., 1000 cents -> "10.00")
  const amountStr = (refund.amountCents / 100).toFixed(2);
  const negativeAmount = `-${amountStr}`;

  const entries: NewTransactionEntry[] = [{
    type: "money_transfer",
    adjusted_transaction_id: refund.subscriptionId ?? refund.oneTimePurchaseId ?? null,
    adjusted_entry_index: 0, // Assumes money_transfer is first entry in original
    customer_type: customerType,
    customer_id: refund.customerId,
    charged_amount: { [refund.currency]: negativeAmount },
    net_amount: { USD: refund.currency === "USD" ? negativeAmount : "0" },
  }];

  return {
    id: refund.id,
    type: "stripe-refund",
    created_at_millis: refund.createdAt.getTime(),
    effective_at_millis: refund.createdAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

function buildProductChangeTransaction(change: ProductChange): NewTransaction {
  const customerType = customerTypeToCrud(change.customerType);
  const entries: NewTransactionEntry[] = [];

  // Product revocation for old product (if any)
  if (change.oldProductId && change.subscriptionId) {
    entries.push({
      type: "product_revocation",
      adjusted_transaction_id: change.subscriptionId,
      adjusted_entry_index: 0, // Assumes product_grant is first entry
      quantity: change.oldQuantity,
    });
  }

  // Product grant for new product (if any)
  if (change.newProductId && change.newProduct) {
    const newProduct = change.newProduct as InferType<typeof productSchema>;
    const inlineProduct = productToInlineProduct(newProduct);

    entries.push({
      type: "product_grant",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: change.customerId,
      product_id: change.newProductId,
      product: inlineProduct,
      price_id: change.newPriceId ?? null,
      quantity: change.newQuantity,
      subscription_id: change.subscriptionId ?? undefined,
    });

    // Item quantity changes for new product's included items
    const includedItems = getOrUndefined(newProduct, "includedItems") ?? {};
    for (const [itemId, itemConfig] of Object.entries(includedItems)) {
      const itemQuantity = (itemConfig as { quantity?: number }).quantity ?? 0;
      if (itemQuantity > 0) {
        entries.push({
          type: "item_quantity_change",
          adjusted_transaction_id: null,
          adjusted_entry_index: null,
          customer_type: customerType,
          customer_id: change.customerId,
          item_id: itemId,
          quantity: itemQuantity * change.newQuantity,
        });
      }
    }
  }

  // Item quantity expire for old product's included items
  if (change.oldProduct && change.subscriptionId) {
    const oldProduct = change.oldProduct as InferType<typeof productSchema>;
    const includedItems = getOrUndefined(oldProduct, "includedItems") ?? {};
    let entryIndex = 1; // Start after product_grant
    for (const [itemId, itemConfig] of Object.entries(includedItems)) {
      const config = itemConfig as { quantity?: number, expires?: string };
      if (config.expires === "when-purchase-expires" && (config.quantity ?? 0) > 0) {
        entries.push({
          type: "item_quantity_expire",
          adjusted_transaction_id: change.subscriptionId,
          adjusted_entry_index: entryIndex,
          item_id: itemId,
          quantity: (config.quantity ?? 0) * change.oldQuantity,
        });
        entryIndex++;
      }
    }
  }

  return {
    id: change.id,
    type: "product-change",
    created_at_millis: change.createdAt.getTime(),
    effective_at_millis: change.createdAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

function buildSubscriptionChangeTransaction(change: SubscriptionChange): NewTransaction {
  const customerType = customerTypeToCrud(change.customerType);

  const oldValue = change.oldValue as { productId?: string, priceId?: string } | null;
  const newValue = change.newValue as { productId?: string, priceId?: string } | null;

  const entries: NewTransactionEntry[] = [{
    type: "active_sub_change",
    adjusted_transaction_id: change.subscriptionId,
    adjusted_entry_index: 0, // Assumes active_sub_start is first entry
    customer_type: customerType,
    customer_id: change.customerId,
    subscription_id: change.subscriptionId,
    old_product_id: oldValue?.productId ?? null,
    new_product_id: newValue?.productId ?? null,
    old_price_id: oldValue?.priceId ?? null,
    new_price_id: newValue?.priceId ?? null,
  }];

  return {
    id: change.id,
    type: "sub-change",
    created_at_millis: change.createdAt.getTime(),
    effective_at_millis: change.createdAt.getTime(),
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

/**
 * Item quantity renewal transaction - represents when items with repeat/expires
 * settings have their quantities renewed/expired.
 */
type ItemQuantityRenewalData = {
  id: string,
  subscriptionId: string,
  customerId: string,
  customerType: CustomerType,
  itemId: string,
  quantity: number,
  windowStart: Date,
  windowEnd: Date,
  previousWindowTransactionId: string | null,
};

function buildItemQuantityRenewalTransaction(renewal: ItemQuantityRenewalData): NewTransaction {
  const customerType = customerTypeToCrud(renewal.customerType);

  const entries: NewTransactionEntry[] = [];

  // If there was a previous window, add expire entry
  if (renewal.previousWindowTransactionId) {
    entries.push({
      type: "item_quantity_expire",
      adjusted_transaction_id: renewal.previousWindowTransactionId,
      adjusted_entry_index: 0,
      item_id: renewal.itemId,
      quantity: renewal.quantity,
    });
  }

  // Add new quantity change entry
  entries.push({
    type: "item_quantity_change",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: customerType,
    customer_id: renewal.customerId,
    item_id: renewal.itemId,
    quantity: renewal.quantity,
  });

  return {
    id: renewal.id,
    type: "item-quantity-renewal",
    created_at_millis: renewal.windowStart.getTime(),
    effective_at_millis: renewal.windowStart.getTime(),
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

// ============================================================================
// Paginated List Implementations
// ============================================================================

type PrismaQueryOptions = {
  tenancyId: string,
  customerType?: CustomerTypeValue,
  customerId?: string,
};

/**
 * Base class for database-backed paginated transaction lists
 */
abstract class DatabasePaginatedList<DbRow> extends PaginatedList<
  NewTransaction,
  TransactionCursor,
  TransactionFilter,
  TransactionOrderBy
> {
  protected abstract fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ): Promise<DbRow[]>;

  protected abstract rowToTransaction(row: DbRow): NewTransaction;
  protected abstract getRowId(row: DbRow): string;
  protected abstract getRowCreatedAt(row: DbRow): Date;

  constructor(protected readonly prisma: PrismaClientTransaction) {
    super();
  }

  override _getFirstCursor(): TransactionCursor {
    return "first";
  }

  override _getLastCursor(): TransactionCursor {
    return "last";
  }

  override _compare(orderBy: TransactionOrderBy, a: NewTransaction, b: NewTransaction): number {
    const aTime = orderBy.field === "createdAt" ? a.created_at_millis : a.effective_at_millis;
    const bTime = orderBy.field === "createdAt" ? b.created_at_millis : b.effective_at_millis;

    if (orderBy.direction === "desc") {
      if (aTime !== bTime) return bTime - aTime;
      return stringCompare(b.id, a.id);
    } else {
      if (aTime !== bTime) return aTime - bTime;
      return stringCompare(a.id, b.id);
    }
  }

  override async _nextOrPrev(
    type: "next" | "prev",
    options: {
      cursor: TransactionCursor,
      limit: number,
      limitPrecision: "approximate",
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
    }
  ) {
    const cursorData = decodeCursor(options.cursor);

    const rows = await this.fetchFromDatabase(this.prisma, {
      filter: options.filter,
      orderBy: options.orderBy,
      cursor: cursorData,
      limit: options.limit,
      direction: type,
    });

    const items = rows.map((row) => {
      const transaction = this.rowToTransaction(row);
      const itemCursor = encodeCursor(this.getRowCreatedAt(row), this.getRowId(row));
      return { item: transaction, itemCursor };
    });

    const isFirst = options.cursor === "first" || (type === "prev" && rows.length < options.limit);
    const isLast = options.cursor === "last" || (type === "next" && rows.length < options.limit);
    const lastItem = items[items.length - 1] as { item: NewTransaction, itemCursor: TransactionCursor } | undefined;
    const cursor = lastItem?.itemCursor ?? options.cursor;

    return { items, isFirst, isLast, cursor };
  }
}

/**
 * Paginated list for new Stripe subscriptions
 */
class NewStripeSubPaginatedList extends DatabasePaginatedList<Subscription> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
      // Only active subscriptions that are not cancelled
      cancelAtPeriodEnd: false,
      status: { in: ["active", "trialing"] },
    };

    if (options.filter.customerType) {
      where.customerType = options.filter.customerType.toUpperCase();
    }
    if (options.filter.customerId) {
      where.customerId = options.filter.customerId;
    }

    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { createdAt: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { createdAt: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.subscription.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      orderBy: [
        { createdAt: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: Subscription): NewTransaction {
    return buildNewStripeSubTransaction(row);
  }

  protected override getRowId(row: Subscription): string {
    return row.id;
  }

  protected override getRowCreatedAt(row: Subscription): Date {
    return row.createdAt;
  }
}

/**
 * Paginated list for Stripe subscription renewals (resub)
 */
class StripeResubPaginatedList extends DatabasePaginatedList<SubscriptionInvoice & { subscription: Subscription }> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
      isSubscriptionCreationInvoice: false,
    };

    if (options.filter.customerType) {
      where.subscription = { customerType: options.filter.customerType.toUpperCase() };
    }
    if (options.filter.customerId) {
      const existingSub = (where.subscription ?? {}) as object;
      where.subscription = { ...existingSub, customerId: options.filter.customerId };
    }

    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { createdAt: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { createdAt: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.subscriptionInvoice.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      include: { subscription: true },
      orderBy: [
        { createdAt: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: SubscriptionInvoice & { subscription: Subscription }): NewTransaction {
    return buildStripeResubTransaction(row.subscription, row);
  }

  protected override getRowId(row: SubscriptionInvoice): string {
    return row.id;
  }

  protected override getRowCreatedAt(row: SubscriptionInvoice): Date {
    return row.createdAt;
  }
}

/**
 * Paginated list for Stripe one-time purchases
 */
class StripeOneTimePaginatedList extends DatabasePaginatedList<OneTimePurchase> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
    };

    if (options.filter.customerType) {
      where.customerType = options.filter.customerType.toUpperCase();
    }
    if (options.filter.customerId) {
      where.customerId = options.filter.customerId;
    }

    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { createdAt: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { createdAt: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.oneTimePurchase.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      orderBy: [
        { createdAt: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: OneTimePurchase): NewTransaction {
    return buildStripeOneTimeTransaction(row);
  }

  protected override getRowId(row: OneTimePurchase): string {
    return row.id;
  }

  protected override getRowCreatedAt(row: OneTimePurchase): Date {
    return row.createdAt;
  }
}

/**
 * Paginated list for Stripe subscription expirations
 * (subscriptions with cancelAtPeriodEnd=true, where effectiveAt differs from createdAt)
 */
class StripeExpirePaginatedList extends DatabasePaginatedList<Subscription> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
      cancelAtPeriodEnd: true,
      status: { in: ["active", "trialing", "canceled"] },
    };

    if (options.filter.customerType) {
      where.customerType = options.filter.customerType.toUpperCase();
    }
    if (options.filter.customerId) {
      where.customerId = options.filter.customerId;
    }

    // For expire transactions, we use currentPeriodEnd as the effective date
    // and order by it instead of createdAt
    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { currentPeriodEnd: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { currentPeriodEnd: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.subscription.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      orderBy: [
        { currentPeriodEnd: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: Subscription): NewTransaction {
    return buildStripeExpireTransaction(row);
  }

  protected override getRowId(row: Subscription): string {
    return `${row.id}:expire`;
  }

  protected override getRowCreatedAt(row: Subscription): Date {
    // Use currentPeriodEnd as the "created at" for cursor purposes
    return row.currentPeriodEnd;
  }
}

/**
 * Paginated list for Stripe subscription cancellations
 */
class StripeSubCancelPaginatedList extends DatabasePaginatedList<Subscription> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
      cancelAtPeriodEnd: true,
    };

    if (options.filter.customerType) {
      where.customerType = options.filter.customerType.toUpperCase();
    }
    if (options.filter.customerId) {
      where.customerId = options.filter.customerId;
    }

    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { updatedAt: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { updatedAt: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.subscription.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      orderBy: [
        { updatedAt: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: Subscription): NewTransaction {
    return buildStripeSubCancelTransaction(row);
  }

  protected override getRowId(row: Subscription): string {
    return `${row.id}:cancel`;
  }

  protected override getRowCreatedAt(row: Subscription): Date {
    return row.updatedAt;
  }
}

/**
 * Paginated list for manual item quantity changes
 */
class ManualItemQuantityChangePaginatedList extends DatabasePaginatedList<ItemQuantityChange> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
    };

    if (options.filter.customerType) {
      where.customerType = options.filter.customerType.toUpperCase();
    }
    if (options.filter.customerId) {
      where.customerId = options.filter.customerId;
    }

    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { createdAt: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { createdAt: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.itemQuantityChange.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      orderBy: [
        { createdAt: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: ItemQuantityChange): NewTransaction {
    return buildManualItemQuantityChangeTransaction(row);
  }

  protected override getRowId(row: ItemQuantityChange): string {
    return row.id;
  }

  protected override getRowCreatedAt(row: ItemQuantityChange): Date {
    return row.createdAt;
  }
}

/**
 * Paginated list for Stripe refunds
 */
class StripeRefundPaginatedList extends DatabasePaginatedList<StripeRefund> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
    };

    if (options.filter.customerType) {
      where.customerType = options.filter.customerType.toUpperCase();
    }
    if (options.filter.customerId) {
      where.customerId = options.filter.customerId;
    }

    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { createdAt: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { createdAt: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.stripeRefund.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      orderBy: [
        { createdAt: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: StripeRefund): NewTransaction {
    return buildStripeRefundTransaction(row);
  }

  protected override getRowId(row: StripeRefund): string {
    return row.id;
  }

  protected override getRowCreatedAt(row: StripeRefund): Date {
    return row.createdAt;
  }
}

/**
 * Paginated list for product changes
 */
class ProductChangePaginatedList extends DatabasePaginatedList<ProductChange> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
    };

    if (options.filter.customerType) {
      where.customerType = options.filter.customerType.toUpperCase();
    }
    if (options.filter.customerId) {
      where.customerId = options.filter.customerId;
    }

    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { createdAt: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { createdAt: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.productChange.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      orderBy: [
        { createdAt: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: ProductChange): NewTransaction {
    return buildProductChangeTransaction(row);
  }

  protected override getRowId(row: ProductChange): string {
    return row.id;
  }

  protected override getRowCreatedAt(row: ProductChange): Date {
    return row.createdAt;
  }
}

/**
 * Paginated list for subscription changes
 */
class SubscriptionChangePaginatedList extends DatabasePaginatedList<SubscriptionChange> {
  protected override async fetchFromDatabase(
    prisma: PrismaClientTransaction,
    options: {
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
      cursor: { createdAt: Date, id: string } | null,
      limit: number,
      direction: "next" | "prev",
    }
  ) {
    const isDesc = options.orderBy.direction === "desc";
    const isNext = options.direction === "next";
    const orderDir = (isDesc === isNext) ? "desc" : "asc";

    const where: Record<string, unknown> = {
      tenancyId: options.filter.tenancyId,
    };

    if (options.filter.customerType) {
      where.customerType = options.filter.customerType.toUpperCase();
    }
    if (options.filter.customerId) {
      where.customerId = options.filter.customerId;
    }

    if (options.cursor) {
      const compareOp = orderDir === "desc" ? "lt" : "gt";
      where.OR = [
        { createdAt: { [compareOp]: options.cursor.createdAt } },
        {
          AND: [
            { createdAt: { equals: options.cursor.createdAt } },
            { id: { [compareOp]: options.cursor.id } },
          ],
        },
      ];
    }

    return await prisma.subscriptionChange.findMany({
      where: where as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Prisma types are complex
      orderBy: [
        { createdAt: orderDir },
        { id: orderDir },
      ],
      take: options.limit,
    });
  }

  protected override rowToTransaction(row: SubscriptionChange): NewTransaction {
    return buildSubscriptionChangeTransaction(row);
  }

  protected override getRowId(row: SubscriptionChange): string {
    return row.id;
  }

  protected override getRowCreatedAt(row: SubscriptionChange): Date {
    return row.createdAt;
  }
}

/**
 * Paginated list for item quantity renewals.
 * This is a computed paginated list that generates virtual transactions
 * based on subscriptions with repeating item quantities.
 */
class ItemQuantityRenewalPaginatedList extends PaginatedList<
  NewTransaction,
  TransactionCursor,
  TransactionFilter,
  TransactionOrderBy
> {
  constructor(
    private readonly prisma: PrismaClientTransaction,
    private readonly tenancy: Tenancy
  ) {
    super();
  }

  override _getFirstCursor(): TransactionCursor {
    return "first";
  }

  override _getLastCursor(): TransactionCursor {
    return "last";
  }

  override _compare(orderBy: TransactionOrderBy, a: NewTransaction, b: NewTransaction): number {
    const aTime = orderBy.field === "createdAt" ? a.created_at_millis : a.effective_at_millis;
    const bTime = orderBy.field === "createdAt" ? b.created_at_millis : b.effective_at_millis;

    if (orderBy.direction === "desc") {
      if (aTime !== bTime) return bTime - aTime;
      return stringCompare(b.id, a.id);
    } else {
      if (aTime !== bTime) return aTime - bTime;
      return stringCompare(a.id, b.id);
    }
  }

  override async _nextOrPrev(
    type: "next" | "prev",
    options: {
      cursor: TransactionCursor,
      limit: number,
      limitPrecision: "approximate",
      filter: TransactionFilter,
      orderBy: TransactionOrderBy,
    }
  ) {
    const now = new Date();
    const renewals: ItemQuantityRenewalData[] = [];

    // Get all subscriptions for the tenancy
    const subscriptions = await getSubscriptions({
      prisma: this.prisma,
      tenancy: this.tenancy,
      customerType: options.filter.customerType ?? "user",
      customerId: options.filter.customerId ?? "",
    });

    // If filtering by customer, we need the customerId
    if (!options.filter.customerId) {
      // Need to get all customers with subscriptions that have repeating items
      // This is complex - for now, return empty if no customer filter
      // In a real implementation, we'd iterate through all customers
      return {
        items: [],
        isFirst: true,
        isLast: true,
        cursor: options.cursor,
      };
    }

    for (const subscription of subscriptions) {
      if (!subscription.id) continue; // Skip default subscriptions

      const product = subscription.product;
      const includedItems = getOrUndefined(product, "includedItems") ?? {};

      for (const [itemId, itemConfig] of Object.entries(includedItems)) {
        const config = itemConfig as {
          quantity?: number,
          repeat?: [number, "day" | "week" | "month" | "year"] | "never",
          expires?: string,
        };

        // Only process items with repeat and expires=when-repeated
        if (!config.repeat || config.repeat === "never") continue;
        if (config.expires !== "when-repeated") continue;

        const baseQty = (config.quantity ?? 0) * subscription.quantity;
        if (baseQty <= 0) continue;

        const repeat = config.repeat;
        const pStart = subscription.currentPeriodStart;
        const pEnd = subscription.currentPeriodEnd ?? FAR_FUTURE_DATE;
        const nowClamped = now < pEnd ? now : pEnd;

        if (nowClamped < pStart) continue;

        const elapsed = getIntervalsElapsed(subscription.createdAt, nowClamped, repeat);

        // Generate renewal transactions for each interval (skip first one, as that's the initial grant)
        for (let i = 1; i <= elapsed; i++) {
          const windowStart = addInterval(new Date(subscription.createdAt), [repeat[0] * i, repeat[1]]);
          const windowEnd = addInterval(new Date(windowStart), repeat);

          // Skip if window starts after now
          if (windowStart > now) continue;

          const renewalId = `${subscription.id}:renewal:${itemId}:${i}`;
          const previousWindowId = i > 1 ? `${subscription.id}:renewal:${itemId}:${i - 1}` : subscription.id;

          renewals.push({
            id: renewalId,
            subscriptionId: subscription.id,
            customerId: options.filter.customerId, // customerId is required due to guard above
            customerType: typedToUppercase(options.filter.customerType ?? "user") as CustomerType,
            itemId,
            quantity: baseQty,
            windowStart,
            windowEnd,
            previousWindowTransactionId: previousWindowId,
          });
        }
      }
    }

    // Sort renewals by windowStart
    renewals.sort((a, b) => {
      const diff = a.windowStart.getTime() - b.windowStart.getTime();
      if (diff !== 0) return options.orderBy.direction === "desc" ? -diff : diff;
      return options.orderBy.direction === "desc"
        ? stringCompare(b.id, a.id)
        : stringCompare(a.id, b.id);
    });

    // Apply cursor filtering
    let filteredRenewals = renewals;
    const cursorData = decodeCursor(options.cursor);
    if (cursorData) {
      filteredRenewals = renewals.filter((r) => {
        const compare = r.windowStart.getTime() - cursorData.createdAt.getTime();
        if (options.orderBy.direction === "desc") {
          return compare < 0 || (compare === 0 && r.id < cursorData.id);
        } else {
          return compare > 0 || (compare === 0 && r.id > cursorData.id);
        }
      });
    }

    // Take limit items
    const pageRenewals = filteredRenewals.slice(0, options.limit);

    const items = pageRenewals.map((renewal) => {
      const transaction = buildItemQuantityRenewalTransaction(renewal);
      const itemCursor = encodeCursor(renewal.windowStart, renewal.id);
      return { item: transaction, itemCursor };
    });

    const isFirst = options.cursor === "first" || (type === "prev" && pageRenewals.length < options.limit);
    const isLast = options.cursor === "last" || (type === "next" && filteredRenewals.length <= options.limit);
    const lastItem = items[items.length - 1] as { item: NewTransaction, itemCursor: TransactionCursor } | undefined;
    const cursor = lastItem?.itemCursor ?? options.cursor;

    return { items, isFirst, isLast, cursor };
  }
}


// ============================================================================
// Main Export Function
// ============================================================================

export type ListTransactionsOptions = {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  filter?: {
    customerType?: CustomerTypeValue,
    customerId?: string,
    transactionType?: NewTransactionType,
  },
  orderBy?: TransactionOrderBy,
  cursor?: string,
  limit?: number,
};

export type ListTransactionsResult = {
  transactions: NewTransaction[],
  nextCursor: string | null,
  hasMore: boolean,
};

/**
 * Lists transactions using paginated lists merged together.
 *
 * This function creates individual paginated lists for each transaction source,
 * applies filters based on transaction type, and merges them together for
 * proper pagination.
 */
export async function listTransactions(options: ListTransactionsOptions): Promise<ListTransactionsResult> {
  const {
    prisma,
    tenancy,
    filter = {},
    orderBy = { field: "createdAt", direction: "desc" },
    cursor,
    limit = 50,
  } = options;

  const transactionFilter: TransactionFilter = {
    tenancyId: tenancy.id,
    customerType: filter.customerType,
    customerId: filter.customerId,
    transactionType: filter.transactionType,
  };

  // Create individual paginated lists for each transaction type
  const paginatedLists: PaginatedList<NewTransaction, TransactionCursor, TransactionFilter, TransactionOrderBy>[] = [];

  // Only add lists for requested transaction types (or all if not filtered)
  const shouldInclude = (type: NewTransactionType) => !filter.transactionType || filter.transactionType === type;

  if (shouldInclude("new-stripe-sub")) {
    paginatedLists.push(new NewStripeSubPaginatedList(prisma));
  }
  if (shouldInclude("stripe-resub")) {
    paginatedLists.push(new StripeResubPaginatedList(prisma));
  }
  if (shouldInclude("stripe-one-time")) {
    paginatedLists.push(new StripeOneTimePaginatedList(prisma));
  }
  if (shouldInclude("stripe-expire")) {
    paginatedLists.push(new StripeExpirePaginatedList(prisma));
  }
  if (shouldInclude("stripe-sub-cancel")) {
    paginatedLists.push(new StripeSubCancelPaginatedList(prisma));
  }
  if (shouldInclude("manual-item-quantity-change")) {
    paginatedLists.push(new ManualItemQuantityChangePaginatedList(prisma));
  }
  if (shouldInclude("stripe-refund")) {
    paginatedLists.push(new StripeRefundPaginatedList(prisma));
  }
  if (shouldInclude("product-change")) {
    paginatedLists.push(new ProductChangePaginatedList(prisma));
  }
  if (shouldInclude("sub-change")) {
    paginatedLists.push(new SubscriptionChangePaginatedList(prisma));
  }
  if (shouldInclude("item-quantity-renewal")) {
    paginatedLists.push(new ItemQuantityRenewalPaginatedList(prisma, tenancy));
  }

  if (paginatedLists.length === 0) {
    return {
      transactions: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  // Merge all paginated lists
  const mergedList = PaginatedList.merge(...paginatedLists);

  // Parse cursor or use first cursor
  const startCursor = cursor ?? mergedList.getFirstCursor();

  // Fetch transactions
  const result = await mergedList.next({
    after: startCursor,
    limit: limit + 1, // Fetch one extra to check if there are more
    limitPrecision: "exact",
    filter: transactionFilter,
    orderBy,
  });

  const hasMore = result.items.length > limit;
  const transactions = result.items.slice(0, limit).map((item) => item.item);
  const nextCursor = hasMore ? result.items[limit - 1]?.itemCursor ?? null : null;

  return {
    transactions,
    nextCursor,
    hasMore,
  };
}

/**
 * Creates a paginated list for a specific transaction type.
 * This is useful when you want to work with a single transaction source.
 */
export function createTransactionPaginatedList(
  prisma: PrismaClientTransaction,
  transactionType: NewTransactionType,
  tenancy?: Tenancy
): PaginatedList<NewTransaction, TransactionCursor, TransactionFilter, TransactionOrderBy> | null {
  switch (transactionType) {
    case "new-stripe-sub": {
      return new NewStripeSubPaginatedList(prisma);
    }
    case "stripe-resub": {
      return new StripeResubPaginatedList(prisma);
    }
    case "stripe-one-time": {
      return new StripeOneTimePaginatedList(prisma);
    }
    case "stripe-expire": {
      return new StripeExpirePaginatedList(prisma);
    }
    case "stripe-sub-cancel": {
      return new StripeSubCancelPaginatedList(prisma);
    }
    case "manual-item-quantity-change": {
      return new ManualItemQuantityChangePaginatedList(prisma);
    }
    case "stripe-refund": {
      return new StripeRefundPaginatedList(prisma);
    }
    case "product-change": {
      return new ProductChangePaginatedList(prisma);
    }
    case "sub-change": {
      return new SubscriptionChangePaginatedList(prisma);
    }
    case "item-quantity-renewal": {
      // Requires tenancy for computing renewals
      if (!tenancy) return null;
      return new ItemQuantityRenewalPaginatedList(prisma, tenancy);
    }
    default: {
      return null;
    }
  }
}

