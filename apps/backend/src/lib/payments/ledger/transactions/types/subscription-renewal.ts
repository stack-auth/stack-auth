import type { Subscription, SubscriptionInvoice } from "@/generated/prisma/client";
import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase } from "@stackframe/stack-shared/dist/utils/strings";
import { InferType } from "yup";
import {
  buildChargedAmount,
  createMoneyTransferEntry,
  createSingleTableTransactionList,
  resolveSelectedPriceFromProduct,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function buildSubscriptionRenewalTransaction(subscription: Subscription, subscriptionInvoice: SubscriptionInvoice): Transaction {
  const product = subscription.product as InferType<typeof productSchema>;
  const selectedPrice = resolveSelectedPriceFromProduct(product, subscription.priceId ?? null);
  const chargedAmount = buildChargedAmount(selectedPrice, subscription.quantity);

  const entries: TransactionEntry[] = [];
  const moneyTransfer = createMoneyTransferEntry({
    customerType: typedToLowercase(subscription.customerType),
    customerId: subscription.customerId,
    chargedAmount,
    skip: false,
  });
  if (moneyTransfer) {
    entries.push(moneyTransfer);
  }

  return {
    type: "subscription-renewal",
    id: subscriptionInvoice.id,
    test_mode: false,
    entries,
    adjusted_by: [],
    created_at_millis: subscriptionInvoice.createdAt.getTime(),
    effective_at_millis: subscriptionInvoice.createdAt.getTime(),
  };
}

export function getSubscriptionRenewalTransactions(prisma: PrismaClientTransaction, tenancyId: string): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return createSingleTableTransactionList<SubscriptionInvoice & { subscription: Subscription }>({
    prisma,
    tenancyId: tenancyId,
    query: (prisma, tenancyId, filter, cursorWhere, limit) => prisma.subscriptionInvoice.findMany({
      where: {
        tenancyId,
        ...(cursorWhere ?? {}),
        subscription: {
          ...(filter.customerType ? { customerType: filter.customerType.toUpperCase() as any } : {}),
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
        },
        isSubscriptionCreationInvoice: false,
      },
      include: { subscription: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    cursorLookup: (prisma, tenancyId, cursorId) => prisma.subscriptionInvoice.findUnique({
      where: { tenancyId_id: { tenancyId, id: cursorId } },
      select: { createdAt: true },
    }),
    toTransaction: (row) => buildSubscriptionRenewalTransaction(row.subscription, row),
  });
}
