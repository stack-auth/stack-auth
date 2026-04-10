/**
 * Phase 3: Ledger algorithm reducer SQL.
 *
 * Extracted for readability. Used by item-quantities.ts LFold.
 *
 * State: JSONB map of itemId → { g: [{q, e}], r: [{q, e}] }
 *   g = grants (positive qty), r = removals (negative qty)
 *   q = quantity, e = expiresAtMillis (jsonb number or null)
 *
 * At each row (time t = txnEffectiveAtMillis), the output computes net
 * quantities per item by:
 *   1. Expiring removals where expiresAtMillis <= t (reversed — items come back)
 *   2. Spreading remaining removals across grants, consuming from soonest-expiring first
 *   3. Expiring grants where expiresAtMillis <= t (only what's left after consumption)
 *   4. Summing remaining grant quantities
 *
 * The spreading uses a window-function approach (cumulative sum over grants
 * sorted by expiry ASC nulls last) rather than recursive CTE, for simplicity.
 */

/**
 * SQL that computes the net quantity for a single item given its state and a time.
 *
 * @param itemStateSql - SQL expression yielding `{ g: [{q, e}], r: [{q, e}] }`
 * @param timeSql - SQL expression yielding the current time as numeric
 * @returns scalar SQL expression yielding a numeric net quantity
 */
export function getItemNetQtySql(itemStateSql: string, timeSql: string): string {
  return `(
    SELECT
      COALESCE(SUM(
        CASE WHEN "gr"."exp" IS NOT NULL AND "gr"."exp" <= ${timeSql} THEN 0
             ELSE "gr"."remaining"
        END
      ), 0)
      - GREATEST(
          MAX("gr"."total_remove")
          - COALESCE((SELECT SUM(("ge"->>'q')::numeric) FROM jsonb_array_elements(${itemStateSql}->'g') AS "ge"), 0),
          0
        )
    FROM (
      SELECT
        "sg"."qty",
        "sg"."exp",
        "tr"."val" AS "total_remove",
        CASE
          WHEN "sg"."cumul" <= "tr"."val" THEN 0
          WHEN "sg"."cumul" - "sg"."qty" >= "tr"."val" THEN "sg"."qty"
          ELSE "sg"."cumul" - "tr"."val"
        END AS "remaining"
      FROM (
        SELECT
          ("ge"->>'q')::numeric AS "qty",
          CASE WHEN "ge"->'e' = 'null'::jsonb OR "ge"->'e' IS NULL
               THEN NULL ELSE ("ge"->>'e')::numeric END AS "exp",
          SUM(("ge"->>'q')::numeric) OVER (
            ORDER BY
              CASE WHEN "ge"->'e' = 'null'::jsonb OR "ge"->'e' IS NULL THEN 1 ELSE 0 END,
              ("ge"->>'e')::numeric ASC NULLS LAST
            ROWS UNBOUNDED PRECEDING
          ) AS "cumul"
        FROM jsonb_array_elements(${itemStateSql}->'g') AS "ge"
      ) AS "sg"
      CROSS JOIN LATERAL (
        SELECT COALESCE(ABS(SUM(("re"->>'q')::numeric)), 0) AS "val"
        FROM jsonb_array_elements(${itemStateSql}->'r') AS "re"
        WHERE "re"->'e' = 'null'::jsonb
          OR "re"->'e' IS NULL
          OR ("re"->>'e')::numeric > ${timeSql}
      ) AS "tr"
    ) AS "gr"
  )`;
}

/**
 * SQL that computes net quantities for ALL items in a full state JSONB.
 *
 * @param stateSql - SQL expression yielding `{ [itemId]: { g: [...], r: [...] } }`
 * @param timeSql - SQL expression yielding the current time as numeric
 * @returns scalar SQL expression yielding `{ [itemId]: numeric }` JSONB
 */
export function getAllNetQtysSql(stateSql: string, timeSql: string): string {
  return `(
    SELECT COALESCE(jsonb_object_agg(
      "items"."key",
      ${getItemNetQtySql(`"items"."value"`, timeSql)}
    ), '{}'::jsonb)
    FROM jsonb_each(${stateSql}) AS "items"
  )`;
}

/**
 * Returns the SQL reducer string for the ledger algorithm LFold.
 * References `"oldState"` and `"oldRowData"` from the LFold context.
 */
export function getLedgerAlgoReducerSql(): string {
  const itemId = `COALESCE("oldRowData"->>'itemId', '__unknown__')`;
  const qty = `COALESCE(("oldRowData"->>'quantity')::numeric, 0)`;
  const expiry = `"oldRowData"->'expiresAtMillis'`;
  const currentTime = `COALESCE(("oldRowData"->>'txnEffectiveAtMillis')::numeric, 0)`;

  const oldGrants = `COALESCE("oldState"->${itemId}->'g', '[]'::jsonb)`;
  const oldRemovals = `COALESCE("oldState"->${itemId}->'r', '[]'::jsonb)`;
  const newEntry = `jsonb_build_object('q', ${qty}, 'e', ${expiry})`;

  const newItemState = `jsonb_build_object(
    'g', CASE WHEN ${qty} >= 0 THEN ${oldGrants} || jsonb_build_array(${newEntry}) ELSE ${oldGrants} END,
    'r', CASE WHEN ${qty} < 0 THEN ${oldRemovals} || jsonb_build_array(${newEntry}) ELSE ${oldRemovals} END
  )`;

  const newStateSql = `"oldState" || jsonb_build_object(${itemId}, ${newItemState})`;

  return `
    (${newStateSql}) AS "newState",
    jsonb_build_array(
      jsonb_build_object(
        'txnEffectiveAtMillis', "oldRowData"->'txnEffectiveAtMillis',
        'txnId', "oldRowData"->'txnId',
        'itemQuantities', ${getAllNetQtysSql(newStateSql, currentTime)},
        'customerType', "oldRowData"->'customerType',
        'customerId', "oldRowData"->'customerId',
        'tenancyId', "oldRowData"->'tenancyId'
      )
    ) AS "newRowsData"
  `;
}
