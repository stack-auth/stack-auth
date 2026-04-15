/**
 * OTP (One-Time Purchase) TimeFold reducer SQL builder.
 *
 * Generates the SQL for a TimeFold that processes OTP rows and emits
 * item-grant-repeat events only. OTPs don't have start/end lifecycle events
 * from the TimeFold — the OTP event itself is derived directly from the
 * stored table via MapTable.
 *
 * State shape (JSONB):
 * {
 *   purchaseId, tenancyId, customerId, customerType,
 *   paymentProvider, anchorMillis,
 *   itemRepeatSchedule: { [itemId]: { quantity, expiresWhen, repeatIntervalMs, nextRepeatMillis } },
 *   outstandingGrants: [{ txnId, entryIndex, itemId, quantity, expiresWhen }],
 *   repeatCount,
 * }
 *
 * Flow:
 *   timestamp=null  → initialize state from OTP row, schedule first repeat (no event emitted)
 *   timestamp=T     → emit item-grant-repeat for items due at T, schedule next
 *
 * Note: OTPs never "end", so repeats continue indefinitely (or until the OTP
 * row is removed/refunded, which removes it from the TimeFold input).
 */


/**
 * SQL to compute the repeat interval in milliseconds from a DayInterval JSONB.
 */
function repeatIntervalMsSql(intervalJsonb: string): string {
  return `(
    (${intervalJsonb}->>0)::numeric * CASE (${intervalJsonb}->>1)
      WHEN 'day' THEN 86400000
      WHEN 'week' THEN 604800000
      WHEN 'month' THEN 2592000000
      WHEN 'year' THEN 31536000000
      ELSE NULL
    END
  )`;
}

function paymentProviderSql(creationSourcePath: string): string {
  return `CASE WHEN ${creationSourcePath} = 'TEST_MODE' THEN 'test_mode' ELSE 'stripe' END`;
}


/**
 * Returns the full reducer SQL for the OTP TimeFold.
 */
export function getOtpTimeFoldReducerSql(): string {
  const S = `"oldState"`;
  const R = `"oldRowData"`;
  const T = `"timestamp"`;

  const anchor = `(${R}->>'createdAtMillis')::numeric`;
  const provider = paymentProviderSql(`${R}->>'creationSource'`);

  // The OTP transaction has entries: [product-grant(0), money-transfer?(1), ...item-quantity-change(1or2+)]
  // Entry index for item changes depends on money-transfer presence
  const otpTxnId = `('otp:' || (${R}->>'id'))`;
  const hasMoneyTransfer = `(${provider} != 'test_mode')`;
  const otpItemChangeBaseIndex = `(CASE WHEN ${hasMoneyTransfer} THEN 2 ELSE 1 END)`;

  const initRepeatSchedule = `(
    SELECT COALESCE(jsonb_object_agg(
      "item"."key",
      jsonb_build_object(
        'quantity', to_jsonb(("item"."value"->>'quantity')::numeric * (${R}->>'quantity')::numeric),
        'expiresWhen', CASE
          WHEN "item"."value"->>'expires' IN ('when-purchase-expires', 'when-repeated')
          THEN to_jsonb("item"."value"->>'expires')
          ELSE 'null'::jsonb
        END,
        'repeatIntervalMs', CASE
          WHEN "item"."value"->'repeat' IS NOT NULL
            AND jsonb_typeof("item"."value"->'repeat') = 'array'
            AND "item"."value"->'repeat' != '"never"'::jsonb
          THEN to_jsonb(${repeatIntervalMsSql(`"item"."value"->'repeat'`)})
          ELSE 'null'::jsonb
        END,
        'nextRepeatMillis', CASE
          WHEN "item"."value"->'repeat' IS NOT NULL
            AND jsonb_typeof("item"."value"->'repeat') = 'array'
            AND "item"."value"->'repeat' != '"never"'::jsonb
          THEN to_jsonb(${anchor} + ${repeatIntervalMsSql(`"item"."value"->'repeat'`)})
          ELSE 'null'::jsonb
        END
      )
    ), '{}'::jsonb)
    FROM jsonb_each(${R}->'product'->'includedItems') AS "item"
    WHERE "item"."value"->'repeat' IS NOT NULL
      AND jsonb_typeof("item"."value"->'repeat') = 'array'
      AND "item"."value"->'repeat' != '"never"'::jsonb
  )`;

  const initOutstandingGrants = `(
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'txnId', to_jsonb(${otpTxnId}),
        'entryIndex', to_jsonb(${otpItemChangeBaseIndex} + ("idx"::int - 1)),
        'itemId', to_jsonb("item"."key"),
        'quantity', to_jsonb(("item"."value"->>'quantity')::numeric * (${R}->>'quantity')::numeric),
        'expiresWhen', CASE
          WHEN "item"."value"->>'expires' IN ('when-purchase-expires', 'when-repeated')
          THEN to_jsonb("item"."value"->>'expires')
          ELSE 'null'::jsonb
        END
      )
    ), '[]'::jsonb)
    FROM jsonb_each(${R}->'product'->'includedItems') WITH ORDINALITY AS "item"("key", "value", "idx")
  )`;

  const initialState = `jsonb_build_object(
    'purchaseId', ${R}->'id',
    'tenancyId', ${R}->'tenancyId',
    'customerId', ${R}->'customerId',
    'customerType', ${R}->'customerType',
    'paymentProvider', to_jsonb(${provider}),
    'anchorMillis', to_jsonb(${anchor}),
    'revokedAtMillis', ${R}->'revokedAtMillis',
    'itemRepeatSchedule', ${initRepeatSchedule},
    'outstandingGrants', ${initOutstandingGrants},
    'repeatCount', to_jsonb(0)
  )`;

  // Soonest next repeat, capped at revokedAtMillis
  const soonestRepeatFromState = (stateSql: string) => `(
    SELECT MIN(("sched"."value"->>'nextRepeatMillis')::numeric)
    FROM jsonb_each(${stateSql}->'itemRepeatSchedule') AS "sched"
    WHERE "sched"."value"->>'nextRepeatMillis' != 'null'
      AND "sched"."value"->'nextRepeatMillis' IS NOT NULL
  )`;

  const nextTimestampFromState = (stateSql: string) => `(
    SELECT CASE
      WHEN ${soonestRepeatFromState(stateSql)} IS NULL THEN NULL
      WHEN ${stateSql}->>'revokedAtMillis' != 'null'
        AND ${stateSql}->'revokedAtMillis' IS NOT NULL
        AND ${soonestRepeatFromState(stateSql)} > (${stateSql}->>'revokedAtMillis')::numeric
      THEN NULL
      ELSE to_timestamp(${soonestRepeatFromState(stateSql)} / 1000.0)
    END
  )`;

  // ── item-grant-repeat event (same logic as subscription but with sourceType=one_time_purchase) ──
  const currentMillis = `(EXTRACT(EPOCH FROM ${T}) * 1000)::numeric`;

  const dueItems = `(
    SELECT jsonb_agg(jsonb_build_object('itemId', "sched"."key", 'schedule', "sched"."value"))
    FROM jsonb_each(${S}->'itemRepeatSchedule') AS "sched"
    WHERE "sched"."value"->>'nextRepeatMillis' != 'null'
      AND "sched"."value"->'nextRepeatMillis' IS NOT NULL
      AND ("sched"."value"->>'nextRepeatMillis')::numeric <= ${currentMillis}
  )`;

  const igrTxnId = `('igr:' || (${S}->>'purchaseId') || ':' || ${currentMillis}::bigint::text)`;

  const previousGrantsToExpire = `(
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'transactionId', "g"->'txnId',
        'entryIndex', "g"->'entryIndex',
        'itemId', "g"->'itemId',
        'quantity', "g"->'quantity'
      )
    ), '[]'::jsonb)
    FROM jsonb_array_elements(${S}->'outstandingGrants') AS "g"
    WHERE "g"->>'expiresWhen' = 'when-repeated'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(${dueItems}) AS "di"
        WHERE "di"->>'itemId' = "g"->>'itemId'
      )
  )`;

  const igrItemGrants = `(
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'itemId', "di"->>'itemId',
        'quantity', ("di"->'schedule'->>'quantity')::numeric,
        'expiresWhen', "di"->'schedule'->'expiresWhen'
      )
    ), '[]'::jsonb)
    FROM jsonb_array_elements(${dueItems}) AS "di"
  )`;

  const igrEventRow = `jsonb_build_object(
    'type', '"item-grant-repeat"'::jsonb,
    'sourceType', '"one_time_purchase"'::jsonb,
    'sourceId', ${S}->'purchaseId',
    'tenancyId', ${S}->'tenancyId',
    'customerId', ${S}->'customerId',
    'customerType', ${S}->'customerType',
    'itemGrants', ${igrItemGrants},
    'previousGrantsToExpire', ${previousGrantsToExpire},
    'paymentProvider', ${S}->'paymentProvider',
    'effectiveAtMillis', to_jsonb(${currentMillis}),
    'createdAtMillis', to_jsonb(${currentMillis})
  )`;

  const numExpireEntries = `(
    SELECT count(*)::int
    FROM jsonb_array_elements(${S}->'outstandingGrants') AS "g"
    WHERE "g"->>'expiresWhen' = 'when-repeated'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(${dueItems}) AS "di"
        WHERE "di"->>'itemId' = "g"->>'itemId'
      )
  )`;

  const igrUpdatedGrants = `(
    (
      SELECT COALESCE(jsonb_agg("g"), '[]'::jsonb)
      FROM jsonb_array_elements(${S}->'outstandingGrants') AS "g"
      WHERE NOT (
        "g"->>'expiresWhen' = 'when-repeated'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(${dueItems}) AS "di"
          WHERE "di"->>'itemId' = "g"->>'itemId'
        )
      )
    ) || (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'txnId', to_jsonb(${igrTxnId}),
          'entryIndex', to_jsonb(${numExpireEntries} + ("idx"::int - 1)),
          'itemId', "di"."value"->>'itemId',
          'quantity', to_jsonb(("di"."value"->'schedule'->>'quantity')::numeric),
          'expiresWhen', "di"."value"->'schedule'->'expiresWhen'
        )
      ), '[]'::jsonb)
      FROM jsonb_array_elements(${dueItems}) WITH ORDINALITY AS "di"("value", "idx")
    )
  )`;

  const igrUpdatedSchedule = `(
    SELECT jsonb_object_agg(
      "sched"."key",
      CASE
        WHEN "sched"."value"->>'nextRepeatMillis' != 'null'
          AND "sched"."value"->'nextRepeatMillis' IS NOT NULL
          AND ("sched"."value"->>'nextRepeatMillis')::numeric <= ${currentMillis}
        THEN "sched"."value" || jsonb_build_object(
          'nextRepeatMillis', to_jsonb(
            ("sched"."value"->>'nextRepeatMillis')::numeric + ("sched"."value"->>'repeatIntervalMs')::numeric
          )
        )
        ELSE "sched"."value"
      END
    )
    FROM jsonb_each(${S}->'itemRepeatSchedule') AS "sched"
  )`;

  const repeatCount = `(${S}->>'repeatCount')::int`;
  const igrNewState = `${S} || jsonb_build_object(
    'outstandingGrants', ${igrUpdatedGrants},
    'itemRepeatSchedule', ${igrUpdatedSchedule},
    'repeatCount', to_jsonb(${repeatCount} + 1)
  )`;

  // First run: initialize state, no events emitted, schedule first repeat
  // Subsequent runs: emit item-grant-repeat
  return `
    CASE
      WHEN ${T} IS NULL THEN ${initialState}
      ELSE ${igrNewState}
    END AS "newState",

    CASE
      WHEN ${T} IS NULL THEN '[]'::jsonb
      ELSE jsonb_build_array(${igrEventRow})
    END AS "newRowsData",

    CASE
      WHEN ${T} IS NULL THEN ${nextTimestampFromState(initialState)}
      ELSE ${nextTimestampFromState(igrNewState)}
    END AS "nextTimestamp"
  `;
}
