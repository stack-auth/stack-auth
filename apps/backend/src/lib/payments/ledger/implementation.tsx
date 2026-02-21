import { productToInlineProduct } from "@/lib/payments/index";
import { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, PrismaClientTransaction } from "@/prisma-client";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { ensureCustomerExists, OwnedProduct } from "../implementation";
import { computeLedgerBalanceAtNow, type LedgerTransaction } from "./algo";
import { getTransactionsPaginatedList } from "./transactions";

/**
 * Lazily ensures the DefaultProductsSnapshot table is up-to-date with the
 * current tenancy config. If the current include-by-default products differ
 * from the most recent snapshot, inserts a new row.
 */
async function ensureDefaultProductsSnapshotUpToDate(tenancy: Tenancy): Promise<void> {
  const prisma = await getPrismaClientForTenancy(tenancy);
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

async function getAllTransactionsForCustomer(tenancy: Tenancy, customerType: "user" | "team" | "custom", customerId: string): Promise<Transaction[]> {
  const list = getTransactionsPaginatedList(tenancy);
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
 * Returns the snapshot from the most recent default-products-change transaction.
 */
function getCurrentDefaultProducts(transactions: Transaction[]): Record<string, any> {
  for (const tx of transactions) {
    if ((tx.type as string) !== "default-products-change") continue;
    for (const entry of tx.entries) {
      if ((entry.type as string) === "default_products_change") {
        return (entry as any).snapshot as Record<string, any>;
      }
    }
  }
  return {};
}

export async function getOwnedProductsForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  customerType: "user" | "team" | "custom",
  customerId: string,
}): Promise<OwnedProduct[]> {
  await ensureCustomerExists({
    prisma: options.prisma,
    tenancyId: options.tenancy.id,
    customerType: options.customerType,
    customerId: options.customerId,
  });

  await ensureDefaultProductsSnapshotUpToDate(options.tenancy);
  const transactions = await getAllTransactionsForCustomer(options.tenancy, options.customerType, options.customerId);

  // Build revocation map
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
        product: entry.product as any,
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
  const defaultProducts = getCurrentDefaultProducts(transactions);
  const productLines = options.tenancy.config.payments.productLines;

  for (const [productId, product] of Object.entries(defaultProducts)) {
    const productLineId = (product as any).productLineId;

    if (productLineId && productLineId in productLines) {
      const hasConflict = ownedProducts.some((owned) =>
        owned.product.productLineId === productLineId &&
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
      createdAt: new Date(),
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
}) {
  await ensureDefaultProductsSnapshotUpToDate(options.tenancy);
  const allTransactions = await getAllTransactionsForCustomer(options.tenancy, options.customerType, options.customerId);

  const now = new Date();
  const ledgerTransactions: LedgerTransaction[] = [];

  for (const tx of allTransactions) {
    for (const entry of tx.entries) {
      if (entry.type === "item_quantity_change") {
        if (entry.item_id !== options.itemId) continue;
        ledgerTransactions.push({
          amount: entry.quantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: new Date(8640000000000000),
        });
      } else if (entry.type === "item_quantity_expire") {
        if (entry.item_id !== options.itemId) continue;
        ledgerTransactions.push({
          amount: -entry.quantity,
          grantTime: new Date(tx.effective_at_millis),
          expirationTime: new Date(8640000000000000),
        });
      }
    }
  }

  return computeLedgerBalanceAtNow(ledgerTransactions, now);
}
