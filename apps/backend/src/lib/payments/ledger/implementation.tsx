import { productToInlineProduct } from "@/lib/payments/index";
import { Tenancy } from "@/lib/tenancies";
import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { ensureCustomerExists, OwnedProduct } from "../implementation";
import { computeLedgerBalanceAtNow, type LedgerTransaction } from "./algo";
import { getTransactions } from "./transactions";

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

  if (!deepPlainEquals(currentDefaults, latestSnapshotData)) {
    await prisma.defaultProductsSnapshot.create({
      data: {
        tenancyId: tenancy.id,
        snapshot: currentDefaults as any,
      },
    });
  }
}

export async function getAllTransactionsForCustomer(prisma: PrismaClientTransaction, tenancy: Tenancy, customerType: "user" | "team" | "custom", customerId: string): Promise<Transaction[]> {
  return await getTransactions(prisma, tenancy.id, { customerType, customerId });
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

function compareTransactionsByEffectiveAtAsc(left: Transaction, right: Transaction): number {
  const effectiveAtDiff = left.effective_at_millis - right.effective_at_millis;
  if (effectiveAtDiff !== 0) return effectiveAtDiff;
  return stringCompare(left.id, right.id);
}

function compareTransactionsByEffectiveAtDesc(left: Transaction, right: Transaction): number {
  const effectiveAtDiff = right.effective_at_millis - left.effective_at_millis;
  if (effectiveAtDiff !== 0) return effectiveAtDiff;
  return stringCompare(right.id, left.id);
}

function getCurrentDefaultProducts(transactions: Transaction[]): { snapshot: Record<string, any>, effectiveAtMillis: number } {
  const sortedTransactions = [...transactions].sort(compareTransactionsByEffectiveAtDesc);

  for (const tx of sortedTransactions) {
    if ((tx.type as string) !== "default-products-change") continue;
    for (const entry of tx.entries) {
      if (entry.type === "default-products-change") {
        return {
          snapshot: normalizeDefaultSnapshot(entry.snapshot),
          effectiveAtMillis: tx.effective_at_millis,
        };
      }
    }
  }
  return { snapshot: {}, effectiveAtMillis: 0 };
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
  const transactions = allTransactions
    .filter((tx) => tx.effective_at_millis <= now.getTime())
    .sort(compareTransactionsByEffectiveAtAsc);

  const revokedQuantities = new Map<string, number>();
  const subscriptionIds = new Set<string>();
  for (const tx of transactions) {
    for (const entry of tx.entries) {
      if (entry.type === "product-revocation") {
        const key = `${entry.adjusted_transaction_id}:${entry.adjusted_entry_index}`;
        revokedQuantities.set(key, (revokedQuantities.get(key) ?? 0) + entry.quantity);
      }
      if (entry.type === "product-grant" && entry.subscription_id) {
        subscriptionIds.add(entry.subscription_id);
      }
    }
  }

  const subscriptionMetadata = new Map<string, {
    stripeSubscriptionId: string | null,
    currentPeriodEnd: Date | null,
    cancelAtPeriodEnd: boolean,
  }>();
  if (subscriptionIds.size > 0) {
    const subs = await options.prisma.subscription.findMany({
      where: { tenancyId: options.tenancy.id, id: { in: [...subscriptionIds] } },
      select: { id: true, stripeSubscriptionId: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
    });
    for (const sub of subs) {
      subscriptionMetadata.set(sub.id, {
        stripeSubscriptionId: sub.stripeSubscriptionId,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      });
    }
  }

  const ownedProducts: OwnedProduct[] = [];
  for (const tx of transactions) {
    for (let i = 0; i < tx.entries.length; i++) {
      const entry = tx.entries[i];
      if (entry.type !== "product-grant") continue;

      const revoked = revokedQuantities.get(`${tx.id}:${i}`) ?? 0;
      const effectiveQuantity = Math.max(0, entry.quantity - revoked);
      if (effectiveQuantity <= 0) continue;

      const isSubscription = entry.subscription_id !== undefined;
      const isOneTime = entry.one_time_purchase_id !== undefined;
      if (!isSubscription && !isOneTime) {
        throw new StackAssertionError("product-grant entry is missing both subscription_id and one_time_purchase_id", {
          transactionId: tx.id,
          customerId: entry.customer_id,
          customerType: entry.customer_type,
          entryIndex: i,
          entry,
        });
      }
      const subMeta = isSubscription ? subscriptionMetadata.get(entry.subscription_id!) : null;

      ownedProducts.push({
        id: entry.product_id,
        type: isSubscription ? "subscription" : "one_time",
        quantity: effectiveQuantity,
        product: entry.product,
        createdAt: new Date(tx.effective_at_millis),
        sourceId: entry.subscription_id ?? entry.one_time_purchase_id ?? tx.id,
        subscription: isSubscription ? {
          subscriptionId: entry.subscription_id ?? null,
          stripeSubscriptionId: subMeta?.stripeSubscriptionId ?? null,
          currentPeriodEnd: subMeta?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: subMeta?.cancelAtPeriodEnd ?? false,
          isCancelable: entry.subscription_id !== undefined,
        } : null,
      });
    }
  }

  // Add include-by-default products for uncovered product lines
  const { snapshot: defaultProducts, effectiveAtMillis: defaultsEffectiveAtMillis } = getCurrentDefaultProducts(transactions);
  const productLines = options.tenancy.config.payments.productLines;
  const seenDefaultProductLineIds = new Set<string>();
  // Deterministic tie-breaker for misconfigured snapshots with multiple defaults in one line.
  // We keep the lexicographically smallest product ID for that line.
  const sortedDefaultProducts = Object.entries(defaultProducts).sort(([leftProductId], [rightProductId]) =>
    stringCompare(leftProductId, rightProductId),
  );

  for (const [productId, product] of sortedDefaultProducts) {
    const productLineId = (product as any).product_line_id;

    if (productLineId && productLineId in productLines) {
      const hasConflict = ownedProducts.some((owned) =>
        owned.product.product_line_id === productLineId &&
        owned.type !== "include-by-default"
      );
      if (hasConflict) continue;
      //If we've seen this product line ID before, and there isn't an owned paid product in this line, then we've already added a default product from this line
      if (seenDefaultProductLineIds.has(productLineId)) continue;
      seenDefaultProductLineIds.add(productLineId);
    } else {
      if (ownedProducts.some((owned) => owned.id === productId)) continue;
    }

    ownedProducts.push({
      id: productId,
      type: "include-by-default",
      quantity: 1,
      product: product,
      createdAt: new Date(defaultsEffectiveAtMillis),
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
  const transactions = allTransactions
    .filter((tx) => tx.effective_at_millis <= now.getTime())
    .sort(compareTransactionsByEffectiveAtAsc);
  const ledgerTransactions: LedgerTransaction[] = [];
  const ledgerItemGrantMapByTxIdAndEntryIndex = new Map<string, Map<number, LedgerTransaction>>();


  const paidGrantsByTxAndEntry = new Map<string, { productId: string | null, product: any, quantity: number }>();
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
      if (entry.type === "product-grant") {
        paidGrantsByTxAndEntry.set(`${tx.id}:${ei}`, {
          productId: entry.product_id ?? null,
          product: entry.product,
          quantity: entry.quantity,
        });
        if (entry.product_id) {
          activePaidQuantityByProductId.set(entry.product_id, (activePaidQuantityByProductId.get(entry.product_id) ?? 0) + entry.quantity);
        }
        const productLineId = getProductLineId(entry.product);
        if (typeof productLineId === "string") {
          const previous = activePaidQuantityByProductLine.get(productLineId) ?? 0;
          const next = previous + entry.quantity;
          activePaidQuantityByProductLine.set(productLineId, next);
          if (previous <= 0 && next > 0) {
            suppressDefaultGrantsForLine(productLineId, tx.effective_at_millis);
          }
        }
      } else if (entry.type === "product-revocation") {
        const adjusted = paidGrantsByTxAndEntry.get(`${entry.adjusted_transaction_id}:${entry.adjusted_entry_index}`);
        if (!adjusted) continue;
        const productId = adjusted.productId;
        if (typeof productId === "string") {
          activePaidQuantityByProductId.set(productId, (activePaidQuantityByProductId.get(productId) ?? 0) - entry.quantity);
        }
        const productLineId = getProductLineId(adjusted.product);
        if (typeof productLineId === "string") {
          const previous = activePaidQuantityByProductLine.get(productLineId) ?? 0;
          const next = previous - entry.quantity;
          activePaidQuantityByProductLine.set(productLineId, next);
          if (previous > 0 && next <= 0) {
            restoreDefaultGrantsForLine(productLineId, tx.effective_at_millis);
          }
        }
      } else if (entry.type === "default-products-change") {
        defaultSnapshot = normalizeDefaultSnapshot(entry.snapshot);
      } else if (entry.type === "item-quantity-change") {
        if (entry.item_id !== options.itemId) continue;
        const expiresAtMillis: number | null | undefined = entry.expires_at_millis;
        const ledgerTransaction = {
          amount: entry.quantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: expiresAtMillis !== null && expiresAtMillis !== undefined ? new Date(expiresAtMillis) : new Date(8640000000000000),
        };
        ledgerTransactions.push(ledgerTransaction);
        const ledgerTransactionMap = ledgerItemGrantMapByTxIdAndEntryIndex.get(tx.id) ?? new Map<number, LedgerTransaction>();
        ledgerTransactionMap.set(ei, ledgerTransaction);
        ledgerItemGrantMapByTxIdAndEntryIndex.set(tx.id, ledgerTransactionMap);
      } else if (entry.type === "default-product-item-grant" || entry.type === "default-product-item-change") {
        if (entry.item_id !== options.itemId) continue;
        if (!isDefaultProductOwnedAtThisPoint(entry.product_id)) continue;
        const ledgerTransaction = {
          amount: entry.quantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: new Date(8640000000000000),
        };
        ledgerTransactions.push(ledgerTransaction);
        const grants = activeDefaultLedgerGrantsByProductId.get(entry.product_id) ?? [];
        grants.push(ledgerTransaction);
        activeDefaultLedgerGrantsByProductId.set(entry.product_id, grants);
        const ledgerTransactionMap = ledgerItemGrantMapByTxIdAndEntryIndex.get(tx.id) ?? new Map<number, LedgerTransaction>();
        ledgerTransactionMap.set(ei, ledgerTransaction);
        ledgerItemGrantMapByTxIdAndEntryIndex.set(tx.id, ledgerTransactionMap);
      } else if (entry.type === "item-quantity-expire" || entry.type === "default-product-item-expire") {
        if (entry.item_id !== options.itemId) continue;
        const adjustedLedgerTransaction = entry.adjusted_transaction_id && entry.adjusted_entry_index != null ? ledgerItemGrantMapByTxIdAndEntryIndex.get(entry.adjusted_transaction_id)?.get(entry.adjusted_entry_index) : null;
        if (!adjustedLedgerTransaction) {
          // Default-product grants can be filtered out while a paid product in the same
          // line is active. Their matching expiry should then be ignored too.
          if (entry.type === "default-product-item-expire") continue;
          throw new StackAssertionError("Ledger item grant not found for item-quantity-expire", { tx, entry, ledgerChangeTransactionMapByTxIdAndEntryIndex: ledgerItemGrantMapByTxIdAndEntryIndex, options });
        }
        if (entry.type === "default-product-item-expire" && adjustedLedgerTransaction.amount < entry.quantity) {
          // A conflicting paid product may have already suppressed this default grant.
          continue;
        }
        adjustedLedgerTransaction.amount -= entry.quantity;
        if (adjustedLedgerTransaction.amount < 0) throw new StackAssertionError("item-quantity-expire amount is higher than the ledger item grant amount", { entry, options });
        ledgerTransactions.push({
          amount: entry.quantity,
          grantTime: adjustedLedgerTransaction.grantTime,
          expirationTime: new Date(Math.min(tx.effective_at_millis, adjustedLedgerTransaction.expirationTime.getTime())),
        });
      }
    }
  }

  return computeLedgerBalanceAtNow(ledgerTransactions, now);
}
