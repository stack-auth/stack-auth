/**
 * Phase 2: CompactedTransactionEntries table.
 *
 * FlatMaps transactions into individual entries (with parent txn metadata),
 * splits item-quantity-change entries into compactable vs non-compactable,
 * runs compaction on the compactable ones, and concats everything into
 * the final CompactedTxnEntries table.
 *
 * Compactability: an item-quantity-change entry is compactable if
 * expiresWhen is null (it never expires, so no item-quantity-expire
 * will ever reference it).
 *
 * Trade-off: compaction loses granular historical state within windows.
 * If ic1(t=1,+10) and ic2(t=2,+5) compact to c_ic(t=1,+15), querying
 * at t=1 returns +15 instead of the correct +10. This is acceptable if:
 *   (a) getItemQuantity at current time is always correct (it is, since
 *       window totals are preserved), and
 *   (b) transactions are never backdated (effectiveAtMillis <= now), so
 *       all entries in a window exist by the time anyone queries.
 * Point-in-time historical queries within a compaction window are inaccurate.
 */

import {
  declareCompactTable,
  declareConcatTable,
  declareFlatMapTable,
  declareFilterTable,
  declareMapTable,
  declareSortTable,
} from "@/lib/bulldozer/db/index";
import type { TransactionsTables } from "../phase-1/transactions";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });
const predicate = (sql: string) => ({ type: "predicate" as const, sql });

const numericSortKeyComparator = (a: { sql: string }, b: { sql: string }) => ({
  type: "expression" as const,
  sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int`,
});


export function createCompactedTransactionEntries(txnTables: TransactionsTables) {

  // ── FlatMap: Transactions → individual TransactionEntryRows ──
  // Each entry gets parent txn metadata (txnId, timestamps, type, tenancyId, paymentProvider)
  // and its positional index in the entries array.
  const transactionEntries = declareFlatMapTable({
    tableId: "payments-transaction-entries",
    fromTable: txnTables.transactions,
    mapper: mapper(`
      (
        SELECT COALESCE(jsonb_agg(
          "entry"."value"
          || jsonb_build_object(
            'index', to_jsonb("entry"."ordinality" - 1),
            'txnId', "rowData"->'txnId',
            'txnEffectiveAtMillis', "rowData"->'effectiveAtMillis',
            'txnCreatedAtMillis', "rowData"->'createdAtMillis',
            'txnType', "rowData"->'type',
            'tenancyId', "rowData"->'tenancyId',
            'paymentProvider', "rowData"->'paymentProvider'
          )
        ), '[]'::jsonb)
        FROM jsonb_array_elements("rowData"->'entries') WITH ORDINALITY AS "entry"
      ) AS "rows"
    `),
  });

  // GK = (tenancyId, customerType, customerId) inherited from the
  // grouped Transactions table via the FlatMap.

  // ── Filter by entry type ──────────────────────────────

  const activeSubscriptionChangeEntries = declareFilterTable({
    tableId: "payments-entries-active-subscription-change",
    fromTable: transactionEntries,
    filter: predicate(`"rowData"->>'type' = 'active-subscription-change'`),
  });

  const activeSubscriptionEndEntries = declareFilterTable({
    tableId: "payments-entries-active-subscription-end",
    fromTable: transactionEntries,
    filter: predicate(`"rowData"->>'type' = 'active-subscription-end'`),
  });

  const activeSubscriptionStartEntries = declareFilterTable({
    tableId: "payments-entries-active-subscription-start",
    fromTable: transactionEntries,
    filter: predicate(`"rowData"->>'type' = 'active-subscription-start'`),
  });

  const moneyTransferEntries = declareFilterTable({
    tableId: "payments-entries-money-transfer",
    fromTable: transactionEntries,
    filter: predicate(`"rowData"->>'type' = 'money-transfer'`),
  });

  const productGrantEntries = declareFilterTable({
    tableId: "payments-entries-product-grant",
    fromTable: transactionEntries,
    filter: predicate(`"rowData"->>'type' = 'product-grant'`),
  });

  const productRevocationEntries = declareFilterTable({
    tableId: "payments-entries-product-revocation",
    fromTable: transactionEntries,
    filter: predicate(`"rowData"->>'type' = 'product-revocation'`),
  });

  const itemQuantityExpireEntries = declareFilterTable({
    tableId: "payments-entries-item-quantity-expire",
    fromTable: transactionEntries,
    filter: predicate(`"rowData"->>'type' = 'item-quantity-expire'`),
  });

  const allItemQuantityChangeEntries = declareFilterTable({
    tableId: "payments-entries-item-quantity-change-all",
    fromTable: transactionEntries,
    filter: predicate(`"rowData"->>'type' = 'item-quantity-change'`),
  });


  // ── Compaction pipeline ───────────────────────────────
  // Split item-quantity-change into compactable (expiresWhen is null) vs non-compactable.

  const compactableEntries = declareFilterTable({
    tableId: "payments-entries-item-quantity-change-compactable",
    fromTable: allItemQuantityChangeEntries,
    filter: predicate(`
      "rowData"->'expiresWhen' IS NULL
      OR "rowData"->'expiresWhen' = 'null'::jsonb
    `),
  });

  const nonCompactableEntries = declareFilterTable({
    tableId: "payments-entries-item-quantity-change-non-compactable",
    fromTable: allItemQuantityChangeEntries,
    filter: predicate(`
      "rowData"->'expiresWhen' IS NOT NULL
      AND "rowData"->'expiresWhen' != 'null'::jsonb
    `),
  });

  // Sort both inputs ascending by txnEffectiveAtMillis (required by CompactTable).
  const compactableSorted = declareSortTable({
    tableId: "payments-entries-compactable-sorted",
    fromTable: compactableEntries,
    getSortKey: mapper(`("rowData"->'txnEffectiveAtMillis') AS "newSortKey"`),
    compareSortKeys: numericSortKeyComparator,
  });

  const expiresSorted = declareSortTable({
    tableId: "payments-entries-expires-sorted-for-compaction",
    fromTable: itemQuantityExpireEntries,
    getSortKey: mapper(`("rowData"->'txnEffectiveAtMillis') AS "newSortKey"`),
    compareSortKeys: numericSortKeyComparator,
  });

  // Compact: merge consecutive compactable entries between expire boundaries,
  // partitioned by itemId. Cross-customer merging is prevented by the
  // per-customer grouping (GK = customer) inherited from transactionEntriesByCustomer.
  // Both inputs must be sorted ascending by txnEffectiveAtMillis (ensured above).
  const compactedRaw = declareCompactTable({
    tableId: "payments-entries-compacted-raw",
    toBeCompactedTable: compactableSorted,
    boundaryTable: expiresSorted,
    orderingKey: "txnEffectiveAtMillis",
    compactKey: "quantity",
    partitionKey: "itemId",
  });

  // Remap type from "item-quantity-change" to "compacted-item-quantity-change"
  // so Phase 3 can distinguish compacted entries from non-compacted ones.
  const compactedItemQuantityChangeEntries = declareMapTable({
    tableId: "payments-entries-compacted-item-quantity-change",
    fromTable: compactedRaw,
    mapper: mapper(`
      '"compacted-item-quantity-change"'::jsonb AS "type",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'itemId' AS "itemId",
      "rowData"->'quantity' AS "quantity",
      "rowData"->'expiresWhen' AS "expiresWhen",
      "rowData"->'index' AS "index",
      "rowData"->'txnId' AS "txnId",
      "rowData"->'txnEffectiveAtMillis' AS "txnEffectiveAtMillis",
      "rowData"->'txnCreatedAtMillis' AS "txnCreatedAtMillis",
      "rowData"->'txnType' AS "txnType",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'paymentProvider' AS "paymentProvider"
    `),
  });


  // ── Final CompactedTxnEntries (ConcatTable) ───────────
  // All passthrough entry types + expire entries + compacted + non-compactable.
  // Boundary (expire) entries are NOT output by CompactTable; they come
  // from the original itemQuantityExpireEntries filter.
  const compactedTransactionEntries = declareConcatTable({
    tableId: "payments-compacted-transaction-entries",
    tables: [
      activeSubscriptionChangeEntries,
      activeSubscriptionEndEntries,
      activeSubscriptionStartEntries,
      moneyTransferEntries,
      productGrantEntries,
      productRevocationEntries,
      itemQuantityExpireEntries,
      compactedItemQuantityChangeEntries,
      nonCompactableEntries,
    ],
  });

  /** All tables in dependency order */
  const _allCompactedTransactionEntriesTables = [
    transactionEntries,
    activeSubscriptionChangeEntries,
    activeSubscriptionEndEntries,
    activeSubscriptionStartEntries,
    moneyTransferEntries,
    productGrantEntries,
    productRevocationEntries,
    itemQuantityExpireEntries,
    allItemQuantityChangeEntries,
    compactableEntries,
    nonCompactableEntries,
    compactableSorted,
    expiresSorted,
    compactedRaw,
    compactedItemQuantityChangeEntries,
    compactedTransactionEntries,
  ] as const;

  return {
    transactionEntries,
    compactedTransactionEntries,
    productGrantEntries,
    productRevocationEntries,
    itemQuantityExpireEntries,
    allItemQuantityChangeEntries,
    _allCompactedTransactionEntriesTables,
  };
}

export type CompactedTransactionEntriesTables = ReturnType<typeof createCompactedTransactionEntries>;
