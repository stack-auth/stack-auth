import { declareGroupByTable, declareMapTable, declareStoredTable } from "./index";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });

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
    accountAssetPartitions,
    assetEntriesNormalized,
  };
})();
