/**
 * Payments Bulldozer Schema
 *
 * Composes all table declarations into a single schema object.
 * Data flows: StoredTables → Events → Transactions → CompactedEntries → OwnedProducts / ItemQuantities
 */

import { createEventTables } from "./phase-1/events";
import { createSeedEventsStoredTables } from "./phase-1/stored-tables";
import { createTransactionsTable } from "./phase-1/transactions";
import { createCompactedTransactionEntries } from "./phase-2/compacted-transaction-entries";
import { createItemChangesWithExpiries } from "./phase-3/item-changes-with-expiries";
import { createItemQuantitiesTable } from "./phase-3/item-quantities";
import { createOwnedProductsTable } from "./phase-3/owned-products";

export type * from "./types";

export function createPaymentsSchema() {
  // Phase 1
  const seedEventsStoredTables = createSeedEventsStoredTables();
  const events = createEventTables(seedEventsStoredTables);
  const txnTables = createTransactionsTable(events, seedEventsStoredTables.manualTransactions);

  // Phase 2
  const entryTables = createCompactedTransactionEntries(txnTables);

  // Phase 3
  const ownedProductsTables = createOwnedProductsTable(entryTables);
  const changeTables = createItemChangesWithExpiries(entryTables);
  const itemQuantitiesTables = createItemQuantitiesTable(changeTables);

  const seedStoredTablesArray = Object.values(seedEventsStoredTables);

  /** Phase 1+2 tables in init order (for Phase 1 and Phase 2 tests) */
  const _allPhase1And2Tables = [
    ...seedStoredTablesArray,
    ...events._allEventTables,
    ...txnTables._allTransactionTables,
    ...entryTables._allCompactedTransactionEntriesTables,
  ] as const;

  /** All tables in init order. Init from first to last; delete in reverse. */
  const _allTables = [
    ..._allPhase1And2Tables,
    ...ownedProductsTables._allOwnedProductsTables,
    ...changeTables._allItemChangesWithExpiriesTables,
    ...itemQuantitiesTables._allItemQuantitiesTables,
  ] as const;

  /** Category metadata for Bulldozer Studio visualization */
  const _categories: Record<string, { label: string, color: string, tables: readonly unknown[] }> = {
    "phase-1-stored": { label: "Phase 1: Stored Tables", color: "rgba(99,102,241,0.10)", tables: seedStoredTablesArray },
    "phase-1-events": { label: "Phase 1: Events", color: "rgba(34,197,94,0.10)", tables: events._allEventTables },
    "phase-1-txns": { label: "Phase 1: Transactions", color: "rgba(234,179,8,0.10)", tables: txnTables._allTransactionTables },
    "phase-2": { label: "Phase 2: Compacted Entries", color: "rgba(249,115,22,0.10)", tables: entryTables._allCompactedTransactionEntriesTables },
  };

  return {
    ...seedEventsStoredTables,
    ...events,
    ...txnTables,
    ...entryTables,
    ...ownedProductsTables,
    ...changeTables,
    ...itemQuantitiesTables,
    _allPhase1And2Tables,
    _allTables,
    _categories,
  };
}

export type PaymentsSchema = ReturnType<typeof createPaymentsSchema>;
