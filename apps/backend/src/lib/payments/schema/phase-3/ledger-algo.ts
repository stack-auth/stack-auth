/**
 * Phase 3: Ledger algorithm reducer SQL.
 *
 * Extracted for readability. Used by item-quantities.ts LFold.
 *
 * State: JSONB map of itemId → { grants: [{q, e}], debt: number }
 *   grants = list of active positive-quantity grants, each with quantity q
 *            and expiry e (millis or jsonb null for never-expiring)
 *   debt   = negative number tracking underflow from removals (0 when no debt)
 *
 * Invariant: a given item never has both non-empty grants AND nonzero debt.
 *
 * On each row:
 *   - Grant (qty > 0): absorb debt first, then append remaining to grants
 *   - Removal (qty < 0): walk grants soonest-expiry-first, deduct in-place,
 *     overflow goes to debt
 *   - Expiry marker (qty = 0): remove expired grants where e <= t
 *
 * Net quantity per item = sum(grants[*].q) + debt
 */

/**
 * Returns the SQL reducer string for the ledger algorithm LFold.
 * References `"oldState"` and `"oldRowData"` from the LFold context.
 */
export function getLedgerAlgoReducerSql(): string {
  const itemId = `COALESCE("oldRowData"->>'itemId', '__unknown__')`;
  const qty = `COALESCE(("oldRowData"->>'quantity')::numeric, 0)`;
  const expiry = `"oldRowData"->'expiresAtMillis'`;
  const currentTime = `COALESCE(("oldRowData"->>'txnEffectiveAtMillis')::numeric, 0)`;

  const oldItemState = `COALESCE("oldState"->${itemId}, '{"grants":[],"debt":0}'::jsonb)`;
  const oldGrants = `COALESCE(${oldItemState}->'grants', '[]'::jsonb)`;
  const oldDebt = `COALESCE((${oldItemState}->>'debt')::numeric, 0)`;

  // Sort grants by expiry: soonest first, null (never) last
  const sortedGrants = `(
    SELECT COALESCE(jsonb_agg(
      "g" ORDER BY
        CASE WHEN "g"->'e' = 'null'::jsonb OR "g"->'e' IS NULL THEN 1 ELSE 0 END,
        ("g"->>'e')::numeric ASC NULLS LAST
    ), '[]'::jsonb)
    FROM jsonb_array_elements(${oldGrants}) AS "g"
  )`;

  // ── Grant path (qty > 0): absorb debt, then append ──
  // afterDebtQty = qty + debt (debt is negative, so this reduces qty)
  // newDebt = LEAST(0, afterDebtQty)  -- if still negative, that's the new debt
  // grantQty = GREATEST(0, afterDebtQty)  -- what's left to grant
  const grantNewItemState = `(
    SELECT jsonb_build_object(
      'grants',
        CASE WHEN GREATEST(0, ${qty} + ${oldDebt}) > 0
          THEN ${oldGrants} || jsonb_build_array(
            jsonb_build_object('q', GREATEST(0, ${qty} + ${oldDebt}), 'e', ${expiry})
          )
          ELSE ${oldGrants}
        END,
      'debt', LEAST(0, ${qty} + ${oldDebt})
    )
  )`;

  // ── Removal path (qty < 0): walk grants soonest-expiry-first, deduct in-place ──
  // Uses a recursive CTE to walk through sorted grants and consume them.
  const removalNewItemState = `(
    WITH RECURSIVE
    "sortedGrantsArr" AS (
      SELECT "g"."value" AS "grant", "g"."ordinality" AS "idx",
             jsonb_array_length(${sortedGrants}) AS "total"
      FROM jsonb_array_elements(${sortedGrants}) WITH ORDINALITY AS "g"
    ),
    "deductWalk" AS (
      SELECT
        1 AS "idx",
        ABS(${qty}) AS "toRemove",
        CASE
          WHEN LEAST(("sortedGrantsArr"."grant"->>'q')::numeric, ABS(${qty})) >= ("sortedGrantsArr"."grant"->>'q')::numeric
            THEN NULL
          ELSE jsonb_build_object(
            'q', ("sortedGrantsArr"."grant"->>'q')::numeric - LEAST(("sortedGrantsArr"."grant"->>'q')::numeric, ABS(${qty})),
            'e', "sortedGrantsArr"."grant"->'e'
          )
        END AS "updatedGrant",
        ABS(${qty}) - LEAST(("sortedGrantsArr"."grant"->>'q')::numeric, ABS(${qty})) AS "remaining",
        "sortedGrantsArr"."total" AS "total"
      FROM "sortedGrantsArr"
      WHERE "sortedGrantsArr"."idx" = 1

      UNION ALL

      SELECT
        "deductWalk"."idx" + 1,
        "deductWalk"."remaining",
        CASE
          WHEN "deductWalk"."remaining" <= 0 THEN "sortedGrantsArr"."grant"
          WHEN LEAST(("sortedGrantsArr"."grant"->>'q')::numeric, "deductWalk"."remaining") >= ("sortedGrantsArr"."grant"->>'q')::numeric
            THEN NULL
          ELSE jsonb_build_object(
            'q', ("sortedGrantsArr"."grant"->>'q')::numeric - LEAST(("sortedGrantsArr"."grant"->>'q')::numeric, "deductWalk"."remaining"),
            'e', "sortedGrantsArr"."grant"->'e'
          )
        END,
        CASE
          WHEN "deductWalk"."remaining" <= 0 THEN 0
          ELSE "deductWalk"."remaining" - LEAST(("sortedGrantsArr"."grant"->>'q')::numeric, "deductWalk"."remaining")
        END,
        "deductWalk"."total"
      FROM "deductWalk"
      INNER JOIN "sortedGrantsArr" ON "sortedGrantsArr"."idx" = "deductWalk"."idx" + 1
    )
    SELECT jsonb_build_object(
      'grants', (
        SELECT COALESCE(jsonb_agg("dw"."updatedGrant" ORDER BY "dw"."idx"), '[]'::jsonb)
        FROM "deductWalk" AS "dw"
        WHERE "dw"."updatedGrant" IS NOT NULL
      ),
      'debt', ${oldDebt} - COALESCE(
        (SELECT "dw"."remaining" FROM "deductWalk" AS "dw" ORDER BY "dw"."idx" DESC LIMIT 1),
        ABS(${qty})
      )
    )
  )`;

  // ── Expiry path (qty = 0): remove expired grants ──
  const expiryNewItemState = `(
    SELECT jsonb_build_object(
      'grants', (
        SELECT COALESCE(jsonb_agg("g"), '[]'::jsonb)
        FROM jsonb_array_elements(${oldGrants}) AS "g"
        WHERE "g"->'e' = 'null'::jsonb
          OR "g"->'e' IS NULL
          OR ("g"->>'e')::numeric > ${currentTime}
      ),
      'debt', ${oldDebt}
    )
  )`;

  // Select the right path based on quantity sign
  const newItemState = `
    CASE
      WHEN ${qty} > 0 THEN ${grantNewItemState}
      WHEN ${qty} < 0 THEN ${removalNewItemState}
      ELSE ${expiryNewItemState}
    END
  `;

  const newStateSql = `"oldState" || jsonb_build_object(${itemId}, ${newItemState})`;

  // Net quantity per item = sum(grants[*].q) + debt
  const netQtysSql = `(
    SELECT COALESCE(jsonb_object_agg(
      "items"."key",
      (
        SELECT COALESCE(SUM(("g"->>'q')::numeric), 0)
        FROM jsonb_array_elements("items"."value"->'grants') AS "g"
      ) + COALESCE(("items"."value"->>'debt')::numeric, 0)
    ), '{}'::jsonb)
    FROM jsonb_each(${newStateSql}) AS "items"
  )`;

  return `
    (${newStateSql}) AS "newState",
    jsonb_build_array(
      jsonb_build_object(
        'txnEffectiveAtMillis', "oldRowData"->'txnEffectiveAtMillis',
        'txnId', "oldRowData"->'txnId',
        'itemQuantities', ${netQtysSql},
        'customerType', "oldRowData"->'customerType',
        'customerId', "oldRowData"->'customerId',
        'tenancyId', "oldRowData"->'tenancyId'
      )
    ) AS "newRowsData"
  `;
}
