import type { OneTimePurchase, Subscription } from "@/generated/prisma/client";
import { productToInlineProduct } from "@/lib/payments/index";
import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { InferType } from "yup";
import {
  buildChargedAmount,
  createActiveSubscriptionStopEntry,
  createItemQuantityChangeEntriesForProduct,
  createItemQuantityExpireEntriesForProduct,
  createMoneyTransferEntry,
  createProductRevocationEntry,
  createSingleTableTransactionList,
  resolveSelectedPriceFromProduct,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function computeOriginalSubscriptionStartIndices(subscription: Subscription, inlineProduct: any, testMode: boolean, chargedAmount: Record<string, string>) {
  // Replicate subscription-start entry ordering to find the correct indices:
  // [0] active_subscription_start, [1?] money_transfer, [N] product_grant, [N+1...] item_quantity_change
  let idx = 1; // active_subscription_start is always at 0
  const originalMoneyTransfer = createMoneyTransferEntry({
    customerType: typedToLowercase(subscription.customerType) as any,
    customerId: subscription.customerId,
    chargedAmount,
    skip: testMode,
  });
  if (originalMoneyTransfer) idx++;
  const productGrantIndex = idx;
  idx++; // product_grant
  const iqcEntries = createItemQuantityChangeEntriesForProduct({
    product: inlineProduct,
    purchaseQuantity: subscription.quantity,
    customerType: typedToLowercase(subscription.customerType) as any,
    customerId: subscription.customerId,
  });
  const itemQuantityChangeIndices: Record<string, number> = {};
  for (let j = 0; j < iqcEntries.length; j++) {
    const e = iqcEntries[j];
    if (e.type === "item_quantity_change") itemQuantityChangeIndices[e.item_id] = idx + j;
  }
  return { productGrantIndex, itemQuantityChangeIndices };
}

function buildSubscriptionRefundTransaction(subscription: Subscription): Transaction {
  const customerType = typedToLowercase(subscription.customerType);
  const product = subscription.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const selectedPrice = resolveSelectedPriceFromProduct(product, subscription.priceId ?? null);
  const chargedAmount = buildChargedAmount(selectedPrice, subscription.quantity);
  const testMode = subscription.creationSource === "TEST_MODE";
  const refundedAt = subscription.refundedAt ?? throwErr("refund transaction requires refundedAt");

  const { productGrantIndex, itemQuantityChangeIndices } = computeOriginalSubscriptionStartIndices(
    subscription, inlineProduct, testMode, chargedAmount
  );

  const entries: TransactionEntry[] = [];

  const negatedAmount: Record<string, string> = {};
  for (const [currency, amount] of Object.entries(chargedAmount)) {
    negatedAmount[currency] = amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
  }
  const moneyTransfer = createMoneyTransferEntry({
    customerType,
    customerId: subscription.customerId,
    chargedAmount: negatedAmount,
    skip: false,
  });
  if (moneyTransfer) {
    entries.push(moneyTransfer);
  }

  entries.push(createProductRevocationEntry({
    customerType,
    customerId: subscription.customerId,
    adjustedTransactionId: subscription.id,
    adjustedEntryIndex: productGrantIndex,
    quantity: subscription.quantity,
  }));

  entries.push(...createItemQuantityExpireEntriesForProduct({
    product: inlineProduct,
    purchaseQuantity: subscription.quantity,
    customerType,
    customerId: subscription.customerId,
    adjustedTransactionId: subscription.id,
    itemQuantityChangeIndices,
  }));

  entries.push(createActiveSubscriptionStopEntry({
    customerType,
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
  }));

  return {
    id: `${subscription.id}:refund`,
    created_at_millis: refundedAt.getTime(),
    effective_at_millis: refundedAt.getTime(),
    type: "purchase-refund",
    entries,
    adjusted_by: [],
    test_mode: subscription.creationSource === "TEST_MODE",
  };
}

function buildOneTimePurchaseRefundTransaction(purchase: OneTimePurchase): Transaction {
  const customerType = typedToLowercase(purchase.customerType);
  const product = purchase.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const selectedPrice = resolveSelectedPriceFromProduct(product, purchase.priceId ?? null);
  const chargedAmount = buildChargedAmount(selectedPrice, purchase.quantity);
  const testMode = purchase.creationSource === "TEST_MODE";
  const refundedAt = purchase.refundedAt ?? throwErr("refund transaction requires refundedAt");

  // Replicate one-time-purchase entry ordering to find the correct indices:
  // [0?] money_transfer, [N] product_grant, [N+1...] item_quantity_change
  let origIdx = 0;
  const originalMoneyTransfer = createMoneyTransferEntry({
    customerType, customerId: purchase.customerId, chargedAmount, skip: testMode,
  });
  if (originalMoneyTransfer) origIdx++;
  const productGrantIndex = origIdx;
  origIdx++;
  const iqcEntries = createItemQuantityChangeEntriesForProduct({
    product: inlineProduct, purchaseQuantity: purchase.quantity, customerType, customerId: purchase.customerId,
  });
  const itemQuantityChangeIndices: Record<string, number> = {};
  for (let j = 0; j < iqcEntries.length; j++) {
    const e = iqcEntries[j];
    if (e.type === "item_quantity_change") itemQuantityChangeIndices[e.item_id] = origIdx + j;
  }

  const entries: TransactionEntry[] = [];

  const negatedAmount: Record<string, string> = {};
  for (const [currency, amount] of Object.entries(chargedAmount)) {
    negatedAmount[currency] = amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
  }
  const moneyTransfer = createMoneyTransferEntry({
    customerType,
    customerId: purchase.customerId,
    chargedAmount: negatedAmount,
    skip: false,
  });
  if (moneyTransfer) {
    entries.push(moneyTransfer);
  }

  entries.push(createProductRevocationEntry({
    customerType,
    customerId: purchase.customerId,
    adjustedTransactionId: purchase.id,
    adjustedEntryIndex: productGrantIndex,
    quantity: purchase.quantity,
  }));

  entries.push(...createItemQuantityExpireEntriesForProduct({
    product: inlineProduct,
    purchaseQuantity: purchase.quantity,
    customerType,
    customerId: purchase.customerId,
    adjustedTransactionId: purchase.id,
    itemQuantityChangeIndices,
  }));

  return {
    id: `${purchase.id}:refund`,
    created_at_millis: refundedAt.getTime(),
    effective_at_millis: refundedAt.getTime(),
    type: "purchase-refund",
    entries,
    adjusted_by: [],
    test_mode: purchase.creationSource === "TEST_MODE",
  };
}

export function getPurchaseRefundTransactions(prisma: PrismaClientTransaction, tenancyId: string): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  const subscriptionRefunds = createSingleTableTransactionList({
    prisma,
    tenancyId: tenancyId,
    query: async (prisma, tenancyId, filter, cursorWhere, limit) => {
      const rows = await prisma.subscription.findMany({
        where: {
          tenancyId,
          refundedAt: { not: null },
          ...(cursorWhere ?? {}),
          ...(filter.customerType ? { customerType: typedToUppercase(filter.customerType) } : {}),
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows
        .map((r) => ({ ...r, createdAt: r.refundedAt ?? r.createdAt }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    cursorLookup: async (prisma, tenancyId, cursorId) => {
      const row = await prisma.subscription.findUnique({
        where: { tenancyId_id: { tenancyId, id: cursorId } },
        select: { refundedAt: true, createdAt: true },
      });
      return row ? { createdAt: row.refundedAt ?? row.createdAt } : null;
    },
    toTransaction: (row) => buildSubscriptionRefundTransaction(row),
  });

  const otpRefunds = createSingleTableTransactionList({
    prisma,
    tenancyId: tenancyId,
    query: async (prisma, tenancyId, filter, cursorWhere, limit) => {
      const rows = await prisma.oneTimePurchase.findMany({
        where: {
          tenancyId,
          refundedAt: { not: null },
          ...(cursorWhere ?? {}),
          ...(filter.customerType ? { customerType: typedToUppercase(filter.customerType) } : {}),
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows
        .map((r) => ({ ...r, createdAt: r.refundedAt ?? r.createdAt }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    cursorLookup: async (prisma, tenancyId, cursorId) => {
      const row = await prisma.oneTimePurchase.findUnique({
        where: { tenancyId_id: { tenancyId, id: cursorId } },
        select: { refundedAt: true, createdAt: true },
      });
      return row ? { createdAt: row.refundedAt ?? row.createdAt } : null;
    },
    toTransaction: (row) => buildOneTimePurchaseRefundTransaction(row),
  });

  return PaginatedList.merge(subscriptionRefunds, otpRefunds);
}
