import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import { emptyTransactionList, type TransactionFilter, type TransactionOrderBy } from "../helpers";

export function getChargebackTransactions(_prisma: PrismaClientTransaction, _tenancyId: string): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  return emptyTransactionList();
}
