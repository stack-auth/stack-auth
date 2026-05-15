/**
 * Subscription TimeFold reducer SQL builder.
 *
 * Generates the SQL for a TimeFold that processes subscription rows and emits
 * three event types: subscription-start, item-grant-repeat, subscription-end.
 *
 * State shape (JSONB):
 * {
 *   subscriptionId, tenancyId, customerId, customerType,
 *   productId, product, productLineId, priceId, quantity,
 *   paymentProvider, endedAtMillis,
 *   chargedAmount,
 *   startTxnId,                    // e.g. "sub-start:<subId>"
 *   startProductGrantEntryIndex,   // always 1 (after active-subscription-start)
 *   startItemChangeBaseIndex,      // 2 if no money-transfer, 3 if present
 *   itemRepeatSchedule: {          // per-item repeat info
 *     [itemId]: { quantity, expiresWhen, repeatIntervalMs, nextRepeatMillis }
 *   },
 *   outstandingGrants: [           // grants that can be expired later
 *     { txnId, entryIndex, itemId, quantity, expiresWhen }
 *   ],
 *   repeatCount,                   // how many item-grant-repeat events emitted so far
 * }
 *
 * Flow:
 *   timestamp=null  → emit subscription-start, schedule first repeat or end
 *   timestamp=T<end → emit item-grant-repeat for items due at T, schedule next
 *   timestamp=end   → emit subscription-end with all outstanding grants
 */


/**
 * SQL to compute the repeat interval in milliseconds from a DayInterval JSONB.
 * DayInterval is [number, "day"|"week"|"month"|"year"].
 * Approximation: day=86400000, week=604800000, month=2592000000 (30d), year=31536000000 (365d).
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

/**
 * SQL to compute chargedAmount from product prices, priceId, and quantity.
 * Returns a JSONB object { "USD": "10.00", ... } with currency → amount*qty.
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
 * SQL to derive paymentProvider from creationSource.
 */
function paymentProviderSql(creationSourcePath: string): string {
  return `CASE WHEN ${creationSourcePath} = 'TEST_MODE' THEN 'test_mode' ELSE 'stripe' END`;
}


/**
 * Returns the full reducer SQL for the subscription TimeFold.
 *
 * Available columns from TimeFold: "oldState", "oldRowData", "timestamp"
 *   - timestamp is NULL on first run, then equals the scheduled nextTimestamp
 */
export function getSubscriptionTimeFoldReducerSql(): string {
  // ── References to input columns ──
  const S = `"oldState"`;   // previous state (JSONB)
  const R = `"oldRowData"`; // subscription row data (JSONB)
  const T = `"timestamp"`;  // current timestamp (timestamptz, NULL on first run)

  // ── Helpers for state fields ──
  // anchor is not stored in state; it comes from the input row's createdAtMillis
  const endedAtMillis = `${S}->'endedAtMillis'`;
  const hasEnded = `(${S}->'endedAtMillis' IS NOT NULL AND ${S}->>'endedAtMillis' != 'null')`;

  // ── First-run state initialization ──
  const anchor = `(${R}->>'createdAtMillis')::numeric`;
  const provider = paymentProviderSql(`${R}->>'creationSource'`);
  const charged = chargedAmountSql(`${R}->'product'`, `${R}->>'priceId'`, `${R}->>'quantity'`);

  // Build initial itemRepeatSchedule from product.includedItems
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
  )`;

  // Does the subscription-start txn include a money-transfer entry?
  const hasMoneyTransfer = `(${provider} != 'test_mode' AND ${charged} != '{}'::jsonb)`;

  // Entry indices: active-subscription-start=0, product-grant=1, money-transfer=2?, item-changes=2or3+
  const startItemChangeBaseIndex = `(CASE WHEN ${hasMoneyTransfer} THEN 3 ELSE 2 END)`;

  // Build initial outstandingGrants from itemGrants in subscription-start
  // Each item gets an entry with txnId, entryIndex, itemId, quantity, expiresWhen
  const startTxnId = `('sub-start:' || (${R}->>'id'))`;
  const initOutstandingGrants = `(
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'txnId', to_jsonb(${startTxnId}),
        'entryIndex', to_jsonb(${startItemChangeBaseIndex} + ("idx"::int - 1)),
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

  // ── Initial state (built on first run) ──
  const initialState = `jsonb_build_object(
    'subscriptionId', ${R}->'id',
    'tenancyId', ${R}->'tenancyId',
    'customerId', ${R}->'customerId',
    'customerType', ${R}->'customerType',
    'productId', ${R}->'productId',
    'product', ${R}->'product',
    'productLineId', ${R}->'product'->'productLineId',
    'priceId', ${R}->'priceId',
    'quantity', ${R}->'quantity',
    'paymentProvider', to_jsonb(${provider}),
    'endedAtMillis', ${R}->'endedAtMillis',
    'chargedAmount', ${charged},
    'startTxnId', to_jsonb(${startTxnId}),
    'startProductGrantEntryIndex', to_jsonb(1),
    'startItemChangeBaseIndex', to_jsonb(${startItemChangeBaseIndex}),
    'itemRepeatSchedule', ${initRepeatSchedule},
    'outstandingGrants', ${initOutstandingGrants},
    'repeatCount', to_jsonb(0)
  )`;
  const initialHasRepeatSchedule = `(
    EXISTS (
      SELECT 1
      FROM jsonb_each(${initialState}->'itemRepeatSchedule') AS "sched"
      WHERE "sched"."value"->>'nextRepeatMillis' != 'null'
        AND "sched"."value"->'nextRepeatMillis' IS NOT NULL
    )
  )`;
  // Immediate-end shortcut: when endedAt is before the period end and there
  // are no repeat schedules, we can emit start+end in one shot. This handles
  // conflict replacements (endedAt=now) and terminal statuses (endedAt in the
  // past). Cancel-at-period-end (endedAt=currentPeriodEnd) goes through the
  // normal nextTimestamp path so the TimeFold clock controls when it fires.
  const initialShouldEmitImmediateEnd = `(
    ${initialState}->>'endedAtMillis' != 'null'
    AND ${initialState}->'endedAtMillis' IS NOT NULL
    AND NOT ${initialHasRepeatSchedule}
    AND (${R}->>'endedAtMillis')::numeric < (${R}->>'currentPeriodEndMillis')::numeric
  )`;

  // ── subscription-start event row ──
  const startEventItemGrants = `(
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'itemId', to_jsonb("item"."key"),
        'quantity', to_jsonb(("item"."value"->>'quantity')::numeric * (${R}->>'quantity')::numeric),
        'expiresWhen', CASE
          WHEN "item"."value"->>'expires' IN ('when-purchase-expires', 'when-repeated')
          THEN to_jsonb("item"."value"->>'expires')
          ELSE 'null'::jsonb
        END
      )
    ), '[]'::jsonb)
    FROM jsonb_each(${R}->'product'->'includedItems') AS "item"
  )`;

  const startEventRow = `jsonb_build_object(
    'type', '"subscription-start"'::jsonb,
    'subscriptionId', ${R}->'id',
    'tenancyId', ${R}->'tenancyId',
    'customerId', ${R}->'customerId',
    'customerType', ${R}->'customerType',
    'productId', ${R}->'productId',
    'product', ${R}->'product',
    'productLineId', ${R}->'product'->'productLineId',
    'priceId', ${R}->'priceId',
    'quantity', ${R}->'quantity',
    'chargedAmount', ${charged},
    'itemGrants', ${startEventItemGrants},
    'paymentProvider', to_jsonb(${provider}),
    'effectiveAtMillis', ${R}->'createdAtMillis',
    'createdAtMillis', ${R}->'createdAtMillis'
  )`;

  // ── Compute soonest next event time from state ──
  // min(all items' nextRepeatMillis, endedAtMillis)
  const soonestRepeatFromState = (stateSql: string) => `(
    SELECT MIN(("sched"."value"->>'nextRepeatMillis')::numeric)
    FROM jsonb_each(${stateSql}->'itemRepeatSchedule') AS "sched"
    WHERE "sched"."value"->>'nextRepeatMillis' != 'null'
      AND "sched"."value"->'nextRepeatMillis' IS NOT NULL
  )`;

  const nextTimestampFromState = (stateSql: string) => `(
    SELECT CASE
      WHEN "nextMillis"."millis" IS NULL THEN NULL::timestamptz
      ELSE to_timestamp("nextMillis"."millis" / 1000.0)
    END
    FROM (
      SELECT MIN("candidate"."millis") AS "millis"
      FROM (
        SELECT ${soonestRepeatFromState(stateSql)} AS "millis"
        UNION ALL
        SELECT CASE
          WHEN ${stateSql}->>'endedAtMillis' != 'null' AND ${stateSql}->'endedAtMillis' IS NOT NULL
          THEN (${stateSql}->>'endedAtMillis')::numeric
          ELSE NULL::numeric
        END AS "millis"
      ) AS "candidate"
      WHERE "candidate"."millis" IS NOT NULL
    ) AS "nextMillis"
  )`;

  // ── item-grant-repeat event ──
  // Emitted when timestamp matches an item's nextRepeatMillis.
  //
  // PG 12+ returns EXTRACT(EPOCH ...) as NUMERIC with scale 6 (microsecond
  // precision), so if we left currentMillis as NUMERIC it would serialize
  // into JSONB with trailing ".000000". That round-trips fine for our own
  // comparisons but leaks into txn IDs built by downstream tables via
  // `->>effectiveAtMillis`, producing e.g. `igr:<sub>:2592000000.000000`,
  // while references built inline in this algo via `::text` would produce
  // the decimal-free `igr:<sub>:2592000000`. The two wouldn't match →
  // `item-quantity-expire` entries would fail to resolve the grant they're
  // meant to expire, leaving `when-repeated` balances stuck after a
  // subscription-end that follows an item-grant-repeat.
  //
  // Explicit ROUND before the bigint cast: NUMERIC::bigint rounds
  // half-away-from-zero on PG 12+, which happens to match what we want,
  // but if `T` ever comes from a path that returns DOUBLE PRECISION (older
  // PG, or a future regression) the implicit cast rounds half-to-even and
  // could disagree on midpoint values. Being explicit about the rounding
  // intent is both self-documenting and stable across numeric types.
  const currentMillis = `(ROUND(EXTRACT(EPOCH FROM ${T}) * 1000)::bigint)`;

  // Items due at current timestamp
  const dueItems = `(
    SELECT jsonb_agg(jsonb_build_object('itemId', "sched"."key", 'schedule', "sched"."value"))
    FROM jsonb_each(${S}->'itemRepeatSchedule') AS "sched"
    WHERE "sched"."value"->>'nextRepeatMillis' != 'null'
      AND "sched"."value"->'nextRepeatMillis' IS NOT NULL
      AND ("sched"."value"->>'nextRepeatMillis')::numeric <= ${currentMillis}
  )`;

  // Is this timestamp the end event?
  const isEndEvent = `(
    ${hasEnded}
    AND (${S}->>'endedAtMillis')::numeric <= ${currentMillis}
  )`;

  // item-grant-repeat: txnId uses sourceId + effectiveAtMillis. currentMillis
  // is already ::bigint (see above) so plain ::text is enough — no decimal
  // tail, no redundant double-cast.
  const igrTxnId = `('igr:' || (${S}->>'subscriptionId') || ':' || ${currentMillis}::text)`;
  const repeatCount = `(${S}->>'repeatCount')::int`;

  // Build previousGrantsToExpire: outstanding grants with expiresWhen="when-repeated" that match due items
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

  // Build new item grants for the repeat
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
    'sourceType', '"subscription"'::jsonb,
    'sourceId', ${S}->'subscriptionId',
    'tenancyId', ${S}->'tenancyId',
    'customerId', ${S}->'customerId',
    'customerType', ${S}->'customerType',
    'itemGrants', ${igrItemGrants},
    'previousGrantsToExpire', ${previousGrantsToExpire},
    'paymentProvider', ${S}->'paymentProvider',
    'effectiveAtMillis', to_jsonb(${currentMillis}),
    'createdAtMillis', to_jsonb(${currentMillis})
  )`;

  // Updated state after item-grant-repeat:
  // 1. Remove expired "when-repeated" grants from outstandingGrants
  // 2. Add new grants with new txnId + entryIndex
  // 3. Advance nextRepeatMillis for due items
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

  const igrNewState = `${S} || jsonb_build_object(
    'outstandingGrants', ${igrUpdatedGrants},
    'itemRepeatSchedule', ${igrUpdatedSchedule},
    'repeatCount', to_jsonb(${repeatCount} + 1)
  )`;

  // ── subscription-end event ──
  // Expire all outstanding grants that are tied to the subscription's
  // lifetime — both 'when-purchase-expires' and 'when-repeated'. The latter
  // must be expired here too: otherwise the last-granted monthly quota
  // (emails_per_month, analytics_events, …) persists in the item-quantity
  // ledger after the subscription is gone and stacks on top of any
  // replacement subscription for the remainder of the period.
  //
  // Permanent grants (item has no `expires` configured, or an unrecognized
  // value) were normalized to JSONB null at subscription-start time, so
  // `"g"->>'expiresWhen'` returns SQL NULL for them and the IN predicate
  // correctly excludes them.
  //
  // outstandingGrants always carries the *current* grant ref for each item:
  // initially { txnId: 'sub-start:<sub>' }, and each item-grant-repeat tick
  // replaces the matching when-repeated entries with fresh ones keyed by
  // the igr txnId, so iterating here works identically pre- and post-repeat.
  const endItemQuantityChangesToExpire = (stateSql: string) => `(
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'transactionId', "g"->'txnId',
        'entryIndex', "g"->'entryIndex',
        'itemId', "g"->'itemId',
        'quantity', "g"->'quantity'
      )
    ), '[]'::jsonb)
    FROM jsonb_array_elements(${stateSql}->'outstandingGrants') AS "g"
    WHERE "g"->>'expiresWhen' IN ('when-purchase-expires', 'when-repeated')
  )`;

  const endEventRowFromState = (stateSql: string) => `jsonb_build_object(
    'type', '"subscription-end"'::jsonb,
    'subscriptionId', ${stateSql}->'subscriptionId',
    'tenancyId', ${stateSql}->'tenancyId',
    'customerId', ${stateSql}->'customerId',
    'customerType', ${stateSql}->'customerType',
    'productId', ${stateSql}->'productId',
    'productLineId', ${stateSql}->'productLineId',
    'quantity', ${stateSql}->'quantity',
    'startProductGrantRef', jsonb_build_object(
      'transactionId', ${stateSql}->'startTxnId',
      'entryIndex', ${stateSql}->'startProductGrantEntryIndex'
    ),
    'itemQuantityChangesToExpire', ${endItemQuantityChangesToExpire(stateSql)},
    'paymentProvider', ${stateSql}->'paymentProvider',
    'effectiveAtMillis', ${stateSql}->'endedAtMillis',
    'createdAtMillis', ${stateSql}->'endedAtMillis'
  )`;

  // ── Combine into reducer ──
  // The reducer must produce: "newState", "newRowsData", "nextTimestamp"
  return `
    CASE
      WHEN ${T} IS NULL THEN ${initialState}
      WHEN ${isEndEvent} THEN ${S}
      ELSE ${igrNewState}
    END AS "newState",

    CASE
      WHEN ${T} IS NULL AND ${initialShouldEmitImmediateEnd} THEN jsonb_build_array(${startEventRow}, ${endEventRowFromState(initialState)})
      WHEN ${T} IS NULL THEN jsonb_build_array(${startEventRow})
      WHEN ${isEndEvent} THEN jsonb_build_array(${endEventRowFromState(S)})
      ELSE jsonb_build_array(${igrEventRow})
    END AS "newRowsData",

    CASE
      WHEN ${T} IS NULL AND ${initialShouldEmitImmediateEnd} THEN NULL::timestamptz
      WHEN ${T} IS NULL THEN ${nextTimestampFromState(initialState)}
      WHEN ${isEndEvent} THEN NULL::timestamptz
      ELSE ${nextTimestampFromState(igrNewState)}
    END AS "nextTimestamp"
  `;
}
