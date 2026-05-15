/**
 * Payments Bulldozer Schema
 *
 * Composes all table declarations into a single schema object.
 * Data flows: StoredTables → Events → Transactions → CompactedEntries → OwnedProducts / ItemQuantities
 */

import { declareGroupByTable, declareLFoldTable, declareSortTable } from "@/lib/bulldozer/db/index";
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

  // Per-customer subscription map: GroupBy → Sort → LFold.
  // The LFold maintains a map of { subscriptionId → full SubscriptionRow }
  // per customer. Reading the latest LFold row gives O(1) access to all
  // current subscriptions for a customer without loading all stored rows.
  const mapper = (sql: string) => ({ type: "mapper" as const, sql });
  const subscriptionsByCustomer = declareGroupByTable({
    tableId: "payments-subscriptions-by-customer",
    fromTable: seedEventsStoredTables.subscriptions,
    groupBy: mapper(`
      jsonb_build_object(
        'tenancyId', "rowData"->'tenancyId',
        'customerType', "rowData"->'customerType',
        'customerId', "rowData"->'customerId'
      ) AS "groupKey"
    `),
  });
  const subscriptionsSorted = declareSortTable({
    tableId: "payments-subscriptions-sorted",
    fromTable: subscriptionsByCustomer,
    getSortKey: mapper(`("rowData"->'createdAtMillis') AS "newSortKey"`),
    compareSortKeys: (a, b) => ({
      type: "expression",
      sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int`,
    }),
  });
  const subscriptionMapByCustomer = declareLFoldTable({
    tableId: "payments-subscription-map-by-customer",
    fromTable: subscriptionsSorted,
    initialState: { type: "expression" as const, sql: "'{}'::jsonb" },
    reducer: mapper(`
      CASE
        WHEN "oldRowData"->>'id' IS NULL THEN "oldState"
        ELSE ("oldState" || jsonb_build_object("oldRowData"->>'id', "oldRowData"))
      END AS "newState",
      CASE
        WHEN "oldRowData"->>'id' IS NULL THEN '[]'::jsonb
        ELSE jsonb_build_array(
          jsonb_build_object(
            'subscriptions', ("oldState" || jsonb_build_object("oldRowData"->>'id', "oldRowData")),
            'tenancyId', "oldRowData"->'tenancyId',
            'customerType', "oldRowData"->'customerType',
            'customerId', "oldRowData"->'customerId'
          )
        )
      END AS "newRowsData"
    `),
  });

  // Phase 2
  const entryTables = createCompactedTransactionEntries(txnTables);

  // Phase 3
  const ownedProductsTables = createOwnedProductsTable(entryTables);
  const changeTables = createItemChangesWithExpiries(entryTables);
  const itemQuantitiesTables = createItemQuantitiesTable(changeTables);

  const seedStoredTablesArray = Object.values(seedEventsStoredTables);

  /** Phase 1 tables only: stored tables → events → transactions */
  const _allPhase1Tables = [
    ...seedStoredTablesArray,
    subscriptionsByCustomer,
    subscriptionsSorted,
    subscriptionMapByCustomer,
    ...events._allEventTables,
    ...txnTables._allTransactionTables,
  ] as const;

  /** Phase 1+2 tables in init order */
  const _allPhase1And2Tables = [
    ..._allPhase1Tables,
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
    "phase-3-owned": { label: "Phase 3: Owned Products", color: "rgba(168,85,247,0.10)", tables: ownedProductsTables._allOwnedProductsTables },
    "phase-3-items": { label: "Phase 3: Item Quantities", color: "rgba(236,72,153,0.10)", tables: [...changeTables._allItemChangesWithExpiriesTables, ...itemQuantitiesTables._allItemQuantitiesTables] },
  };

  return {
    ...seedEventsStoredTables,
    subscriptionsByCustomer,
    subscriptionsSorted,
    subscriptionMapByCustomer,
    ...events,
    ...txnTables,
    ...entryTables,
    ...ownedProductsTables,
    ...changeTables,
    ...itemQuantitiesTables,
    _allPhase1Tables,
    _allPhase1And2Tables,
    _allTables,
    _categories,
  };
}

export type PaymentsSchema = ReturnType<typeof createPaymentsSchema>;
