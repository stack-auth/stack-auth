import { Tenancy } from "@/lib/tenancies";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { emptyTransactionList, type TransactionFilter, type TransactionOrderBy } from "../helpers";

export function getProductVersionChangeTransactions(_tenancy: Tenancy): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return emptyTransactionList();
}
