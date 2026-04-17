/**
 * Phase 3: Expiry split algorithm SQL.
 *
 * Extracted for reuse in both the FlatMap mapper and direct tests.
 *
 * Splits a grant (quantity >= 0, expiries[]) into individual (subQty, expiresAt) rows.
 * Uses LEAST to cap each split at remaining quantity.
 *
 * Only called for grants (qty >= 0). Removals (qty < 0) bypass the split
 * entirely and are passed through as a single row.
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
        LEAST(("rowData"->>'quantity')::numeric, COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0)) AS "quantityExpiring",
        ("rowData"->>'quantity')::numeric - LEAST(("rowData"->>'quantity')::numeric, COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0)) AS "remaining",
        "expiryArray"."expiry"->'txnEffectiveAtMillis' AS "expiresAtMillis",
        "expiryArray"."total" AS "total"
      FROM "expiryArray"
      WHERE "expiryArray"."idx" = 1

      UNION ALL

      SELECT
        "walked"."idx" + 1 AS "idx",
        "walked"."remaining" AS "inputRemaining",
        LEAST("walked"."remaining", COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0)) AS "quantityExpiring",
        "walked"."remaining" - LEAST("walked"."remaining", COALESCE(("expiryArray"."expiry"->>'quantityExpiring')::numeric, 0)) AS "remaining",
        "expiryArray"."expiry"->'txnEffectiveAtMillis' AS "expiresAtMillis",
        "walked"."total" AS "total"
      FROM "walked"
      INNER JOIN "expiryArray" ON "expiryArray"."idx" = "walked"."idx" + 1
    )
  `;
}
