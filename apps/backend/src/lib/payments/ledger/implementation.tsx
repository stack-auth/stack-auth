import { productToInlineProduct } from "@/lib/payments/index";
import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { ensureCustomerExists, OwnedProduct } from "../implementation";
import { computeLedgerBalanceAtNow, type LedgerTransaction } from "./algo";
import { getTransactionsPaginatedList } from "./transactions";

/**
 * Lazily ensures the DefaultProductsSnapshot table is up-to-date with the
 * current tenancy config. If the current include-by-default products differ
 * from the most recent snapshot, inserts a new row.
 */
async function ensureDefaultProductsSnapshotUpToDate(prisma: PrismaClientTransaction, tenancy: Tenancy): Promise<void> {
  const configProducts = tenancy.config.payments.products;

  const currentDefaults: Record<string, unknown> = {};
  for (const [productId, product] of typedEntries(configProducts)) {
    if (product.prices !== "include-by-default") continue;
    currentDefaults[productId] = productToInlineProduct(product);
  }

  const latestSnapshot = await prisma.defaultProductsSnapshot.findFirst({
    where: { tenancyId: tenancy.id },
    orderBy: { createdAt: "desc" },
  });

  const latestSnapshotData = latestSnapshot?.snapshot as Record<string, unknown> | null;
  const currentJson = JSON.stringify(currentDefaults);
  const latestJson = latestSnapshotData ? JSON.stringify(latestSnapshotData) : null;

  if (currentJson !== latestJson) {
    await prisma.defaultProductsSnapshot.create({
      data: {
        tenancyId: tenancy.id,
        snapshot: currentDefaults as any,
      },
    });
  }
}

export async function getAllTransactionsForCustomer(prisma: PrismaClientTransaction, tenancy: Tenancy, customerType: "user" | "team" | "custom", customerId: string): Promise<Transaction[]> {
  const list = getTransactionsPaginatedList(prisma, tenancy.id);
  const allTransactions: Transaction[] = [];
  let cursor = list.getFirstCursor();
  let done = false;
  while (!done) {
    const page = await list.next({
      after: cursor,
      limit: 200,
      filter: { customerType, customerId },
      orderBy: "createdAt-desc",
      limitPrecision: "exact",
    });
    for (const entry of page.items) {
      allTransactions.push(entry.item);
    }
    cursor = page.cursor;
    done = page.isLast;
  }
  return allTransactions;
}

/**
 * Gets the current default products snapshot from the transactions.
 * Returns the snapshot and the timestamp of the most recent default-products-change transaction.
 */
function getCurrentDefaultProducts(transactions: Transaction[]): { snapshot: Record<string, any>, createdAtMillis: number } {
  for (const tx of transactions) {
    if ((tx.type as string) !== "default-products-change") continue;
    for (const entry of tx.entries) {
      if ((entry.type as string) === "default_products_change") {
        return { snapshot: (entry as any).snapshot as Record<string, any>, createdAtMillis: tx.created_at_millis };
      }
    }
  }
  return { snapshot: {}, createdAtMillis: 0 };
}

export async function getOwnedProductsForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  customerType: "user" | "team" | "custom",
  customerId: string,
  now?: Date,
}): Promise<OwnedProduct[]> {
  await ensureCustomerExists({
    prisma: options.prisma,
    tenancyId: options.tenancy.id,
    customerType: options.customerType,
    customerId: options.customerId,
  });

  await ensureDefaultProductsSnapshotUpToDate(options.prisma, options.tenancy);
  const allTransactions = await getAllTransactionsForCustomer(options.prisma, options.tenancy, options.customerType, options.customerId);

  const now = options.now ?? new Date();
  const transactions = allTransactions.filter((tx) => tx.effective_at_millis <= now.getTime());

  // Build revocation map — keyed by transaction ID only, since entry index
  // is unreliable (subscription-start entry order varies depending on whether
  // money_transfer is present)
  const revokedQuantities = new Map<string, number>();
  for (const tx of transactions) {
    for (const entry of tx.entries) {
      if (entry.type === "product_revocation") {
        const key = entry.adjusted_transaction_id;
        revokedQuantities.set(key, (revokedQuantities.get(key) ?? 0) + entry.quantity);
      }
    }
  }

  const ownedProducts: OwnedProduct[] = [];

  for (const tx of transactions) {
    for (let i = 0; i < tx.entries.length; i++) {
      const entry = tx.entries[i];
      if (entry.type !== "product_grant") continue;

      const revoked = revokedQuantities.get(tx.id) ?? 0;
      const effectiveQuantity = Math.max(0, entry.quantity - revoked);
      if (effectiveQuantity <= 0) continue;

      const isSubscription = entry.subscription_id != null;
      const isOneTime = entry.one_time_purchase_id != null;

      ownedProducts.push({
        id: entry.product_id,
        type: isSubscription ? "subscription" : isOneTime ? "one_time" : "include-by-default",
        quantity: effectiveQuantity,
        product: entry.product,
        createdAt: new Date(tx.created_at_millis),
        sourceId: entry.subscription_id ?? entry.one_time_purchase_id ?? tx.id,
        subscription: isSubscription ? {
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          isCancelable: entry.product_id !== null,
        } : null,
      });
    }
  }

  // Add include-by-default products for uncovered product lines
  const { snapshot: defaultProducts, createdAtMillis: defaultsCreatedAtMillis } = getCurrentDefaultProducts(transactions);
  const productLines = options.tenancy.config.payments.productLines;

  for (const [productId, product] of Object.entries(defaultProducts)) {
    const productLineId = (product as any).product_line_id;

    if (productLineId && productLineId in productLines) {
      const hasConflict = ownedProducts.some((owned) =>
        owned.product.product_line_id === productLineId &&
        owned.type !== "include-by-default"
      );
      if (hasConflict) continue;
    } else {
      if (ownedProducts.some((owned) => owned.id === productId)) continue;
    }

    ownedProducts.push({
      id: productId,
      type: "include-by-default",
      quantity: 1,
      product: product as any,
      createdAt: new Date(defaultsCreatedAtMillis),
      sourceId: productId,
      subscription: null,
    });
  }

  return ownedProducts;
}


export async function getItemQuantityForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  itemId: string,
  customerId: string,
  customerType: "user" | "team" | "custom",
  now?: Date,
}) {
  await ensureDefaultProductsSnapshotUpToDate(options.prisma, options.tenancy);
  const allTransactions = await getAllTransactionsForCustomer(options.prisma, options.tenancy, options.customerType, options.customerId);

  const now = options.now ?? new Date();
  const transactions = allTransactions.filter((tx) => tx.effective_at_millis <= now.getTime()).sort((a, b) => a.effective_at_millis - b.effective_at_millis);
  const ledgerTransactions: LedgerTransaction[] = [];
  const ledgerItemGrantMapByTxIdAndEntryIndex = new Map<string, Map<number, LedgerTransaction>>();


  // Process item_quantity_change, item_quantity_expire, and default_products_change entries
  for (let ti = 0; ti < transactions.length; ti++) {
    const tx = transactions[ti];
    for (let ei = 0; ei < tx.entries.length; ei++) {
      const entry = tx.entries[ei];
      if (entry.type === "item_quantity_change") {
        if (entry.item_id !== options.itemId) continue;
        const ledgerTransaction = {
          amount: entry.quantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: new Date(8640000000000000),
        };
        ledgerTransactions.push(ledgerTransaction);
        const ledgerTransactionMap = ledgerItemGrantMapByTxIdAndEntryIndex.get(tx.id) ?? new Map<number, LedgerTransaction>();
        ledgerTransactionMap.set(ei, ledgerTransaction);
        ledgerItemGrantMapByTxIdAndEntryIndex.set(tx.id, ledgerTransactionMap);
      } else if (entry.type === "item_quantity_expire") {
        if (entry.item_id !== options.itemId) continue;
        const adjustedLedgerTransaction = entry.adjusted_transaction_id && entry.adjusted_entry_index != null ? ledgerItemGrantMapByTxIdAndEntryIndex.get(entry.adjusted_transaction_id)?.get(entry.adjusted_entry_index) : null;
        if (!adjustedLedgerTransaction) throw new StackAssertionError("Ledger item grant not found for item_quantity_expire", { tx, entry, ledgerChangeTransactionMapByTxIdAndEntryIndex: ledgerItemGrantMapByTxIdAndEntryIndex, options });
        adjustedLedgerTransaction.amount -= entry.quantity;
        if (adjustedLedgerTransaction.amount < 0) throw new StackAssertionError("item_quantity_expire amount is higher than the ledger item grant amount", { entry, options });
        ledgerTransactions.push({
          amount: entry.quantity,
          grantTime: adjustedLedgerTransaction.grantTime,
          expirationTime: new Date(Math.min(tx.effective_at_millis, adjustedLedgerTransaction.expirationTime.getTime())),
        });
      } else if (entry.type === "default_products_change") {
        const nextDefaultProductsChangeAt = transactions.slice(ti + 1).find((tx) => tx.entries.some((entry) => entry.type === "default_products_change"))?.effective_at_millis;
        let neverExpiringItemQuantity = 0;
        let maybeExpiringItemQuantity = 0;
        for (const product of Object.values(entry.snapshot)) {
          const item = getOrUndefined(product.included_items, options.itemId);
          if (!item) {
            continue;
          } else if (item.expires === "never") {
            neverExpiringItemQuantity += item.quantity ?? 0;
          } else {
            maybeExpiringItemQuantity += item.quantity ?? 0;
          }
        }
        const neverLedgerTransaction = {
          amount: neverExpiringItemQuantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: new Date(8640000000000000),
        };
        ledgerTransactions.push(neverLedgerTransaction);
        const ledgerTransaction = {
          amount: maybeExpiringItemQuantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: new Date(nextDefaultProductsChangeAt ?? 8640000000000000),
        };
        ledgerTransactions.push(ledgerTransaction);
        const ledgerTransactionMap = ledgerItemGrantMapByTxIdAndEntryIndex.get(tx.id) ?? new Map<number, LedgerTransaction>();
        ledgerTransactionMap.set(ei, ledgerTransaction);
        ledgerItemGrantMapByTxIdAndEntryIndex.set(tx.id, ledgerTransactionMap);
      }
    }
  }

  return computeLedgerBalanceAtNow(ledgerTransactions, now);
}
