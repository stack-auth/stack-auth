import { declareConcatTable, declareFilterTable, declareFlatMapTable, declareGroupByTable, declareLeftJoinTable, declareLFoldTable, declareLimitTable, declareMapTable, declareSortTable, declareStoredTable } from "./index";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });
const predicate = (sql: string) => ({ type: "predicate" as const, sql });

/**
 * Example fungible-asset ledger schema composed from Bulldozer table operators.
 *
 * This file intentionally declares tables only; it does not call init/delete.
 */
export const exampleFungibleLedgerSchema = (() => {
  // Base append/update table for raw ledger entries.
  const ledgerEntries = declareStoredTable<{
    accountId: string,
    asset: string,
    amount: string,
    side: "credit" | "debit",
    txHash: string,
    blockNumber: number,
    timestamp: string,
    counterparty: string | null,
    memo: string | null,
  }>({
    tableId: "bulldozer-example-ledger-entries",
  });

  // Group the ledger by account.
  const entriesByAccount = declareGroupByTable({
    tableId: "bulldozer-example-ledger-entries-by-account",
    fromTable: ledgerEntries,
    groupBy: mapper(`"rowData"->'accountId' AS "groupKey"`),
  });

  // Group the ledger by asset symbol.
  const entriesByAsset = declareGroupByTable({
    tableId: "bulldozer-example-ledger-entries-by-asset",
    fromTable: ledgerEntries,
    groupBy: mapper(`"rowData"->'asset' AS "groupKey"`),
  });

  // Enrich account-grouped rows with normalized direction and numeric amount.
  const accountEntriesNormalized = declareMapTable({
    tableId: "bulldozer-example-ledger-account-entries-normalized",
    fromTable: entriesByAccount,
    mapper: mapper(`
      ("rowData"->'accountId') AS "accountId",
      ("rowData"->'asset') AS "asset",
      ("rowData"->'side') AS "side",
      (("rowData"->>'amount')::numeric) AS "amountNumeric",
      CASE
        WHEN "rowData"->>'side' = 'credit' THEN 'inflow'
        ELSE 'outflow'
      END AS "flowDirection",
      ("rowData"->'txHash') AS "txHash",
      ("rowData"->'timestamp') AS "timestamp"
    `),
  });

  // Fan out each ledger entry into two directional legs for downstream views.
  const accountEntryLegs = declareFlatMapTable({
    tableId: "bulldozer-example-ledger-account-entry-legs",
    fromTable: entriesByAccount,
    mapper: mapper(`
      jsonb_build_array(
        jsonb_build_object(
          'accountId', "rowData"->'accountId',
          'asset', "rowData"->'asset',
          'legType', 'entry',
          'signedAmount',
            CASE
              WHEN "rowData"->>'side' = 'credit' THEN (("rowData"->>'amount')::numeric)
              ELSE -(("rowData"->>'amount')::numeric)
            END,
          'txHash', "rowData"->'txHash'
        ),
        jsonb_build_object(
          'accountId', "rowData"->'accountId',
          'asset', "rowData"->'asset',
          'legType', 'counterparty',
          'signedAmount',
            CASE
              WHEN "rowData"->>'side' = 'credit' THEN -(("rowData"->>'amount')::numeric)
              ELSE (("rowData"->>'amount')::numeric)
            END,
          'txHash', "rowData"->'txHash'
        )
      ) AS "rows"
    `),
  });

  // Build an account+asset partition from normalized entries.
  const accountAssetPartitions = declareGroupByTable({
    tableId: "bulldozer-example-ledger-account-asset-partitions",
    fromTable: accountEntriesNormalized,
    groupBy: mapper(`
      jsonb_build_object(
        'accountId', "rowData"->'accountId',
        'asset', "rowData"->'asset'
      ) AS "groupKey"
    `),
  });

  // Keep only entries with a non-null counterparty for suspicious-flow style inspections.
  const accountEntriesWithCounterparty = declareFilterTable({
    tableId: "bulldozer-example-ledger-account-entries-with-counterparty",
    fromTable: entriesByAccount,
    filter: predicate(`("rowData"->>'counterparty') IS NOT NULL`),
  });
  const accountEntriesSortedByAmount = declareSortTable({
    tableId: "bulldozer-example-ledger-account-entries-sorted-by-amount",
    fromTable: entriesByAccount,
    getSortKey: mapper(`(("rowData"->>'amount')::numeric) AS "newSortKey"`),
    compareSortKeys: (a, b) => ({ type: "expression", sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int` }),
  });
  // Keep a small account-local sample used as reference counterparties for joins.
  const accountCounterpartySample = declareLimitTable({
    tableId: "bulldozer-example-ledger-account-counterparty-sample",
    fromTable: accountEntriesWithCounterparty,
    limit: { type: "expression", sql: "3" },
  });
  // For each counterparty row, join to sampled peer rows (same counterparty+asset)
  // while excluding the exact same source row. This demonstrates a practical
  // left-join pattern for reference matching/anomaly-style lookups.
  const accountCounterpartyJoinedSample = declareLeftJoinTable({
    tableId: "bulldozer-example-ledger-account-counterparty-joined-sample",
    leftTable: accountEntriesWithCounterparty,
    rightTable: accountCounterpartySample,
    on: predicate(`
      "leftRowIdentifier" IS DISTINCT FROM "rightRowIdentifier"
      AND ("leftRowData"->'counterparty') IS NOT DISTINCT FROM ("rightRowData"->'counterparty')
      AND ("leftRowData"->'asset') IS NOT DISTINCT FROM ("rightRowData"->'asset')
    `),
  });
  const accountEntriesRunningExposure = declareLFoldTable({
    tableId: "bulldozer-example-ledger-account-entries-running-exposure",
    fromTable: accountEntriesSortedByAmount,
    initialState: { type: "expression", sql: "'0'::jsonb" },
    reducer: mapper(`
      (
        COALESCE(("oldState"#>>'{}')::numeric, 0)
        + (
          CASE
            WHEN "oldRowData"->>'side' = 'credit' THEN (("oldRowData"->>'amount')::numeric)
            ELSE -(("oldRowData"->>'amount')::numeric)
          END
        )
      ) AS "newState",
      jsonb_build_array(
        jsonb_build_object(
          'accountId', "oldRowData"->'accountId',
          'asset', "oldRowData"->'asset',
          'txHash', "oldRowData"->'txHash',
          'delta',
            CASE
              WHEN "oldRowData"->>'side' = 'credit' THEN (("oldRowData"->>'amount')::numeric)
              ELSE -(("oldRowData"->>'amount')::numeric)
            END,
          'runningExposure',
            (
              COALESCE(("oldState"#>>'{}')::numeric, 0)
              + (
                CASE
                  WHEN "oldRowData"->>'side' = 'credit' THEN (("oldRowData"->>'amount')::numeric)
                  ELSE -(("oldRowData"->>'amount')::numeric)
                END
              )
            )
        )
      ) AS "newRowsData"
    `),
  });

  // Keep only large-value entries to model risk/alerting-style subsets.
  const highValueEntriesByAsset = declareFilterTable({
    tableId: "bulldozer-example-ledger-high-value-entries-by-asset",
    fromTable: entriesByAsset,
    filter: predicate(`(("rowData"->>'amount')::numeric) >= 1000`),
  });

  // Partition high-value entries by account for analyst-friendly slices.
  const highValueEntriesByAssetAccount = declareGroupByTable({
    tableId: "bulldozer-example-ledger-high-value-entries-by-asset-account",
    fromTable: highValueEntriesByAsset,
    groupBy: mapper(`"rowData"->'accountId' AS "groupKey"`),
  });
  const accountPriorityEntries = declareConcatTable({
    tableId: "bulldozer-example-ledger-account-priority-entries",
    tables: [accountEntriesWithCounterparty, highValueEntriesByAssetAccount],
  });
  const highValueEntriesByAssetAccountTop = declareLimitTable({
    tableId: "bulldozer-example-ledger-high-value-entries-by-asset-account-top",
    fromTable: highValueEntriesByAssetAccount,
    limit: { type: "expression", sql: "3" },
  });

  // Enrich asset-grouped rows for downstream analytics views.
  const assetEntriesNormalized = declareMapTable({
    tableId: "bulldozer-example-ledger-asset-entries-normalized",
    fromTable: entriesByAsset,
    mapper: mapper(`
      ("rowData"->'asset') AS "asset",
      ("rowData"->'accountId') AS "accountId",
      (("rowData"->>'amount')::numeric) AS "amountNumeric",
      CASE
        WHEN "rowData"->>'side' = 'credit' THEN 1
        ELSE -1
      END AS "signedDirection",
      ("rowData"->'blockNumber') AS "blockNumber",
      ("rowData"->'txHash') AS "txHash"
    `),
  });

  return {
    ledgerEntries,
    entriesByAccount,
    entriesByAsset,
    accountEntriesNormalized,
    accountEntryLegs,
    accountAssetPartitions,
    accountEntriesWithCounterparty,
    accountEntriesSortedByAmount,
    accountCounterpartySample,
    accountCounterpartyJoinedSample,
    accountEntriesRunningExposure,
    highValueEntriesByAsset,
    highValueEntriesByAssetAccount,
    accountPriorityEntries,
    highValueEntriesByAssetAccountTop,
    assetEntriesNormalized,
  };
})();
