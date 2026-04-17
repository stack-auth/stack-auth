/**
 * Phase 3: OwnedProducts table.
 *
 * Filters compacted entries for product-grant and product-revocation,
 * groups by customer, sorts by effective time, and folds to accumulate
 * product ownership deltas.
 *
 * Each output row represents the owned-products state after a particular
 * transaction. Query the latest row with effectiveAtMillis <= currentTime
 * to get the customer's current owned products.
 *
 * NOTE: The ownedProducts map is keyed by productId. Inline products
 * (null productId) use the sentinel key '__null__' because JSON object
 * keys must be strings. Any code reading from this map must use '__null__'
 * (not JS null) when looking up inline products.
 */

import {
  declareFilterTable,
  declareLFoldTable,
  declareSortTable,
} from "@/lib/bulldozer/db/index";
import type { CompactedTransactionEntriesTables } from "../phase-2/compacted-transaction-entries";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });
const predicate = (sql: string) => ({ type: "predicate" as const, sql });


export function createOwnedProductsTable(entryTables: CompactedTransactionEntriesTables) {

  // Filter for product-grant and product-revocation entries
  const productEntries = declareFilterTable({
    tableId: "payments-product-entries",
    fromTable: entryTables.compactedTransactionEntries,
    filter: predicate(`
      "rowData"->>'type' = 'product-grant'
      OR "rowData"->>'type' = 'product-revocation'
    `),
  });

  // Sort by effectiveAtMillis within each customer group.
  // GK = (tenancyId, customerType, customerId) inherited from phase 2.
  const productEntriesSorted = declareSortTable({
    tableId: "payments-product-entries-sorted",
    fromTable: productEntries,
    getSortKey: mapper(`
      ("rowData"->'txnEffectiveAtMillis') AS "newSortKey"
    `),
    compareSortKeys: (a, b) => ({
      type: "expression",
      sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int`,
    }),
  });

  // LFold: accumulate product ownership deltas
  // State: JSONB object mapping productId → { quantity, product, productLineId }
  // On product-grant: add quantity (positive delta)
  // On product-revocation: subtract quantity (cap at 0)
  const ownedProducts = declareLFoldTable({
    tableId: "payments-owned-products",
    fromTable: productEntriesSorted,
    initialState: { type: "expression" as const, sql: "'{}'::jsonb" },
    reducer: mapper(`
      (
        CASE
          WHEN "oldRowData"->>'type' = 'product-grant' THEN
            "oldState" || jsonb_build_object(
              COALESCE("oldRowData"->>'productId', '__null__'),
              jsonb_build_object(
                'quantity', to_jsonb(GREATEST(
                  COALESCE(("oldState"->COALESCE("oldRowData"->>'productId', '__null__')->>'quantity')::numeric, 0)
                  + COALESCE(("oldRowData"->>'quantity')::numeric, 0),
                  0
                )),
                'product', "oldRowData"->'product',
                'productLineId', "oldRowData"->'productLineId'
              )
            )
          WHEN "oldRowData"->>'type' = 'product-revocation' THEN
            "oldState" || jsonb_build_object(
              COALESCE("oldRowData"->>'productId', '__null__'),
              jsonb_build_object(
                'quantity', to_jsonb(GREATEST(
                  COALESCE(("oldState"->COALESCE("oldRowData"->>'productId', '__null__')->>'quantity')::numeric, 0)
                  - COALESCE(("oldRowData"->>'quantity')::numeric, 0),
                  0
                )),
                'product', COALESCE(
                  "oldState"->COALESCE("oldRowData"->>'productId', '__null__')->'product',
                  'null'::jsonb
                ),
                'productLineId', COALESCE(
                  "oldState"->COALESCE("oldRowData"->>'productId', '__null__')->'productLineId',
                  'null'::jsonb
                )
              )
            )
          ELSE "oldState"
        END
      ) AS "newState",
      jsonb_build_array(
        jsonb_build_object(
          'txnEffectiveAtMillis', "oldRowData"->'txnEffectiveAtMillis',
          'txnId', "oldRowData"->'txnId',
          'ownedProducts',
            CASE
              WHEN "oldRowData"->>'type' = 'product-grant' THEN
                "oldState" || jsonb_build_object(
                  COALESCE("oldRowData"->>'productId', '__null__'),
                  jsonb_build_object(
                    'quantity', to_jsonb(GREATEST(
                      COALESCE(("oldState"->COALESCE("oldRowData"->>'productId', '__null__')->>'quantity')::numeric, 0)
                      + COALESCE(("oldRowData"->>'quantity')::numeric, 0),
                      0
                    )),
                    'product', "oldRowData"->'product',
                    'productLineId', "oldRowData"->'productLineId'
                  )
                )
              WHEN "oldRowData"->>'type' = 'product-revocation' THEN
                "oldState" || jsonb_build_object(
                  COALESCE("oldRowData"->>'productId', '__null__'),
                  jsonb_build_object(
                    'quantity', to_jsonb(GREATEST(
                      COALESCE(("oldState"->COALESCE("oldRowData"->>'productId', '__null__')->>'quantity')::numeric, 0)
                      - COALESCE(("oldRowData"->>'quantity')::numeric, 0),
                      0
                    )),
                    'product', COALESCE(
                      "oldState"->COALESCE("oldRowData"->>'productId', '__null__')->'product',
                      'null'::jsonb
                    ),
                    'productLineId', COALESCE(
                      "oldState"->COALESCE("oldRowData"->>'productId', '__null__')->'productLineId',
                      'null'::jsonb
                    )
                  )
                )
              ELSE "oldState"
            END,
          'customerType', "oldRowData"->'customerType',
          'customerId', "oldRowData"->'customerId',
          'tenancyId', "oldRowData"->'tenancyId'
        )
      ) AS "newRowsData"
    `),
  });

  const _allOwnedProductsTables = [
    productEntries,
    productEntriesSorted,
    ownedProducts,
  ] as const;

  return { ownedProducts, _allOwnedProductsTables };
}

export type OwnedProductsTables = ReturnType<typeof createOwnedProductsTable>;
