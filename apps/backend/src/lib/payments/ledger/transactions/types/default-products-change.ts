import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import {
  compareTransactions,
  createDefaultProductsChangeEntry,
  type ProductSnapshot,
  type TransactionFilter,
  type TransactionOrderBy,
} from "../helpers";

function buildDefaultProductsChangeTransaction(row: { id: string, snapshot: unknown, createdAt: Date }): Transaction {
  const snapshot = row.snapshot as Record<string, ProductSnapshot>;
  const entries: TransactionEntry[] = [
    createDefaultProductsChangeEntry({ snapshot }),
  ];

  return {
    id: `default-products:${row.id}`,
    created_at_millis: row.createdAt.getTime(),
    effective_at_millis: row.createdAt.getTime(),
    type: "default-products-change",
    entries,
    adjusted_by: [],
    test_mode: false,
  };
}

/**
 * Returns default-products-change transactions from the DefaultProductsSnapshot table.
 * These transactions are global (not per-customer) so the customerId filter is ignored.
 */
export function getDefaultProductsChangeTransactions(prisma: PrismaClientTransaction, tenancyId: string): PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
  class DefaultProductsChangeList extends PaginatedList<Transaction, string, TransactionFilter, TransactionOrderBy> {
    override _getFirstCursor() { return ""; }
    override _getLastCursor() { return ""; }
    override _compare(orderBy: TransactionOrderBy, a: Transaction, b: Transaction) {
      return compareTransactions(orderBy, a, b);
    }

    override async _nextOrPrev(
      _type: "next" | "prev",
      opts: { cursor: string, limit: number, limitPrecision: "approximate", filter: TransactionFilter, orderBy: TransactionOrderBy },
    ) {
      let cursorWhere: object | undefined;
      if (opts.cursor) {
        const pivot = await prisma.defaultProductsSnapshot.findUnique({
          where: { tenancyId_id: { tenancyId, id: opts.cursor } },
          select: { createdAt: true },
        });
        if (pivot) {
          cursorWhere = {
            OR: [
              { createdAt: { lt: pivot.createdAt } },
              { AND: [{ createdAt: { equals: pivot.createdAt } }, { id: { lt: opts.cursor } }] },
            ],
          };
        }
      }

      const rows = await prisma.defaultProductsSnapshot.findMany({
        where: {
          tenancyId,
          ...(cursorWhere ?? {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: opts.limit,
      });

      const items = rows.map((row) => {
        const tx = buildDefaultProductsChangeTransaction(row);
        return { item: tx, prevCursor: row.id, nextCursor: row.id };
      });

      const lastId = rows.length > 0 ? rows[rows.length - 1].id : opts.cursor;

      return {
        items,
        isFirst: !opts.cursor,
        isLast: rows.length < opts.limit,
        cursor: lastId,
      };
    }
  }

  return new DefaultProductsChangeList();
}
