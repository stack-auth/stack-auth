/**
 * Phase 1: Event tables derived from SeedEventsTables.
 *
 * 7 event types, each representing a meaningful payment lifecycle event:
 *   subscription-renewal, subscription-cancel, subscription-start,
 *   subscription-end, item-grant-repeat, one-time-purchase,
 *   manual-item-quantity-change
 *
 * Subscription TimeFold processes each subscription row and emits
 * subscription-start, item-grant-repeat, and subscription-end events.
 * OTP TimeFold processes each OTP row and emits item-grant-repeat events.
 * Both TimeFold outputs are split by type via FilterTables.
 *
 * Note: one-time-purchase events are derived directly from the OTP StoredTable,
 * NOT from a TimeFold. The OTP TimeFold only produces item-grant-repeat events.
 */

import {
  declareConcatTable,
  declareFilterTable,
  declareLeftJoinTable,
  declareMapTable,
  declareTimeFoldTable,
} from "@/lib/bulldozer/db/index";
import { getOtpTimeFoldReducerSql } from "./otp-timefold-algo";
import type { SeedEventsStoredTables } from "./stored-tables";
import { getSubscriptionTimeFoldReducerSql } from "./subscription-timefold-algo";

const mapper = (sql: string) => ({ type: "mapper" as const, sql });
const predicate = (sql: string) => ({ type: "predicate" as const, sql });


// ============================================================
// SQL helpers for common patterns
// ============================================================

/**
 * SQL expression that builds a chargedAmount JSONB object from a product's
 * prices map, the selected priceId, and the purchase quantity.
 * Iterates over currency amounts in the price entry and multiplies by quantity.
 */
function chargedAmountSql(productPath: string, priceIdPath: string, quantityPath: string): string {
  return `(
    SELECT COALESCE(
      jsonb_object_agg(
        "kv"."key",
        to_jsonb((("kv"."value")::numeric * (${quantityPath})::numeric)::text)
      ),
      '{}'::jsonb
    )
    FROM jsonb_each_text(
      COALESCE(
        ${productPath}->'prices'->(${priceIdPath}),
        '{}'::jsonb
      )
    ) AS "kv"
    WHERE "kv"."key" NOT IN ('interval', 'serverOnly', 'freeTrial')
      AND "kv"."value" ~ '^-?[0-9]'
  )`;
}

/**
 * SQL expression that derives paymentProvider from a creationSource field.
 * TEST_MODE → "test_mode", otherwise → "stripe".
 */
function paymentProviderFromCreationSourceSql(creationSourcePath: string): string {
  return `CASE WHEN ${creationSourcePath} = 'TEST_MODE' THEN '"test_mode"'::jsonb ELSE '"stripe"'::jsonb END`;
}


// ============================================================
// Event table declarations
// ============================================================

export function createEventTables(stored: SeedEventsStoredTables) {

  // ── subscription-renewal ──────────────────────────────────
  // LeftJoin subscriptions with invoices on (tenancyId, stripeSubscriptionId),
  // then filter for non-creation invoices, then map to event shape.

  const subscriptionsWithInvoices = declareLeftJoinTable({
    tableId: "payments-subscriptions-with-invoices",
    leftTable: stored.subscriptionInvoices,
    rightTable: stored.subscriptions,
    leftJoinKey: mapper(`
      jsonb_build_object(
        'tenancyId', "rowData"->'tenancyId',
        'stripeSubscriptionId', "rowData"->'stripeSubscriptionId'
      ) AS "joinKey"
    `),
    rightJoinKey: mapper(`
      jsonb_build_object(
        'tenancyId', "rowData"->'tenancyId',
        'stripeSubscriptionId', "rowData"->'stripeSubscriptionId'
      ) AS "joinKey"
    `),
  });

  const renewalInvoiceRows = declareFilterTable({
    tableId: "payments-renewal-invoice-rows",
    fromTable: subscriptionsWithInvoices,
    filter: predicate(`
      "rowData"->'leftRowData' IS NOT NULL
      AND jsonb_typeof("rowData"->'leftRowData') = 'object'
      AND "rowData"->'rightRowData' IS NOT NULL
      AND jsonb_typeof("rowData"->'rightRowData') = 'object'
      AND "rowData"->'leftRowData'->'isSubscriptionCreationInvoice' = 'false'::jsonb
    `),
  });

  const subscriptionRenewalEvents = declareMapTable({
    tableId: "payments-subscription-renewal-events",
    fromTable: renewalInvoiceRows,
    mapper: mapper(`
      "rowData"->'rightRowData'->'id' AS "subscriptionId",
      "rowData"->'rightRowData'->'tenancyId' AS "tenancyId",
      "rowData"->'rightRowData'->'customerId' AS "customerId",
      "rowData"->'rightRowData'->'customerType' AS "customerType",
      "rowData"->'leftRowData'->'id' AS "invoiceId",
      ${chargedAmountSql(
        `"rowData"->'rightRowData'->'product'`,
        `"rowData"->'rightRowData'->>'priceId'`,
        `"rowData"->'rightRowData'->>'quantity'`,
      )} AS "chargedAmount",
      ${paymentProviderFromCreationSourceSql(`"rowData"->'rightRowData'->>'creationSource'`)} AS "paymentProvider",
      "rowData"->'leftRowData'->'createdAtMillis' AS "effectiveAtMillis",
      "rowData"->'leftRowData'->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── subscription-cancel ───────────────────────────────────
  // Active/trialing subscriptions with cancelAtPeriodEnd = true.

  const cancelPendingSubscriptions = declareFilterTable({
    tableId: "payments-cancel-pending-subscriptions",
    fromTable: stored.subscriptions,
    filter: predicate(`
      "rowData"->'cancelAtPeriodEnd' = 'true'::jsonb
      AND ("rowData"->>'status' = 'active' OR "rowData"->>'status' = 'trialing')
    `),
  });

  const subscriptionCancelEvents = declareMapTable({
    tableId: "payments-subscription-cancel-events",
    fromTable: cancelPendingSubscriptions,
    mapper: mapper(`
      "rowData"->'id' AS "subscriptionId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'customerType' AS "customerType",
      '"cancel"'::jsonb AS "changeType",
      ${paymentProviderFromCreationSourceSql(`"rowData"->>'creationSource'`)} AS "paymentProvider",
      COALESCE("rowData"->'canceledAtMillis', "rowData"->'createdAtMillis') AS "effectiveAtMillis",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── Subscription TimeFold ────────────────────────────────
  // Processes each subscription row and emits subscription-start,
  // item-grant-repeat, and subscription-end events (tagged with `type`).
  // FilterTables split the mixed output into separate event tables.

  const subscriptionTimeFoldOutput = declareTimeFoldTable({
    tableId: "payments-subscription-timefold",
    fromTable: stored.subscriptions,
    initialState: { type: "expression" as const, sql: "'{}'::jsonb" },
    reducer: mapper(getSubscriptionTimeFoldReducerSql()),
  });

  const subscriptionStartEvents = declareFilterTable({
    tableId: "payments-subscription-start-events",
    fromTable: subscriptionTimeFoldOutput,
    filter: predicate(`"rowData"->>'type' = 'subscription-start'`),
  });

  const subscriptionEndEvents = declareFilterTable({
    tableId: "payments-subscription-end-events",
    fromTable: subscriptionTimeFoldOutput,
    filter: predicate(`"rowData"->>'type' = 'subscription-end'`),
  });

  const itemGrantRepeatFromSubscriptions = declareFilterTable({
    tableId: "payments-item-grant-repeat-from-subscriptions",
    fromTable: subscriptionTimeFoldOutput,
    filter: predicate(`"rowData"->>'type' = 'item-grant-repeat'`),
  });

  // ── one-time-purchase ───────────────────────────────────
  // Derived directly from OneTimePurchases StoredTable (not from TimeFold).
  // Refunds are handled via manualTransactions (additive), not by filtering
  // out refunded OTPs. The OTP TimeFold uses revokedAtMillis to stop repeats.

  const oneTimePurchaseEvents = declareMapTable({
    tableId: "payments-one-time-purchase-events",
    fromTable: stored.oneTimePurchases,
    mapper: mapper(`
      "rowData"->'id' AS "purchaseId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'productId' AS "productId",
      "rowData"->'product' AS "product",
      "rowData"->'product'->'productLineId' AS "productLineId",
      "rowData"->'priceId' AS "priceId",
      "rowData"->'quantity' AS "quantity",
      ${chargedAmountSql(
        `"rowData"->'product'`,
        `"rowData"->>'priceId'`,
        `"rowData"->>'quantity'`,
      )} AS "chargedAmount",
      (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'itemId', to_jsonb("item"."key"),
            'quantity', to_jsonb(("item"."value"->>'quantity')::numeric * ("rowData"->>'quantity')::numeric),
            'expiresWhen', CASE
              WHEN "item"."value"->>'expires' IN ('when-purchase-expires', 'when-repeated')
              THEN "item"."value"->'expires'
              ELSE 'null'::jsonb
            END
          )
        ), '[]'::jsonb)
        FROM jsonb_each("rowData"->'product'->'includedItems') AS "item"
      ) AS "itemGrants",
      ${paymentProviderFromCreationSourceSql(`"rowData"->>'creationSource'`)} AS "paymentProvider",
      "rowData"->'createdAtMillis' AS "effectiveAtMillis",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  // ── OTP TimeFold ───────────────────────────────────────
  // Processes each non-refunded OTP row and emits item-grant-repeat events.

  const otpTimeFoldOutput = declareTimeFoldTable({
    tableId: "payments-otp-timefold",
    fromTable: stored.oneTimePurchases,
    initialState: { type: "expression" as const, sql: "'{}'::jsonb" },
    reducer: mapper(getOtpTimeFoldReducerSql()),
  });

  const itemGrantRepeatFromOTPs = declareFilterTable({
    tableId: "payments-item-grant-repeat-from-otps",
    fromTable: otpTimeFoldOutput,
    filter: predicate(`"rowData"->>'type' = 'item-grant-repeat'`),
  });


  // ── Combined item-grant-repeat ────────────────────────────
  // Merges item-grant-repeat events from both subscriptions and OTPs.

  const itemGrantRepeatEvents = declareConcatTable({
    tableId: "payments-item-grant-repeat-events",
    tables: [itemGrantRepeatFromSubscriptions, itemGrantRepeatFromOTPs],
  });


  // ── manual-item-quantity-change ───────────────────────────

  const manualItemQuantityChangeEvents = declareMapTable({
    tableId: "payments-manual-item-quantity-change-events",
    fromTable: stored.manualItemQuantityChanges,
    mapper: mapper(`
      "rowData"->'id' AS "changeId",
      "rowData"->'tenancyId' AS "tenancyId",
      "rowData"->'customerId' AS "customerId",
      "rowData"->'customerType' AS "customerType",
      "rowData"->'itemId' AS "itemId",
      "rowData"->'quantity' AS "quantity",
      "rowData"->'expiresAtMillis' AS "expiresAtMillis",
      "rowData"->'createdAtMillis' AS "effectiveAtMillis",
      "rowData"->'createdAtMillis' AS "createdAtMillis"
    `),
  });


  /** All tables in dependency order (init first → last, delete in reverse) */
  const _allEventTables = [
    subscriptionsWithInvoices,
    renewalInvoiceRows,
    subscriptionRenewalEvents,
    cancelPendingSubscriptions,
    subscriptionCancelEvents,
    subscriptionTimeFoldOutput,
    subscriptionStartEvents,
    subscriptionEndEvents,
    itemGrantRepeatFromSubscriptions,
    oneTimePurchaseEvents,
    otpTimeFoldOutput,
    itemGrantRepeatFromOTPs,
    itemGrantRepeatEvents,
    manualItemQuantityChangeEvents,
  ] as const;

  return {
    subscriptionRenewalEvents,
    subscriptionCancelEvents,
    subscriptionStartEvents,
    subscriptionEndEvents,
    itemGrantRepeatEvents,
    oneTimePurchaseEvents,
    manualItemQuantityChangeEvents,
    _allEventTables,
  };
}

export type EventTables = ReturnType<typeof createEventTables>;
