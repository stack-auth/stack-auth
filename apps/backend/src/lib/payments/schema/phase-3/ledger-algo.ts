/**
 * Phase 3: Ledger algorithm reducer SQL.
 *
 * Extracted for readability. Used by item-quantities.ts LFold.
 *
 * State: JSONB map of itemId → net quantity (e.g. {"credits": 95, "bonus": 10}).
 * On each row, adds the row's quantity to the entry for its itemId.
 *
 * Each output row contains the full itemQuantities map after that transaction,
 * plus the transaction metadata. getItemQuantityForCustomer picks out the
 * specific item from the map via imperative code.
 *
 * TODO: Implement full grant-level tracking for expiry-aware consumption:
 * - State per item: ordered list of { quantity, expiresAtMillis } sorted by expiresAtMillis
 * - On positive: insert into ordered list
 * - On negative: consume from soonest-expiring first
 * - Expire grants where expiresAtMillis <= current effectiveAtMillis
 * Current simplified version just sums quantities per item. Expiry handling
 * is deferred to the query function.
 */

/**
 * Returns the SQL reducer string for the ledger algorithm LFold.
 * References `"oldState"` (JSONB map: itemId → quantity) and
 * `"oldRowData"` (the current item-change-with-expiry row).
 */
export function getLedgerAlgoReducerSql(): string {
  return `
    (
      "oldState" || jsonb_build_object(
        COALESCE("oldRowData"->>'itemId', '__unknown__'),
        to_jsonb(
          COALESCE(("oldState"->>COALESCE("oldRowData"->>'itemId', '__unknown__'))::numeric, 0)
          + COALESCE(("oldRowData"->>'quantity')::numeric, 0)
        )
      )
    ) AS "newState",
    jsonb_build_array(
      jsonb_build_object(
        'txnEffectiveAtMillis', "oldRowData"->'txnEffectiveAtMillis',
        'txnId', "oldRowData"->'txnId',
        'itemQuantities',
          "oldState" || jsonb_build_object(
            COALESCE("oldRowData"->>'itemId', '__unknown__'),
            to_jsonb(
              COALESCE(("oldState"->>COALESCE("oldRowData"->>'itemId', '__unknown__'))::numeric, 0)
              + COALESCE(("oldRowData"->>'quantity')::numeric, 0)
            )
          ),
        'customerType', "oldRowData"->'customerType',
        'customerId', "oldRowData"->'customerId',
        'tenancyId', "oldRowData"->'tenancyId'
      )
    ) AS "newRowsData"
  `;
}
