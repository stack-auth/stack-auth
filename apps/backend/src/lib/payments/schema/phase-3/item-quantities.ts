/**
 * Phase 3: ItemQuantities table.
 *
 * Takes the split item-changes-with-expiries and computes the net item
 * quantities at each transaction point using the ledger algorithm.
 *
 * GK = (tenancyId, customerType, customerId) inherited from phase 2.
 * Sorts by effectiveAtMillis and folds with the ledger reducer.
 * The fold state tracks grants and removals per item with expiry info.
 *
 * Each output row represents the full item quantities state for a customer after
 * a particular transaction. getItemQuantityForCustomer queries the latest row
 * and extracts the specific item via imperative code.
 */

import {
  declareLFoldTable,
  declareSortTable,
} from "@/lib/bulldozer/db/index";
import type { ItemChangesWithExpiriesTables } from "./item-changes-with-expiries";
import { getLedgerAlgoReducerSql } from "./ledger-algo";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });


export function createItemQuantitiesTable(changeTables: ItemChangesWithExpiriesTables) {

  // Sort by effectiveAtMillis within each customer group.
  // GK = (tenancyId, customerType, customerId) inherited from phase 2.
  const changesSorted = declareSortTable({
    tableId: "payments-changes-sorted-for-ledger",
    fromTable: changeTables.splitChanges,
    getSortKey: mapper(`("rowData"->'txnEffectiveAtMillis') AS "newSortKey"`),
    compareSortKeys: (a, b) => ({
      type: "expression",
      sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int`,
    }),
  });

  // LFold with the ledger algorithm.
  // State: JSONB map of itemId → { grants: [{q, e}], debt: number }
  const itemQuantities = declareLFoldTable({
    tableId: "payments-item-quantities",
    fromTable: changesSorted,
    initialState: { type: "expression" as const, sql: "'{}'::jsonb" },
    reducer: mapper(getLedgerAlgoReducerSql()),
  });

  const _allItemQuantitiesTables = [
    changesSorted,
    itemQuantities,
  ] as const;

  return { itemQuantities, _allItemQuantitiesTables };
}

export type ItemQuantitiesTables = ReturnType<typeof createItemQuantitiesTable>;
