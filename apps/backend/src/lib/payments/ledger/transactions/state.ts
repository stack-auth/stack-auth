import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { EventQueue } from "./queue";
import type { ActiveDefaultItemState, ActivePurchaseState, SeedEvent } from "./types";

export type BuildState = {
  queue: EventQueue<SeedEvent>,
  output: Transaction[],
  nowMillis: number,
  activeDefaultProducts: Map<string, Map<string, ActiveDefaultItemState>>,
  activePurchases: Map<string, ActivePurchaseState>,
  previousDefaultProductsChangePointer: { txId: string, entryIndex: number } | null,
};
