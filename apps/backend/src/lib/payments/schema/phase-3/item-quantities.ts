/**
 * Phase 3: ItemQuantities table.
 *
 * Takes the split item-changes-with-expiries and computes the net item
 * quantities at each transaction point using the ledger algorithm.
 *
 * Groups by (tenancyId, customerType, customerId), sorts by effectiveAtMillis,
 * and folds with the ledger reducer. The fold state is a map of itemId → quantity.
 *
 * Each output row represents the full item quantities state for a customer after
 * a particular transaction. getItemQuantityForCustomer queries the latest row
 * and extracts the specific item via imperative code.
 */

import {
  declareGroupByTable,
  declareLFoldTable,
  declareSortTable,
} from "@/lib/bulldozer/db/index";
import type { ItemChangesWithExpiriesTables } from "./item-changes-with-expiries";
import { getLedgerAlgoReducerSql } from "./ledger-algo";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });


export function createItemQuantitiesTable(changeTables: ItemChangesWithExpiriesTables) {

  // Group by (tenancyId, customerType, customerId) -- NOT by itemId.
  // The fold tracks all items for a customer in its state map.
  const changesByCustomer = declareGroupByTable({
    tableId: "payments-changes-by-customer",
    fromTable: changeTables.splitChanges,
    groupBy: mapper(`
      jsonb_build_object(
        'tenancyId', "rowData"->'tenancyId',
        'customerType', "rowData"->'customerType',
        'customerId', "rowData"->'customerId'
      ) AS "groupKey"
    `),
  });

  // Sort by effectiveAtMillis within each customer group
  const changesSorted = declareSortTable({
    tableId: "payments-changes-sorted-for-ledger",
    fromTable: changesByCustomer,
    getSortKey: mapper(`("rowData"->'txnEffectiveAtMillis') AS "newSortKey"`),
    compareSortKeys: (a, b) => ({
      type: "expression",
      sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int`,
    }),
  });

  // LFold with the ledger algorithm.
  // State: JSONB map of itemId → net quantity (e.g. {"credits": 95, "bonus": 10})
  const itemQuantities = declareLFoldTable({
    tableId: "payments-item-quantities",
    fromTable: changesSorted,
    initialState: { type: "expression" as const, sql: "'{}'::jsonb" },
    reducer: mapper(getLedgerAlgoReducerSql()),
  });

  const _allItemQuantitiesTables = [
    changesByCustomer,
    changesSorted,
    itemQuantities,
  ] as const;

  return { itemQuantities, _allItemQuantitiesTables };
}

export type ItemQuantitiesTables = ReturnType<typeof createItemQuantitiesTable>;
