import type { Subscription } from "@/generated/prisma/client";
import { productToInlineProduct } from "@/lib/payments/index";
import { Tenancy } from "@/lib/tenancies";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { InferType } from "yup";
import {
  buildChargedAmount,
  createActiveSubscriptionStartEntry,
  createItemQuantityChangeEntriesForProduct,
  createMoneyTransferEntry,
  createProductGrantEntry,
  createSingleTableTransactionList,
  resolveSelectedPriceFromProduct,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function buildSubscriptionStartTransaction(subscription: Subscription): Transaction {
  const customerType = typedToLowercase(subscription.customerType);
  const product = subscription.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const selectedPrice = resolveSelectedPriceFromProduct(product, subscription.priceId ?? null);
  const quantity = subscription.quantity;
  const chargedAmount = buildChargedAmount(selectedPrice, quantity);
  const testMode = subscription.creationSource === "TEST_MODE";
  const cycleAnchor = (subscription.billingCycleAnchor ?? subscription.createdAt).getTime();

  const entries: TransactionEntry[] = [
    createActiveSubscriptionStartEntry({
      customerType,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      productId: subscription.productId ?? null,
      product: inlineProduct,
    }),
  ];

  const moneyTransfer = createMoneyTransferEntry({
    customerType,
    customerId: subscription.customerId,
    chargedAmount,
    skip: testMode,
  });
  if (moneyTransfer) {
    entries.push(moneyTransfer);
  }

  entries.push(createProductGrantEntry({
    customerType,
    customerId: subscription.customerId,
    productId: subscription.productId ?? null,
    product: inlineProduct,
    priceId: subscription.priceId ?? null,
    quantity,
    cycleAnchor,
    subscriptionId: subscription.id,
  }));

  entries.push(...createItemQuantityChangeEntriesForProduct({
    product: inlineProduct,
    purchaseQuantity: quantity,
    customerType,
    customerId: subscription.customerId,
  }));

  return {
    id: subscription.id,
    created_at_millis: subscription.createdAt.getTime(),
    effective_at_millis: subscription.createdAt.getTime(),
    type: "subscription-start",
    entries,
    adjusted_by: [],
    test_mode: testMode,
  };
}

export function getSubscriptionStartTransactions(tenancy: Tenancy): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return createSingleTableTransactionList({
    tenancy,
    query: (prisma, tenancyId, filter, cursorWhere, limit) => prisma.subscription.findMany({
      where: {
        tenancyId,
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
    toTransaction: (row) => buildSubscriptionStartTransaction(row),
  });
}
