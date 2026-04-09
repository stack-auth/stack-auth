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

  /** All tables in init order. Init from first to last; delete in reverse. */
  const _allTables = [
    ...seedStoredTablesArray,
    ...events._allEventTables,
    ...txnTables._allTransactionTables,
  ] as const;

  return {
    ...seedEventsStoredTables,
    ...events,
    ...txnTables,
    ...entryTables,
    ...ownedProductsTables,
    ...changeTables,
    ...itemQuantitiesTables,
    _allTables,
  };
}

export type PaymentsSchema = ReturnType<typeof createPaymentsSchema>;
