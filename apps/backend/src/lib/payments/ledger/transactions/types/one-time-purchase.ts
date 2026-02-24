import type { OneTimePurchase } from "@/generated/prisma/client";
import { productToInlineProduct } from "@/lib/payments/index";
import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { productSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { InferType } from "yup";
import {
  buildChargedAmount,
  createItemQuantityChangeEntriesForProduct,
  createMoneyTransferEntry,
  createProductGrantEntry,
  createSingleTableTransactionList,
  resolveSelectedPriceFromProduct,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function buildOneTimePurchaseTransaction(purchase: OneTimePurchase): Transaction {
  const customerType = typedToLowercase(purchase.customerType);
  const product = purchase.product as InferType<typeof productSchema>;
  const inlineProduct = productToInlineProduct(product);
  const selectedPrice = resolveSelectedPriceFromProduct(product, purchase.priceId ?? null);
  const quantity = purchase.quantity;
  const chargedAmount = buildChargedAmount(selectedPrice, quantity);
  const testMode = purchase.creationSource === "TEST_MODE";

  const entries: TransactionEntry[] = [];

  const moneyTransfer = createMoneyTransferEntry({
    customerType,
    customerId: purchase.customerId,
    chargedAmount,
    skip: testMode,
  });
  if (moneyTransfer) {
    entries.push(moneyTransfer);
  }

  const iqcStartIndex = entries.length + 1;
  const iqcEntries = createItemQuantityChangeEntriesForProduct({
    product: inlineProduct,
    purchaseQuantity: quantity,
    customerType,
    customerId: purchase.customerId,
  });
  const itemQuantityChangeIndices: Record<string, number> = {};
  for (let j = 0; j < iqcEntries.length; j++) {
    const e = iqcEntries[j];
    if (e.type === "item_quantity_change") itemQuantityChangeIndices[e.item_id] = iqcStartIndex + j;
  }

  entries.push(createProductGrantEntry({
    customerType,
    customerId: purchase.customerId,
    productId: purchase.productId ?? null,
    product: inlineProduct,
    priceId: purchase.priceId ?? null,
    quantity,
    cycleAnchor: purchase.createdAt.getTime(),
    oneTimePurchaseId: purchase.id,
    itemQuantityChangeIndices,
  }));

  entries.push(...iqcEntries);

  return {
    id: purchase.id,
    created_at_millis: purchase.createdAt.getTime(),
    effective_at_millis: purchase.createdAt.getTime(),
    type: "one-time-purchase",
    entries,
    adjusted_by: [],
    test_mode: testMode,
  };
}

export function getOneTimePurchaseTransactions(prisma: PrismaClientTransaction, tenancyId: string): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return createSingleTableTransactionList({
    prisma,
    tenancyId: tenancyId,
    query: (prisma, tenancyId, filter, cursorWhere, limit) => prisma.oneTimePurchase.findMany({
      where: {
        tenancyId,
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
    toTransaction: (row) => buildOneTimePurchaseTransaction(row),
  });
}
