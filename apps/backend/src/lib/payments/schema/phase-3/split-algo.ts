/**
 * Phase 3: Expiry split algorithm SQL.
 *
 * Extracted for reuse in both the FlatMap mapper and direct tests.
 *
 * Splits a (quantity, expiries[]) pair into individual (subQty, expiresAt) rows.
 * For grants (qty >= 0): uses LEAST to cap each split at remaining.
 * For removals (qty < 0): uses GREATEST (closer to zero for negatives).
 *
 * Expects `"rowData"` to be in scope with fields `quantity` (numeric) and
 * `expiries` (jsonb array of {txnEffectiveAtMillis, quantityExpiring}).
 *
 * Produces CTEs `"expiryArray"` and `"walked"`. The `"walked"` CTE has columns:
 *   idx, inputRemaining, quantityExpiring, remaining, expiresAtMillis, total
 */
export function getSplitAlgoCteSql(): string {
  return `
    "expiryArray" AS (
      SELECT
        "exp"."value" AS "expiry",
        "exp"."ordinality" AS "idx",
        jsonb_array_length("rowData"->'expiries') AS "total"
      FROM jsonb_array_elements("rowData"->'expiries') WITH ORDINALITY AS "exp"
    ),
    "walked" AS (
      SELECT
        1 AS "idx",
        ("rowData"->>'quantity')::numeric AS "inputRemaining",
        (CASE WHEN ("rowData"->>'quantity')::numeric >= 0
          THEN LEAST(("rowData"->>'quantity')::numeric, COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0))
          ELSE GREATEST(("rowData"->>'quantity')::numeric, COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0))
        END) AS "quantityExpiring",
        ("rowData"->>'quantity')::numeric - (CASE WHEN ("rowData"->>'quantity')::numeric >= 0
          THEN LEAST(("rowData"->>'quantity')::numeric, COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0))
          ELSE GREATEST(("rowData"->>'quantity')::numeric, COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0))
        END) AS "remaining",
        "expiryArray"."expiry"->'txnEffectiveAtMillis' AS "expiresAtMillis",
        "expiryArray"."total" AS "total"
      FROM "expiryArray"
      WHERE "expiryArray"."idx" = 1

      UNION ALL

      SELECT
        "walked"."idx" + 1 AS "idx",
        "walked"."remaining" AS "inputRemaining",
        (CASE WHEN "walked"."inputRemaining" >= 0
          THEN LEAST("walked"."remaining", COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0))
          ELSE GREATEST("walked"."remaining", COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0))
        END) AS "quantityExpiring",
        "walked"."remaining" - (CASE WHEN "walked"."inputRemaining" >= 0
          THEN LEAST("walked"."remaining", COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0))
          ELSE GREATEST("walked"."remaining", COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0))
        END) AS "remaining",
        "expiryArray"."expiry"->'txnEffectiveAtMillis' AS "expiresAtMillis",
        "walked"."total" AS "total"
      FROM "walked"
      INNER JOIN "expiryArray" ON "expiryArray"."idx" = "walked"."idx" + 1
    )
  `;
}
