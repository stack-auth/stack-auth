/**
 * Phase 2: Transactions table.
 *
 * Maps each of the 7 event types to a transaction, filters ManualTransactions
 * for refunds, and concats all 8 sources into one Transactions table.
 *
 * Each mapper builds a complete TransactionRow including the entries array.
 * Entry ordering follows the spec:
 *   subscription-renewal: [money-transfer]
 *   subscription-cancel:  [active-subscription-change]
 *   subscription-end:     [active-subscription-end, product-revocation, ...item-quantity-expire]
 *   subscription-start:   [active-subscription-start, product-grant, money-transfer?, ...item-quantity-change]
 *   item-grant-repeat:    [...item-quantity-expire?, ...item-quantity-change]
 *   one-time-purchase:    [product-grant, money-transfer?, ...item-quantity-change]
 *   manual-item-quantity-change: [item-quantity-change]
 */

import {
  declareConcatTable,
  declareFilterTable,
  declareGroupByTable,
  declareMapTable,
} from "@/lib/bulldozer/db/index";
import type { EventTables } from "./events";
import type { SeedEventsStoredTables } from "./stored-tables";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });
const predicate = (sql: string) => ({ type: "predicate" as const, sql });


export function createTransactionsTable(events: EventTables, manualTransactions: SeedEventsStoredTables['manualTransactions']) {

  // ── subscription-renewal → transaction ─────────────────
  const subscriptionRenewalTxns = declareMapTable({
    tableId: "payments-txn-subscription-renewal",
    fromTable: events.subscriptionRenewalEvents,
    mapper: mapper(`
      to_jsonb('sub-renewal:' || ("rowData"->>'invoiceId')) AS "txnId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'effectiveAtMillis' AS "effectiveAtMillis",
      '"subscription-renewal"'::jsonb AS "type",
      jsonb_build_array(
        jsonb_build_object(
          'type', '"money-transfer"'::jsonb,
          'customerType', "rowData"->'customerType',
          'customerId', "rowData"->'customerId',
          'chargedAmount', "rowData"->'chargedAmount'
        )
      ) AS "entries",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'paymentProvider' AS "paymentProvider",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── subscription-cancel → transaction ──────────────────
  const subscriptionCancelTxns = declareMapTable({
    tableId: "payments-txn-subscription-cancel",
    fromTable: events.subscriptionCancelEvents,
    mapper: mapper(`
      to_jsonb('sub-cancel:' || ("rowData"->>'subscriptionId')) AS "txnId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'effectiveAtMillis' AS "effectiveAtMillis",
      '"subscription-cancel"'::jsonb AS "type",
      jsonb_build_array(
        jsonb_build_object(
          'type', '"active-subscription-change"'::jsonb,
          'customerType', "rowData"->'customerType',
          'customerId', "rowData"->'customerId',
          'subscriptionId', "rowData"->'subscriptionId',
          'changeType', "rowData"->'changeType'
        )
      ) AS "entries",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'paymentProvider' AS "paymentProvider",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── subscription-start → transaction ───────────────────
  const subscriptionStartTxns = declareMapTable({
    tableId: "payments-txn-subscription-start",
    fromTable: events.subscriptionStartEvents,
    mapper: mapper(`
      to_jsonb('sub-start:' || ("rowData"->>'subscriptionId')) AS "txnId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'effectiveAtMillis' AS "effectiveAtMillis",
      '"subscription-start"'::jsonb AS "type",
      (
        jsonb_build_array(
          jsonb_build_object(
            'type', '"active-subscription-start"'::jsonb,
            'customerType', "rowData"->'customerType',
            'customerId', "rowData"->'customerId',
            'subscriptionId', "rowData"->'subscriptionId'
          ),
          jsonb_build_object(
            'type', '"product-grant"'::jsonb,
            'customerType', "rowData"->'customerType',
            'customerId', "rowData"->'customerId',
            'productId', "rowData"->'productId',
            'product', "rowData"->'product',
            'priceId', "rowData"->'priceId',
            'quantity', "rowData"->'quantity',
            'productLineId', "rowData"->'productLineId',
            'subscriptionId', "rowData"->'subscriptionId'
          )
        )
        || CASE
          WHEN "rowData"->>'paymentProvider' != 'test_mode'
            AND "rowData"->'chargedAmount' != '{}'::jsonb
          THEN jsonb_build_array(
            jsonb_build_object(
              'type', '"money-transfer"'::jsonb,
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'chargedAmount', "rowData"->'chargedAmount'
            )
          )
          ELSE '[]'::jsonb
        END
        || (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'type', '"item-quantity-change"'::jsonb,
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'itemId', "grant"->'itemId',
              'quantity', "grant"->'quantity',
              'expiresWhen', "grant"->'expiresWhen'
            )
          ), '[]'::jsonb)
          FROM jsonb_array_elements("rowData"->'itemGrants') AS "grant"
        )
      ) AS "entries",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'paymentProvider' AS "paymentProvider",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── subscription-end → transaction ─────────────────────
  const subscriptionEndTxns = declareMapTable({
    tableId: "payments-txn-subscription-end",
    fromTable: events.subscriptionEndEvents,
    mapper: mapper(`
      to_jsonb('sub-end:' || ("rowData"->>'subscriptionId')) AS "txnId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'effectiveAtMillis' AS "effectiveAtMillis",
      '"subscription-end"'::jsonb AS "type",
      (
        jsonb_build_array(
          jsonb_build_object(
            'type', '"active-subscription-end"'::jsonb,
            'customerType', "rowData"->'customerType',
            'customerId', "rowData"->'customerId',
            'subscriptionId', "rowData"->'subscriptionId'
          ),
          jsonb_build_object(
            'type', '"product-revocation"'::jsonb,
            'customerType', "rowData"->'customerType',
            'customerId', "rowData"->'customerId',
            'adjustedTransactionId', "rowData"->'startProductGrantRef'->'transactionId',
            'adjustedEntryIndex', "rowData"->'startProductGrantRef'->'entryIndex',
            'quantity', "rowData"->'quantity',
            'productId', "rowData"->'productId',
            'productLineId', "rowData"->'productLineId'
          )
        )
        || (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'type', '"item-quantity-expire"'::jsonb,
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'adjustedTransactionId', "entry"->'transactionId',
              'adjustedEntryIndex', "entry"->'entryIndex',
              'quantity', "entry"->'quantity',
              'itemId', "entry"->'itemId'
            )
          ), '[]'::jsonb)
          FROM jsonb_array_elements("rowData"->'itemQuantityChangesToExpire') AS "entry"
        )
      ) AS "entries",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'paymentProvider' AS "paymentProvider",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── item-grant-repeat → transaction ────────────────────
  const itemGrantRepeatTxns = declareMapTable({
    tableId: "payments-txn-item-grant-repeat",
    fromTable: events.itemGrantRepeatEvents,
    mapper: mapper(`
      to_jsonb('igr:' || ("rowData"->>'sourceId') || ':' || ("rowData"->>'effectiveAtMillis')) AS "txnId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'effectiveAtMillis' AS "effectiveAtMillis",
      '"item-grant-repeat"'::jsonb AS "type",
      (
        (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'type', '"item-quantity-expire"'::jsonb,
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'adjustedTransactionId', "entry"->'transactionId',
              'adjustedEntryIndex', "entry"->'entryIndex',
              'quantity', "entry"->'quantity',
              'itemId', "entry"->'itemId'
            )
          ), '[]'::jsonb)
          FROM jsonb_array_elements("rowData"->'previousGrantsToExpire') AS "entry"
        )
        || (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'type', '"item-quantity-change"'::jsonb,
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'itemId', "grant"->'itemId',
              'quantity', "grant"->'quantity',
              'expiresWhen', "grant"->'expiresWhen'
            )
          ), '[]'::jsonb)
          FROM jsonb_array_elements("rowData"->'itemGrants') AS "grant"
        )
      ) AS "entries",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'paymentProvider' AS "paymentProvider",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── one-time-purchase → transaction ────────────────────
  const oneTimePurchaseTxns = declareMapTable({
    tableId: "payments-txn-one-time-purchase",
    fromTable: events.oneTimePurchaseEvents,
    mapper: mapper(`
      to_jsonb('otp:' || ("rowData"->>'purchaseId')) AS "txnId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'effectiveAtMillis' AS "effectiveAtMillis",
      '"one-time-purchase"'::jsonb AS "type",
      (
        jsonb_build_array(
          jsonb_build_object(
            'type', '"product-grant"'::jsonb,
            'customerType', "rowData"->'customerType',
            'customerId', "rowData"->'customerId',
            'productId', "rowData"->'productId',
            'product', "rowData"->'product',
            'priceId', "rowData"->'priceId',
            'quantity', "rowData"->'quantity',
            'productLineId', "rowData"->'productLineId',
            'oneTimePurchaseId', "rowData"->'purchaseId'
          )
        )
        || CASE
          WHEN "rowData"->>'paymentProvider' != 'test_mode'
            AND "rowData"->'chargedAmount' != '{}'::jsonb
          THEN jsonb_build_array(
            jsonb_build_object(
              'type', '"money-transfer"'::jsonb,
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'chargedAmount', "rowData"->'chargedAmount'
            )
          )
          ELSE '[]'::jsonb
        END
        || (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'type', '"item-quantity-change"'::jsonb,
              'customerType', "rowData"->'customerType',
              'customerId', "rowData"->'customerId',
              'itemId', "grant"->'itemId',
              'quantity', "grant"->'quantity',
              'expiresWhen', "grant"->'expiresWhen'
            )
          ), '[]'::jsonb)
          FROM jsonb_array_elements("rowData"->'itemGrants') AS "grant"
        )
      ) AS "entries",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'paymentProvider' AS "paymentProvider",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── manual-item-quantity-change → transaction ──────────
  const manualItemQuantityChangeTxns = declareMapTable({
    tableId: "payments-txn-manual-item-quantity-change",
    fromTable: events.manualItemQuantityChangeEvents,
    mapper: mapper(`
      to_jsonb('miqc:' || ("rowData"->>'changeId')) AS "txnId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'effectiveAtMillis' AS "effectiveAtMillis",
      '"manual-item-quantity-change"'::jsonb AS "type",
      jsonb_build_array(
        jsonb_build_object(
          'type', '"item-quantity-change"'::jsonb,
          'customerType', "rowData"->'customerType',
          'customerId', "rowData"->'customerId',
          'itemId', "rowData"->'itemId',
          'quantity', "rowData"->'quantity',
          'expiresWhen', "rowData"->'expiresAtMillis'
        )
      ) AS "entries",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'customerId' AS "customerId",
      'null'::jsonb AS "paymentProvider",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── ManualTransactions (refunds) → pass-through ────────
  // ManualTransactions rows are already in TransactionRow shape.
  // Filter for refund type; all other manual txn types can be added later.
  const refundTxns = declareFilterTable({
    tableId: "payments-txn-refund",
    fromTable: manualTransactions,
    filter: predicate(`"rowData"->>'type' = 'refund'`),
  });


  // ── Final Transactions table (ConcatTable → GroupBy customer) ────
  const transactionsUngrouped = declareConcatTable({
    tableId: "payments-transactions",
    tables: [
      subscriptionRenewalTxns,
      subscriptionCancelTxns,
      subscriptionStartTxns,
      subscriptionEndTxns,
      itemGrantRepeatTxns,
      oneTimePurchaseTxns,
      manualItemQuantityChangeTxns,
      refundTxns,
    ],
  });

  // Group by customer so all downstream operations (compaction, phase 3
  // LFolds) are per-customer. Also enables direct per-customer queries
  // for getTransactions.
  const transactions = declareGroupByTable({
    tableId: "payments-transactions-by-customer",
    fromTable: transactionsUngrouped,
    groupBy: mapper(`
      jsonb_build_object(
        'tenancyId', "rowData"->'tenancyId',
        'customerType', "rowData"->'customerType',
        'customerId', "rowData"->'customerId'
      ) AS "groupKey"
    `),
  });

  /** All tables in dependency order (init first → last, delete in reverse) */
  const _allTransactionTables = [
    subscriptionRenewalTxns,
    subscriptionCancelTxns,
    subscriptionStartTxns,
    subscriptionEndTxns,
    itemGrantRepeatTxns,
    oneTimePurchaseTxns,
    manualItemQuantityChangeTxns,
    refundTxns,
    transactionsUngrouped,
    transactions,
  ] as const;

  return {
    transactions,
    _allTransactionTables,
  };
}

export type TransactionsTables = ReturnType<typeof createTransactionsTable>;
