import { productToInlineProduct } from "@/lib/payments/index";
import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
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
function normalizeDefaultSnapshotProduct(product: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...product };
  if (typeof normalized.product_line_id !== "string" && typeof normalized.productLineId === "string") {
    normalized.product_line_id = normalized.productLineId;
  }
  if (!normalized.included_items && normalized.includedItems) {
    normalized.included_items = normalized.includedItems;
  }
  return normalized;
}

function normalizeDefaultSnapshot(snapshot: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [productId, product] of Object.entries(snapshot)) {
    normalized[productId] = normalizeDefaultSnapshotProduct(product as Record<string, unknown>);
  }
  return normalized;
}

function getCurrentDefaultProducts(transactions: Transaction[]): { snapshot: Record<string, any>, createdAtMillis: number } {
  for (const tx of transactions) {
    if ((tx.type as string) !== "default-products-change") continue;
    for (const entry of tx.entries) {
      if ((entry.type as string) === "default-products-change") {
        return {
          snapshot: normalizeDefaultSnapshot((entry as any).snapshot as Record<string, any>),
          createdAtMillis: tx.created_at_millis,
        };
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
      const typedEntry = entry as any;
      if (typedEntry.type === "product-revocation") {
        const key = typedEntry.adjusted_transaction_id;
        revokedQuantities.set(key, (revokedQuantities.get(key) ?? 0) + typedEntry.quantity);
      }
    }
  }

  const ownedProducts: OwnedProduct[] = [];

  for (const tx of transactions) {
    for (let i = 0; i < tx.entries.length; i++) {
      const entry = tx.entries[i];
      const typedEntry = entry as any;
      if (typedEntry.type !== "product-grant") continue;

      const revoked = revokedQuantities.get(tx.id) ?? 0;
      const effectiveQuantity = Math.max(0, typedEntry.quantity - revoked);
      if (effectiveQuantity <= 0) continue;

      const isSubscription = typedEntry.subscription_id != null;
      const isOneTime = typedEntry.one_time_purchase_id != null;

      ownedProducts.push({
        id: typedEntry.product_id,
        type: isSubscription ? "subscription" : isOneTime ? "one_time" : "include-by-default",
        quantity: effectiveQuantity,
        product: typedEntry.product,
        createdAt: new Date(tx.created_at_millis),
        sourceId: typedEntry.subscription_id ?? typedEntry.one_time_purchase_id ?? tx.id,
        subscription: isSubscription ? {
          stripeSubscriptionId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          isCancelable: typedEntry.product_id !== null,
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


  const paidGrantsByTx = new Map<string, { product: any, quantity: number }>();
  const activePaidQuantityByProductId = new Map<string, number>();
  const activePaidQuantityByProductLine = new Map<string, number>();
  const activeDefaultLedgerGrantsByProductId = new Map<string, LedgerTransaction[]>();
  let defaultSnapshot: Record<string, any> = {};

  const getProductLineId = (product: Record<string, unknown> | undefined): string | null => {
    if (!product) return null;
    if (typeof product.product_line_id === "string") return product.product_line_id;
    if (typeof product.productLineId === "string") return product.productLineId;
    return null;
  };

  const isDefaultProductOwnedAtThisPoint = (productId: string) => {
    const product = defaultSnapshot[productId];
    if (!product) return false;
    const productLineId = getProductLineId(product);
    if (typeof productLineId === "string") {
      return (activePaidQuantityByProductLine.get(productLineId) ?? 0) <= 0;
    }
    return (activePaidQuantityByProductId.get(productId) ?? 0) <= 0;
  };

  const suppressDefaultGrantsForLine = (productLineId: string, atMillis: number) => {
    for (const [productId, product] of Object.entries(defaultSnapshot)) {
      if (getProductLineId(product as Record<string, unknown>) !== productLineId) continue;
      const grants = activeDefaultLedgerGrantsByProductId.get(productId);
      if (!grants) continue;
      for (const grant of grants) {
        if (grant.amount <= 0) continue;
        const amount = grant.amount;
        grant.amount = 0;
        ledgerTransactions.push({
          amount,
          grantTime: grant.grantTime,
          expirationTime: new Date(atMillis),
        });
      }
      activeDefaultLedgerGrantsByProductId.set(productId, []);
    }
  };

  const restoreDefaultGrantsForLine = (productLineId: string, atMillis: number) => {
    for (const [productId, product] of Object.entries(defaultSnapshot)) {
      if (getProductLineId(product as Record<string, unknown>) !== productLineId) continue;
      if (!isDefaultProductOwnedAtThisPoint(productId)) continue;
      const includedItem = (product as any)?.included_items?.[options.itemId];
      const quantity = Number(includedItem?.quantity ?? 0);
      if (quantity <= 0) continue;
      const ledgerTransaction = {
        amount: quantity,
        grantTime: new Date(atMillis),
        expirationTime: new Date(8640000000000000),
      };
      ledgerTransactions.push(ledgerTransaction);
      const grants = activeDefaultLedgerGrantsByProductId.get(productId) ?? [];
      grants.push(ledgerTransaction);
      activeDefaultLedgerGrantsByProductId.set(productId, grants);
    }
  };

  // Process item-level entries chronologically.
  for (let ti = 0; ti < transactions.length; ti++) {
    const tx = transactions[ti];
    for (let ei = 0; ei < tx.entries.length; ei++) {
      const entry = tx.entries[ei];
      const typedEntry = entry as any;
      if (typedEntry.type === "product-grant") {
        paidGrantsByTx.set(tx.id, { product: typedEntry.product, quantity: typedEntry.quantity });
        if (typedEntry.product_id) {
          activePaidQuantityByProductId.set(typedEntry.product_id, (activePaidQuantityByProductId.get(typedEntry.product_id) ?? 0) + typedEntry.quantity);
        }
        const productLineId = getProductLineId(typedEntry.product);
        if (typeof productLineId === "string") {
          const previous = activePaidQuantityByProductLine.get(productLineId) ?? 0;
          const next = previous + typedEntry.quantity;
          activePaidQuantityByProductLine.set(productLineId, next);
          if (previous <= 0 && next > 0) {
            suppressDefaultGrantsForLine(productLineId, tx.effective_at_millis);
          }
        }
      } else if (typedEntry.type === "product-revocation") {
        const adjusted = paidGrantsByTx.get(typedEntry.adjusted_transaction_id);
        if (!adjusted) continue;
        const productId = adjusted.product?.id;
        if (typeof productId === "string") {
          activePaidQuantityByProductId.set(productId, (activePaidQuantityByProductId.get(productId) ?? 0) - typedEntry.quantity);
        }
        const productLineId = getProductLineId(adjusted.product);
        if (typeof productLineId === "string") {
          const previous = activePaidQuantityByProductLine.get(productLineId) ?? 0;
          const next = previous - typedEntry.quantity;
          activePaidQuantityByProductLine.set(productLineId, next);
          if (previous > 0 && next <= 0) {
            restoreDefaultGrantsForLine(productLineId, tx.effective_at_millis);
          }
        }
      } else if (typedEntry.type === "default-products-change") {
        defaultSnapshot = normalizeDefaultSnapshot(typedEntry.snapshot as Record<string, any>);
      } else if (typedEntry.type === "item-quantity-change") {
        if (typedEntry.item_id !== options.itemId) continue;
        const expiresAtMillis: number | null | undefined = typedEntry.expires_at_millis;
        const ledgerTransaction = {
          amount: typedEntry.quantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: expiresAtMillis ? new Date(expiresAtMillis) : new Date(8640000000000000),
        };
        ledgerTransactions.push(ledgerTransaction);
        const ledgerTransactionMap = ledgerItemGrantMapByTxIdAndEntryIndex.get(tx.id) ?? new Map<number, LedgerTransaction>();
        ledgerTransactionMap.set(ei, ledgerTransaction);
        ledgerItemGrantMapByTxIdAndEntryIndex.set(tx.id, ledgerTransactionMap);
      } else if (typedEntry.type === "default-product-item-grant" || typedEntry.type === "default-product-item-change") {
        if (typedEntry.item_id !== options.itemId) continue;
        if (!isDefaultProductOwnedAtThisPoint(typedEntry.product_id)) continue;
        const ledgerTransaction = {
          amount: typedEntry.quantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: new Date(8640000000000000),
        };
        ledgerTransactions.push(ledgerTransaction);
        const grants = activeDefaultLedgerGrantsByProductId.get(typedEntry.product_id) ?? [];
        grants.push(ledgerTransaction);
        activeDefaultLedgerGrantsByProductId.set(typedEntry.product_id, grants);
        const ledgerTransactionMap = ledgerItemGrantMapByTxIdAndEntryIndex.get(tx.id) ?? new Map<number, LedgerTransaction>();
        ledgerTransactionMap.set(ei, ledgerTransaction);
        ledgerItemGrantMapByTxIdAndEntryIndex.set(tx.id, ledgerTransactionMap);
      } else if (typedEntry.type === "item-quantity-expire" || typedEntry.type === "default-product-item-expire") {
        if (typedEntry.item_id !== options.itemId) continue;
        const adjustedLedgerTransaction = typedEntry.adjusted_transaction_id && typedEntry.adjusted_entry_index != null ? ledgerItemGrantMapByTxIdAndEntryIndex.get(typedEntry.adjusted_transaction_id)?.get(typedEntry.adjusted_entry_index) : null;
        if (!adjustedLedgerTransaction) {
          // Default-product grants can be filtered out while a paid product in the same
          // line is active. Their matching expiry should then be ignored too.
          if (typedEntry.type === "default-product-item-expire") continue;
          throw new StackAssertionError("Ledger item grant not found for item-quantity-expire", { tx, entry, ledgerChangeTransactionMapByTxIdAndEntryIndex: ledgerItemGrantMapByTxIdAndEntryIndex, options });
        }
        if (typedEntry.type === "default-product-item-expire" && adjustedLedgerTransaction.amount < typedEntry.quantity) {
          // A conflicting paid product may have already suppressed this default grant.
          continue;
        }
        adjustedLedgerTransaction.amount -= typedEntry.quantity;
        if (adjustedLedgerTransaction.amount < 0) throw new StackAssertionError("item-quantity-expire amount is higher than the ledger item grant amount", { entry, options });
        ledgerTransactions.push({
          amount: typedEntry.quantity,
          grantTime: adjustedLedgerTransaction.grantTime,
          expirationTime: new Date(Math.min(tx.effective_at_millis, adjustedLedgerTransaction.expirationTime.getTime())),
        });
      }
    }
  }

  return computeLedgerBalanceAtNow(ledgerTransactions, now);
}
