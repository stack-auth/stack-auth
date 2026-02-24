import type { Subscription } from "@/generated/prisma/client";
import { productToInlineProduct } from "@/lib/payments/index";
import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
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

function buildSubscriptionEndTransaction(subscription: Subscription): Transaction {
  const customerType = typedToLowercase(subscription.customerType);
  const product = subscription.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const endedAt = subscription.endedAt ?? throwErr("subscription-end transaction requires endedAt");

  // Re-derive indices from the original subscription-start entry ordering:
  // [0] active_subscription_start, [1?] money_transfer, [N] product_grant, [N+1...] item_quantity_change
  const testMode = subscription.creationSource === "TEST_MODE";
  const selectedPrice = resolveSelectedPriceFromProduct(product, subscription.priceId ?? null);
  const chargedAmount = buildChargedAmount(selectedPrice, subscription.quantity);
  let origIdx = 1;
  const originalMoneyTransfer = createMoneyTransferEntry({
    customerType, customerId: subscription.customerId, chargedAmount, skip: testMode,
  });
  if (originalMoneyTransfer) origIdx++;
  const productGrantIndex = origIdx;
  origIdx++;
  const iqcEntries = createItemQuantityChangeEntriesForProduct({
    product: inlineProduct, purchaseQuantity: subscription.quantity, customerType, customerId: subscription.customerId,
  });
  const itemQuantityChangeIndices: Record<string, number> = {};
  for (let j = 0; j < iqcEntries.length; j++) {
    const e = iqcEntries[j];
    if (e.type === "item_quantity_change") itemQuantityChangeIndices[e.item_id] = origIdx + j;
  }

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
      adjustedEntryIndex: productGrantIndex,
      quantity: subscription.quantity,
    }),
    ...createItemQuantityExpireEntriesForProduct({
      product: inlineProduct,
      purchaseQuantity: subscription.quantity,
      customerType,
      customerId: subscription.customerId,
      adjustedTransactionId: subscription.id,
      itemQuantityChangeIndices,
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

export function getSubscriptionEndTransactions(prisma: PrismaClientTransaction, tenancyId: string): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return createSingleTableTransactionList({
    prisma,
    tenancyId: tenancyId,
    query: async (prisma, tenancyId, filter, cursorWhere, limit) => {
      const rows = await prisma.subscription.findMany({
        where: {
          tenancyId,
          endedAt: { not: null },
          ...(cursorWhere ?? {}),
          ...(filter.customerType ? { customerType: typedToUppercase(filter.customerType) } : {}),
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
        },
        orderBy: [{ endedAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows
        .map((r) => ({ ...r, createdAt: r.endedAt ?? r.createdAt }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    cursorLookup: async (prisma, tenancyId, cursorId) => {
      const row = await prisma.subscription.findUnique({
        where: { tenancyId_id: { tenancyId, id: cursorId } },
        select: { endedAt: true, createdAt: true },
      });
      return row ? { createdAt: row.endedAt ?? row.createdAt } : null;
    },
    toTransaction: (row) => buildSubscriptionEndTransaction(row),
  });
}
