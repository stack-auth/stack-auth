import type { ItemQuantityChange } from "@/generated/prisma/client";
import { Tenancy } from "@/lib/tenancies";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import {
  createSingleTableTransactionList,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function buildItemQuantityChangeTransaction(options: {
  change: ItemQuantityChange,
}): Transaction {
  const { change } = options;
  const customerType = typedToLowercase(change.customerType);

  const entries: TransactionEntry[] = [
    {
      type: "item_quantity_change",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: change.customerId,
      item_id: change.itemId,
      quantity: change.quantity,
    },
  ];

  return {
    id: change.id,
    created_at_millis: change.createdAt.getTime(),
    effective_at_millis: change.createdAt.getTime(),
    type: "manual-item-quantity-change",
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

export function getManualItemQuantityChangeTransactions(tenancy: Tenancy): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return createSingleTableTransactionList({
    tenancy,
    query: (prisma, tenancyId, filter, cursorWhere, limit) => prisma.itemQuantityChange.findMany({
      where: { tenancyId, ...(cursorWhere ?? {}), ...(filter.customerType ? { customerType: typedToUppercase(filter.customerType) } : {}), ...(filter.customerId ? { customerId: filter.customerId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    cursorLookup: (prisma, tenancyId, cursorId) => prisma.itemQuantityChange.findUnique({
      where: { tenancyId_id: { tenancyId, id: cursorId } },
      select: { createdAt: true },
    }),
    toTransaction: (row) => buildItemQuantityChangeTransaction({ change: row }),
  });
}
