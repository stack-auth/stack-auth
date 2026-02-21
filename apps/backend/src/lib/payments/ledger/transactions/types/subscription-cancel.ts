import type { Subscription } from "@/generated/prisma/client";
import { Tenancy } from "@/lib/tenancies";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import {
  createActiveSubscriptionChangeEntry,
  createSingleTableTransactionList,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function buildSubscriptionCancelTransaction(subscription: Subscription): Transaction {
  const customerType = typedToLowercase(subscription.customerType);

  const entries: TransactionEntry[] = [
    createActiveSubscriptionChangeEntry({
      customerType,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      changeType: "cancel",
    }),
  ];

  return {
    id: `${subscription.id}:cancel`,
    created_at_millis: subscription.updatedAt.getTime(),
    effective_at_millis: subscription.updatedAt.getTime(),
    type: "subscription-cancel",
    entries,
    adjusted_by: [],
    test_mode: subscription.creationSource === "TEST_MODE",
  };
}

export function getSubscriptionCancelTransactions(tenancy: Tenancy): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return createSingleTableTransactionList({
    tenancy,
    query: (prisma, tenancyId, filter, cursorWhere, limit) => prisma.subscription.findMany({
      where: {
        tenancyId,
        cancelAtPeriodEnd: true,
        endedAt: null,
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
    toTransaction: (row) => buildSubscriptionCancelTransaction(row),
  });
}
