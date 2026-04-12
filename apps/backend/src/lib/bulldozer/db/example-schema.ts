import { declareCompactTable, declareConcatTable, declareFilterTable, declareFlatMapTable, declareGroupByTable, declareLeftJoinTable, declareLFoldTable, declareLimitTable, declareMapTable, declareReduceTable, declareSortTable, declareStoredTable, declareTimeFoldTable } from "./index";

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
  // For each counterparty row, join to sampled rows by a computed equality key
  // (counterparty + asset). This demonstrates join-key-based reference matching.
  const accountCounterpartyJoinedSample = declareLeftJoinTable({
    tableId: "bulldozer-example-ledger-account-counterparty-joined-sample",
    leftTable: accountEntriesWithCounterparty,
    rightTable: accountCounterpartySample,
    leftJoinKey: mapper(`
      jsonb_build_object(
        'counterparty', "rowData"->'counterparty',
        'asset', "rowData"->'asset'
      ) AS "joinKey"
    `),
    rightJoinKey: mapper(`
      jsonb_build_object(
        'counterparty', "rowData"->'counterparty',
        'asset', "rowData"->'asset'
      ) AS "joinKey"
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
  // Timefold reducers should avoid non-deterministic values (for example now()/random()) for
  // output-driving fields, otherwise replaying from scratch can produce different results.
  // These examples derive next timestamps from stable row timestamps.
  const accountEntriesTimedExposure = declareTimeFoldTable({
    tableId: "bulldozer-example-ledger-account-entries-timed-exposure",
    fromTable: entriesByAccount,
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
          'timedExposure',
            (
              COALESCE(("oldState"#>>'{}')::numeric, 0)
              + (
                CASE
                  WHEN "oldRowData"->>'side' = 'credit' THEN (("oldRowData"->>'amount')::numeric)
                  ELSE -(("oldRowData"->>'amount')::numeric)
                END
              )
            ),
          'tickTimestamp',
            CASE
              WHEN "timestamp" IS NULL THEN 'null'::jsonb
              ELSE to_jsonb("timestamp")
            END
        )
      ) AS "newRowsData",
      CASE
        WHEN "timestamp" IS NULL THEN (("oldRowData"->>'timestamp')::timestamptz + interval '5 minutes')
        ELSE NULL::timestamptz
      END AS "nextTimestamp"
    `),
  });
  // Emit repeated timed checkpoints for each row until a bounded step counter
  // reaches completion. This showcases recurring scheduling behavior.
  const accountEntriesTimedReprice = declareTimeFoldTable({
    tableId: "bulldozer-example-ledger-account-entries-timed-reprice",
    fromTable: entriesByAccount,
    initialState: { type: "expression", sql: "'0'::jsonb" },
    reducer: mapper(`
      CASE
        WHEN "timestamp" IS NULL THEN 1
        WHEN COALESCE(("oldState"#>>'{}')::int, 0) < 3 THEN (COALESCE(("oldState"#>>'{}')::int, 0) + 1)
        ELSE COALESCE(("oldState"#>>'{}')::int, 0)
      END AS "newState",
      jsonb_build_array(
        jsonb_build_object(
          'accountId', "oldRowData"->'accountId',
          'asset', "oldRowData"->'asset',
          'txHash', "oldRowData"->'txHash',
          'amount', (("oldRowData"->>'amount')::numeric),
          'step',
            CASE
              WHEN "timestamp" IS NULL THEN 1
              ELSE COALESCE(("oldState"#>>'{}')::int, 0)
            END,
          'mode',
            CASE
              WHEN "timestamp" IS NULL THEN 'initial'
              WHEN COALESCE(("oldState"#>>'{}')::int, 0) < 3 THEN 'follow-up'
              ELSE 'terminal'
            END,
          'tickTimestamp',
            CASE
              WHEN "timestamp" IS NULL THEN 'null'::jsonb
              ELSE to_jsonb("timestamp")
            END
        )
      ) AS "newRowsData",
      CASE
        WHEN "timestamp" IS NULL THEN (("oldRowData"->>'timestamp')::timestamptz + interval '1 minute')
        WHEN COALESCE(("oldState"#>>'{}')::int, 0) < 3 THEN ("timestamp" + interval '1 minute')
        ELSE NULL::timestamptz
      END AS "nextTimestamp"
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

  // Compact table example: merge consecutive account debit entries between
  // credit entries (boundaries) by summing amounts per asset (partition).
  // Both inputs MUST be pre-sorted ascending by the orderingKey field.
  const accountDebits = declareFilterTable({
    tableId: "bulldozer-example-ledger-account-debits",
    fromTable: entriesByAccount,
    filter: predicate(`"rowData"->>'side' = 'debit'`),
  });
  const accountDebitsSorted = declareSortTable({
    tableId: "bulldozer-example-ledger-account-debits-sorted",
    fromTable: accountDebits,
    getSortKey: mapper(`(("rowData"->>'blockNumber')::numeric) AS "newSortKey"`),
    compareSortKeys: (a, b) => ({ type: "expression", sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int` }),
  });
  const accountCredits = declareFilterTable({
    tableId: "bulldozer-example-ledger-account-credits",
    fromTable: entriesByAccount,
    filter: predicate(`"rowData"->>'side' = 'credit'`),
  });
  const accountCreditsSorted = declareSortTable({
    tableId: "bulldozer-example-ledger-account-credits-sorted",
    fromTable: accountCredits,
    getSortKey: mapper(`(("rowData"->>'blockNumber')::numeric) AS "newSortKey"`),
    compareSortKeys: (a, b) => ({ type: "expression", sql: `(((${a.sql}) #>> '{}')::numeric > ((${b.sql}) #>> '{}')::numeric)::int - (((${a.sql}) #>> '{}')::numeric < ((${b.sql}) #>> '{}')::numeric)::int` }),
  });
  const compactedDebits = declareCompactTable({
    tableId: "bulldozer-example-ledger-compacted-debits",
    toBeCompactedTable: accountDebitsSorted,
    boundaryTable: accountCreditsSorted,
    orderingKey: "blockNumber",
    compactKey: "amount",
    partitionKey: "asset",
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
    accountEntriesTimedExposure,
    accountEntriesTimedReprice,
    highValueEntriesByAsset,
    highValueEntriesByAssetAccount,
    accountPriorityEntries,
    highValueEntriesByAssetAccountTop,
    assetEntriesNormalized,
    accountDebits,
    accountDebitsSorted,
    accountCredits,
    accountCreditsSorted,
    compactedDebits,

    // Reduce table example: collapse each account's entries into a single
    // summary row with total credits and total debits. The grouping by
    // account is consumed -- output is ungrouped.
    accountSummary: declareReduceTable({
      tableId: "bulldozer-example-ledger-account-summary",
      fromTable: entriesByAccount,
      initialState: { type: "expression", sql: "jsonb_build_object('totalCredits', to_jsonb(0::numeric), 'totalDebits', to_jsonb(0::numeric))" },
      reducer: mapper(`
        jsonb_build_object(
          'totalCredits', to_jsonb(
            COALESCE(("oldState"->>'totalCredits')::numeric, 0)
            + CASE WHEN "oldRowData"->>'side' = 'credit' THEN COALESCE(("oldRowData"->>'amount')::numeric, 0) ELSE 0 END
          ),
          'totalDebits', to_jsonb(
            COALESCE(("oldState"->>'totalDebits')::numeric, 0)
            + CASE WHEN "oldRowData"->>'side' = 'debit' THEN COALESCE(("oldRowData"->>'amount')::numeric, 0) ELSE 0 END
          )
        ) AS "newState"
      `),
      finalize: mapper(`
        "groupKey" AS "accountId",
        ("state"->>'totalCredits')::numeric AS "totalCredits",
        ("state"->>'totalDebits')::numeric AS "totalDebits",
        (COALESCE(("state"->>'totalCredits')::numeric, 0) - COALESCE(("state"->>'totalDebits')::numeric, 0)) AS "netBalance"
      `),
    }),
  };
})();
