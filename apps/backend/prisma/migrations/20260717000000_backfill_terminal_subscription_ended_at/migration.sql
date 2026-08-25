-- Terminal subscription rows written before endedAt was derived on every sync
-- (and terminal-on-first-sync rows, whose create path never set it) have
-- endedAt = NULL. The status-agnostic isSubscriptionInEffect predicate reads
-- NULL as "entitled forever", so these rows must be closed out.
--
-- endedAt = LEAST(currentPeriodEnd, now) mirrors getEndedAtForSync's
-- fallback when Stripe omits ended_at: the paid-through boundary if it's
-- already past, otherwise now. NOW() AT TIME ZONE 'UTC' yields a naive UTC
-- timestamp matching the timezone-less columns (which the app always writes
-- as UTC); bare NOW() would be shifted by the session offset on non-UTC
-- sessions when cast into "endedAt".
--
-- No batching/temp-index machinery: the affected population was measured in
-- production at 7 rows (2026-07-17), and a plain UPDATE only takes row locks
-- on matching rows, so the seq scan is safe regardless of table size.
UPDATE "Subscription"
SET "endedAt" = LEAST("currentPeriodEnd", NOW() AT TIME ZONE 'UTC')
WHERE "status" IN ('canceled', 'incomplete_expired', 'unpaid')
  AND "endedAt" IS NULL;
