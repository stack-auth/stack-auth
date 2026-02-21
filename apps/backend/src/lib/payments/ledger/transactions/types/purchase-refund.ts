import type { OneTimePurchase, Subscription } from "@/generated/prisma/client";
import { productToInlineProduct } from "@/lib/payments/index";
import { Tenancy } from "@/lib/tenancies";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { InferType } from "yup";
import {
  buildChargedAmount,
  createActiveSubscriptionStopEntry,
  createItemQuantityExpireEntriesForProduct,
  createMoneyTransferEntry,
  createProductRevocationEntry,
  createSingleTableTransactionList,
  resolveSelectedPriceFromProduct,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function buildSubscriptionRefundTransaction(subscription: Subscription): Transaction {
  const customerType = typedToLowercase(subscription.customerType);
  const product = subscription.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const selectedPrice = resolveSelectedPriceFromProduct(product, subscription.priceId ?? null);
  const chargedAmount = buildChargedAmount(selectedPrice, subscription.quantity);
  const refundedAt = subscription.refundedAt ?? throwErr("refund transaction requires refundedAt");

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
    adjustedEntryIndex: 0,
    quantity: subscription.quantity,
  }));

  entries.push(...createItemQuantityExpireEntriesForProduct({
    product: inlineProduct,
    purchaseQuantity: subscription.quantity,
    customerType,
    customerId: subscription.customerId,
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
  const refundedAt = purchase.refundedAt ?? throwErr("refund transaction requires refundedAt");

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
    adjustedEntryIndex: 0,
    quantity: purchase.quantity,
  }));

  entries.push(...createItemQuantityExpireEntriesForProduct({
    product: inlineProduct,
    purchaseQuantity: purchase.quantity,
    customerType,
    customerId: purchase.customerId,
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

export function getPurchaseRefundTransactions(tenancy: Tenancy): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  const subscriptionRefunds = createSingleTableTransactionList({
    tenancy,
    query: (prisma, tenancyId, filter, cursorWhere, limit) => prisma.subscription.findMany({
      where: {
        tenancyId,
        refundedAt: { not: null },
        ...(cursorWhere ?? {}),
        ...(filter.customerType ? { customerType: typedToUppercase(filter.customerType) } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    cursorLookup: (prisma, tenancyId, cursorId) => prisma.subscription.findUnique({
      where: { tenancyId_id: { tenancyId, id: cursorId } },
      select: { createdAt: true },
    }),
    toTransaction: (row) => buildSubscriptionRefundTransaction(row),
  });

  const otpRefunds = createSingleTableTransactionList({
    tenancy,
    query: (prisma, tenancyId, filter, cursorWhere, limit) => prisma.oneTimePurchase.findMany({
      where: {
        tenancyId,
        refundedAt: { not: null },
        ...(cursorWhere ?? {}),
        ...(filter.customerType ? { customerType: typedToUppercase(filter.customerType) } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    cursorLookup: (prisma, tenancyId, cursorId) => prisma.oneTimePurchase.findUnique({
      where: { tenancyId_id: { tenancyId, id: cursorId } },
      select: { createdAt: true },
    }),
    toTransaction: (row) => buildOneTimePurchaseRefundTransaction(row),
  });

  return PaginatedList.merge(subscriptionRefunds, otpRefunds);
}
