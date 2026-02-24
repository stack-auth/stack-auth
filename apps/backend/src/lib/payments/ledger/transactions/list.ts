import { PrismaClientTransaction } from "@/prisma-client";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { fetchSeedEvents } from "./seed-events";
import { processEvent } from "./processor";
import { EventQueue } from "./queue";
import type { BuildState } from "./state";
import type { FullTransactionFilter, SeedEvent, TransactionOrderBy } from "./types";

async function buildTransactions(prisma: PrismaClientTransaction, tenancyId: string, filter: FullTransactionFilter): Promise<Transaction[]> {
  const state: BuildState = {
    queue: new EventQueue<SeedEvent>(),
    output: [],
    nowMillis: new Date().getTime(),
    activeDefaultProducts: new Map(),
    activePurchases: new Map(),
    previousDefaultProductsChangePointer: null,
  };
  const seedEvents = await fetchSeedEvents(prisma, tenancyId, filter);
  for (const event of seedEvents) state.queue.push(event);

  while (true) {
    const event = state.queue.pop();
    if (!event) break;
    if (event.at > state.nowMillis) break;
    processEvent(state, event);
  }

  state.output.sort((a, b) => {
    if (a.created_at_millis !== b.created_at_millis) return b.created_at_millis - a.created_at_millis;
    return a.id < b.id ? 1 : -1;
  });
  return filter.type ? state.output.filter((tx) => tx.type === filter.type) : state.output;
}

export class BuiltTransactionsList {
  private readonly cache = new Map<string, Promise<Transaction[]>>();

  constructor(
    private readonly prisma: PrismaClientTransaction,
    private readonly tenancyId: string,
  ) {}

  getFirstCursor() { return ""; }
  getLastCursor() { return ""; }

  async next(opts: {
    after: string,
    limit: number,
    filter: FullTransactionFilter,
    orderBy: TransactionOrderBy,
    limitPrecision: "exact" | "approximate",
  }) {
    const filterKey = JSON.stringify(opts.filter);
    const allPromise = this.cache.get(filterKey) ?? buildTransactions(this.prisma, this.tenancyId, opts.filter);
    this.cache.set(filterKey, allPromise);
    const all = await allPromise;
    const start = opts.after ? Math.max(0, all.findIndex((tx) => tx.id === opts.after) + 1) : 0;
    const page = all.slice(start, start + opts.limit);
    const cursor = page.length > 0 ? page[page.length - 1].id : opts.after;
    return {
      items: page.map((item) => ({ item, prevCursor: item.id, nextCursor: item.id })),
      isFirst: start === 0,
      isLast: start + opts.limit >= all.length,
      cursor,
    };
  }
}
