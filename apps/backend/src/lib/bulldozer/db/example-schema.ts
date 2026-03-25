import { declareFilterTable, declareFlatMapTable, declareGroupByTable, declareLimitTable, declareMapTable, declareStoredTable } from "./index";

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
    filter: predicate(`("rowData"->'counterparty') IS NOT NULL`),
  });
  const accountCounterpartySample = declareLimitTable({
    tableId: "bulldozer-example-ledger-account-counterparty-sample",
    fromTable: accountEntriesWithCounterparty,
    limit: { type: "expression", sql: "1" },
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
    accountCounterpartySample,
    highValueEntriesByAsset,
    highValueEntriesByAssetAccount,
    highValueEntriesByAssetAccountTop,
    assetEntriesNormalized,
  };
})();
