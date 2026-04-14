/**
 * Phase 3: Item changes with expiries table.
 *
 * Enriches item-quantity-change entries with their corresponding
 * item-quantity-expire entries, then splits multi-expiry changes
 * into individual (subQuantity, singleExpiry) pairs for the ledger algorithm.
 *
 * Pipeline:
 *   1. Filter for item-quantity-expire → GroupBy(adjustedTxnId, adjustedEntryIndex)
 *      → Sort(asc) → ReduceTable(accumulate expiry array + embed groupKey)
 *      = one ungrouped row per (adjustedTxnId, adjustedEntryIndex)
 *   2. Filter for item-quantity-change → LeftJoin with expiry lists (both ungrouped)
 *   3. Filter for compacted-item-quantity-change → add empty expiries
 *   4. FlatMap to split into (subQuantity, singleExpiry) pairs
 */

import {
  declareConcatTable,
  declareFilterTable,
  declareFlatMapTable,
  declareGroupByTable,
  declareLeftJoinTable,
  declareMapTable,
  declareReduceTable,
  declareSortTable,
} from "@/lib/bulldozer/db/index";
import type { CompactedTransactionEntriesTables } from "../phase-2/compacted-transaction-entries";
import { getSplitAlgoCteSql } from "./split-algo";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });
const predicate = (sql: string) => ({ type: "predicate" as const, sql });

const numericAsc = (a: { sql: string }, b: { sql: string }) => ({
  type: "expression" as const,
  sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int`,
});


export function createItemChangesWithExpiries(entryTables: CompactedTransactionEntriesTables) {

  // ── Step 1: One row per (adjustedTxnId, adjustedEntryIndex) with full expiries array ──

  const expireEntries = declareFilterTable({
    tableId: "payments-phase3-expire-entries",
    fromTable: entryTables.compactedTransactionEntries,
    filter: predicate(`"rowData"->>'type' = 'item-quantity-expire'`),
  });

  const expireEntriesByTarget = declareGroupByTable({
    tableId: "payments-expire-entries-by-target",
    fromTable: expireEntries,
    groupBy: mapper(`
      jsonb_build_object(
        'tenancyId', "rowData"->'tenancyId',
        'customerType', "rowData"->'customerType',
        'customerId', "rowData"->'customerId',
        'adjustedTransactionId', "rowData"->'adjustedTransactionId',
        'adjustedEntryIndex', "rowData"->'adjustedEntryIndex'
      ) AS "groupKey"
    `),
  });

  const expireEntriesSorted = declareSortTable({
    tableId: "payments-expire-entries-sorted",
    fromTable: expireEntriesByTarget,
    getSortKey: mapper(`("rowData"->'txnEffectiveAtMillis') AS "newSortKey"`),
    compareSortKeys: numericAsc,
  });

  // ReduceTable: fold all expiries per (adjustedTxnId, adjustedEntryIndex) into one
  // ungrouped row with the complete expiries array. Finalize embeds the groupKey
  // fields so downstream LeftJoin can match on them.
  const expiriesByChangeEntry = declareReduceTable({
    tableId: "payments-expiries-by-change-entry",
    fromTable: expireEntriesSorted,
    initialState: { type: "expression" as const, sql: "'[]'::jsonb" },
    reducer: mapper(`
      ("oldState" || jsonb_build_array(
        jsonb_build_object(
          'txnEffectiveAtMillis', "oldRowData"->'txnEffectiveAtMillis',
          'quantityExpiring', "oldRowData"->'quantity'
        )
      )) AS "newState"
    `),
    finalize: mapper(`
      "groupKey"->'tenancyId' AS "tenancyId",
      "groupKey"->'customerType' AS "customerType",
      "groupKey"->'customerId' AS "customerId",
      "groupKey"->'adjustedTransactionId' AS "adjustedTransactionId",
      "groupKey"->'adjustedEntryIndex' AS "adjustedEntryIndex",
      "state" AS "expiries"
    `),
  });


  // Re-group back to customer level so the LeftJoin can match with
  // non-compacted changes (both sides GK = customer).
  const expiriesByCustomer = declareGroupByTable({
    tableId: "payments-expiries-by-customer",
    fromTable: expiriesByChangeEntry,
    groupBy: mapper(`
      jsonb_build_object(
        'tenancyId', "rowData"->'tenancyId',
        'customerType', "rowData"->'customerType',
        'customerId', "rowData"->'customerId'
      ) AS "groupKey"
    `),
  });


  // ── Step 2: LeftJoin item-quantity-change with expiry lists ──
  // Both sides are GK = (tenancyId, customerType, customerId).

  const nonCompactedChanges = declareFilterTable({
    tableId: "payments-phase3-non-compacted-changes",
    fromTable: entryTables.compactedTransactionEntries,
    filter: predicate(`"rowData"->>'type' = 'item-quantity-change'`),
  });

  const changesWithExpiries = declareLeftJoinTable({
    tableId: "payments-changes-with-expiries",
    leftTable: nonCompactedChanges,
    rightTable: expiriesByCustomer,
    leftJoinKey: mapper(`
      jsonb_build_object(
        'txnId', "rowData"->'txnId',
        'entryIndex', "rowData"->'index'
      ) AS "joinKey"
    `),
    rightJoinKey: mapper(`
      jsonb_build_object(
        'txnId', "rowData"->'adjustedTransactionId',
        'entryIndex', "rowData"->'adjustedEntryIndex'
      ) AS "joinKey"
    `),
  });

  const changesWithExpiryArrays = declareMapTable({
    tableId: "payments-changes-with-expiry-arrays",
    fromTable: changesWithExpiries,
    mapper: mapper(`
      -- Some item-quantity-change rows carry absolute expiry directly in expiresWhen
      -- (for example manual item quantity changes). Convert numeric expiresWhen into
      -- an expiry array so split logic can handle them uniformly.
      "rowData"->'leftRowData'->'txnId' AS "txnId",
      "rowData"->'leftRowData'->'txnEffectiveAtMillis' AS "txnEffectiveAtMillis",
      "rowData"->'leftRowData'->'customerType' AS "customerType",
      "rowData"->'leftRowData'->'customerId' AS "customerId",
      "rowData"->'leftRowData'->'tenancyId' AS "tenancyId",
      "rowData"->'leftRowData'->'itemId' AS "itemId",
      "rowData"->'leftRowData'->'quantity' AS "quantity",
      (
        COALESCE("rowData"->'rightRowData'->'expiries', '[]'::jsonb)
        || CASE
          WHEN jsonb_typeof("rowData"->'leftRowData'->'expiresWhen') = 'number' THEN jsonb_build_array(
            jsonb_build_object(
              'txnEffectiveAtMillis', "rowData"->'leftRowData'->'expiresWhen',
              'quantityExpiring', "rowData"->'leftRowData'->'quantity'
            )
          )
          ELSE '[]'::jsonb
        END
      ) AS "expiries"
    `),
  });


  // ── Step 3: Compacted changes get empty expiries ──

  const compactedChanges = declareFilterTable({
    tableId: "payments-phase3-compacted-changes",
    fromTable: entryTables.compactedTransactionEntries,
    filter: predicate(`"rowData"->>'type' = 'compacted-item-quantity-change'`),
  });

  const compactedChangesWithNullExpiries = declareMapTable({
    tableId: "payments-compacted-changes-with-null-expiries",
    fromTable: compactedChanges,
    mapper: mapper(`
      "rowData"->'txnId' AS "txnId",
      "rowData"->'txnEffectiveAtMillis' AS "txnEffectiveAtMillis",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'itemId' AS "itemId",
      "rowData"->'quantity' AS "quantity",
      '[]'::jsonb AS "expiries"
    `),
  });


  // ── Step 4: FlatMap to split multi-expiry changes into single-expiry pairs ──

  const allChangesUnified = declareConcatTable({
    tableId: "payments-all-changes-with-expiries",
    tables: [changesWithExpiryArrays, compactedChangesWithNullExpiries],
  });

  // FlatMap: for grants (qty >= 0), split by expiry buckets via recursive CTE
  // and emit expiry marker rows. For removals (qty < 0), pass through as a
  // single row with expiresAtMillis = null (removals are permanent).
  const splitChanges = declareFlatMapTable({
    tableId: "payments-split-item-changes-with-expiry",
    fromTable: allChangesUnified,
    mapper: mapper(`
      CASE WHEN ("rowData"->>'quantity')::numeric < 0 THEN
        jsonb_build_array(
          jsonb_build_object(
            'txnId', "rowData"->'txnId',
            'txnEffectiveAtMillis', "rowData"->'txnEffectiveAtMillis',
            'customerType', "rowData"->'customerType',
            'customerId', "rowData"->'customerId',
            'tenancyId', "rowData"->'tenancyId',
            'itemId', "rowData"->'itemId',
            'quantity', "rowData"->'quantity',
            'expiresAtMillis', 'null'::jsonb
          )
        )
      ELSE (
        WITH RECURSIVE
        ${getSplitAlgoCteSql()}
        SELECT (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'txnId', "rowData"->'txnId',
              'txnEffectiveAtMillis', "rowData"->'txnEffectiveAtMillis',
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'tenancyId', "rowData"->'tenancyId',
              'itemId', "rowData"->'itemId',
              'quantity', to_jsonb("w"."quantityExpiring"),
              'expiresAtMillis', "w"."expiresAtMillis"
            )
            ORDER BY "w"."idx"
          ), '[]'::jsonb)
          FROM "walked" AS "w"
          WHERE "w"."expiresAtMillis" IS NOT NULL
            AND "w"."expiresAtMillis" != 'null'::jsonb
            AND (("w"."expiresAtMillis" #>> '{}')::numeric > (("rowData"->'txnEffectiveAtMillis' #>> '{}')::numeric))
        )
        || jsonb_build_array(
          jsonb_build_object(
            'txnId', "rowData"->'txnId',
            'txnEffectiveAtMillis', "rowData"->'txnEffectiveAtMillis',
            'customerType', "rowData"->'customerType',
            'customerId', "rowData"->'customerId',
            'tenancyId', "rowData"->'tenancyId',
            'itemId', "rowData"->'itemId',
            'quantity', to_jsonb(COALESCE(
              (SELECT "w"."remaining" FROM "walked" AS "w" ORDER BY "w"."idx" DESC LIMIT 1),
              ("rowData"->>'quantity')::numeric
            )),
            'expiresAtMillis', 'null'::jsonb
          )
        )
        || (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'txnId', "rowData"->'txnId',
              'txnEffectiveAtMillis', "w"."expiresAtMillis",
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'tenancyId', "rowData"->'tenancyId',
              'itemId', "rowData"->'itemId',
              'quantity', to_jsonb(0),
              'expiresAtMillis', 'null'::jsonb
            )
          ), '[]'::jsonb)
          FROM "walked" AS "w"
          WHERE "w"."expiresAtMillis" IS NOT NULL
            AND "w"."expiresAtMillis" != 'null'::jsonb
            AND (("w"."expiresAtMillis" #>> '{}')::numeric > (("rowData"->'txnEffectiveAtMillis' #>> '{}')::numeric))
        )
      )
      END AS "rows"
    `),
  });

  const _allItemChangesWithExpiriesTables = [
    expireEntries,
    expireEntriesByTarget,
    expireEntriesSorted,
    expiriesByChangeEntry,
    expiriesByCustomer,
    nonCompactedChanges,
    changesWithExpiries,
    changesWithExpiryArrays,
    compactedChanges,
    compactedChangesWithNullExpiries,
    allChangesUnified,
    splitChanges,
  ] as const;

  return { splitChanges, _allItemChangesWithExpiriesTables };
}

export type ItemChangesWithExpiriesTables = ReturnType<typeof createItemChangesWithExpiries>;
