import type { Subscription } from "@/generated/prisma/client";
import { productToInlineProduct } from "@/lib/payments/index";
import { Tenancy } from "@/lib/tenancies";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { InferType } from "yup";
import {
  createActiveSubscriptionStopEntry,
  createItemQuantityExpireEntriesForProduct,
  createProductRevocationEntry,
  createSingleTableTransactionList,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function buildSubscriptionEndTransaction(subscription: Subscription): Transaction {
  const customerType = typedToLowercase(subscription.customerType);
  const product = subscription.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const endedAt = subscription.endedAt ?? throwErr("subscription-end transaction requires endedAt");

  const entries: TransactionEntry[] = [
    createActiveSubscriptionStopEntry({
      customerType,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
    }),
    createProductRevocationEntry({
      customerType,
      customerId: subscription.customerId,
      adjustedTransactionId: subscription.id,
      adjustedEntryIndex: 0,
      quantity: subscription.quantity,
    }),
    ...createItemQuantityExpireEntriesForProduct({
      product: inlineProduct,
      purchaseQuantity: subscription.quantity,
      customerType,
      customerId: subscription.customerId,
    }),
  ];

  return {
    id: `${subscription.id}:end`,
    created_at_millis: endedAt.getTime(),
    effective_at_millis: endedAt.getTime(),
    type: "subscription-end",
    entries,
    adjusted_by: [],
    test_mode: subscription.creationSource === "TEST_MODE",
  };
}

export function getSubscriptionEndTransactions(tenancy: Tenancy): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return createSingleTableTransactionList({
    tenancy,
    query: (prisma, tenancyId, filter, cursorWhere, limit) => prisma.subscription.findMany({
      where: {
        tenancyId,
        endedAt: { not: null },
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
    toTransaction: (row) => buildSubscriptionEndTransaction(row),
  });
}
