/**
 * The catalog of growth metrics the growth agent can reason about, as plain data.
 *
 * Three availability tiers:
 * - "stored": rolled up into ClickHouse `growth_daily_metrics` (or `growth_daily_ad_metrics` for
 *   ads) by metric-store.ts, one Float64 per (metric_id, date).
 * - "on_the_fly": not materialized; instead ships a ready-to-run ClickHouse SQL template against
 *   the `default.*` views. Templates NEVER filter by project_id/branch_id — the limited ClickHouse
 *   user's row policies scope every query, and adding the filter would teach the agent a pattern
 *   that breaks (and looks suspicious) under row-level security.
 * - "not_possible": listed so the agent can explain the gap instead of hallucinating a query; the
 *   description says what data would unlock it.
 *
 * The catalog is serialized to the agent by the metrics-context route (chunk N3), and
 * metric-store.ts derives its rollup from the "stored" entries. Keep descriptions agent-facing:
 * they are the only semantics documentation the agent sees.
 */

export type GrowthCatalogMetric = {
  id: string, // snake_case; distinct namespace from the legacy 6 GROWTH_METRIC_IDS
  label: string,
  unit: "count" | "cents" | "percent" | "seconds" | "minor_units",
  category: "users" | "engagement" | "web" | "email" | "revenue" | "teams" | "ads" | "derived",
  availability: "stored" | "on_the_fly" | "not_possible",
  kind: "flow" | "snapshot", // flow = value for that day; snapshot = state as of rollup time
  timezone: "utc" | "ad_account",
  backfillable: boolean,
  legacyIdNote?: string, // required for entries that map to one of the legacy 6
  sqlTemplate?: string, // required iff availability === "on_the_fly"; ClickHouse SQL against default.* views
  description: string, // agent-facing semantics incl. window / caveats
};

/**
 * Every table the growth agent's limited ClickHouse user can SELECT from (the `default.*` views).
 * MUST stay in sync with the `tables` array in apps/backend/scripts/clickhouse-migrations.ts —
 * that array drives the row policies and GRANTs, this one drives catalog validation and the
 * metrics-context payload. metric-catalog.test.ts pins both so drift fails loudly.
 */
export const GROWTH_AGENT_QUERYABLE_TABLES = [
  "events",
  "users",
  "contact_channels",
  "teams",
  "team_member_profiles",
  "team_permissions",
  "team_invitations",
  "email_outboxes",
  "project_permissions",
  "notification_preferences",
  "refresh_tokens",
  "connected_accounts",
  "growth_daily_metrics",
  "growth_daily_ad_metrics",
] as const;

// ── Stored metrics ───────────────────────────────────────────────────────────

const STORED_METRICS: GrowthCatalogMetric[] = [
  // — users —
  {
    id: "total_users",
    label: "Total users",
    unit: "count",
    category: "users",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    // Snapshot, but reconstructible: current total minus signups after each day. Deleted users make
    // the reconstruction approximate, which is fine for trend display.
    backfillable: true,
    legacyIdNote: "Same value as the legacy `total_users` growth metric.",
    description: "All-time count of non-anonymous, non-deleted users as of the rollup. Historical days are reconstructed cumulatively (current total minus later signups), so days before a user deletion are slightly approximate.",
  },
  {
    id: "new_users",
    label: "New users",
    unit: "count",
    category: "users",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    legacyIdNote: "The legacy `new_signups` growth metric equals the trailing-30-day sum of new_users.",
    description: "Non-anonymous users who signed up on that UTC day.",
  },
  {
    id: "verified_users",
    label: "Verified users",
    unit: "count",
    category: "users",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Non-anonymous users with a verified primary email, as of the rollup. Not backfillable: verification state is only known as-of-now.",
  },
  {
    id: "unverified_users",
    label: "Unverified users",
    unit: "count",
    category: "users",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Non-anonymous users without a verified primary email, as of the rollup. verified_users + unverified_users + anonymous_users = all users.",
  },
  {
    id: "anonymous_users",
    label: "Anonymous users",
    unit: "count",
    category: "users",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Anonymous/guest users as of the rollup. Excluded from every other user metric.",
  },
  // — engagement —
  {
    id: "dau",
    label: "Daily active users",
    unit: "count",
    category: "engagement",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    description: "Distinct non-anonymous users with at least one session token refresh on that UTC day.",
  },
  {
    id: "retained_users",
    label: "Retained users",
    unit: "count",
    category: "engagement",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Users active on that day who were also active the previous day (and not first seen that day).",
  },
  {
    id: "reactivated_users",
    label: "Reactivated users",
    unit: "count",
    category: "engagement",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Users active on that day after a gap of 2+ days (and not first seen that day).",
  },
  {
    id: "returning_users_daily",
    label: "Returning users",
    unit: "count",
    category: "engagement",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    legacyIdNote: "The legacy `returning_users` growth metric equals the trailing-30-day sum of returning_users_daily (a user returning on several days counts once per day).",
    description: "retained_users + reactivated_users for that day: active users who were not first seen that day.",
  },
  {
    id: "mau",
    label: "Monthly active users",
    unit: "count",
    category: "engagement",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Distinct non-anonymous users active in the trailing 30 days, as of the rollup.",
  },
  // — teams —
  {
    id: "total_teams",
    label: "Total teams",
    unit: "count",
    category: "teams",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "All-time count of non-deleted teams as of the rollup.",
  },
  {
    id: "new_teams",
    label: "New teams",
    unit: "count",
    category: "teams",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Teams first seen active on that UTC day (first team-scoped session activity, not creation date).",
  },
  {
    id: "active_teams",
    label: "Active teams",
    unit: "count",
    category: "teams",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Distinct teams with at least one member session on that UTC day.",
  },
  // — web —
  {
    id: "page_views",
    label: "Page views",
    unit: "count",
    category: "web",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    description: "Page-view events on that UTC day, from non-anonymous users. Requires the analytics app; days without it installed have no rows.",
  },
  {
    id: "clicks",
    label: "Clicks",
    unit: "count",
    category: "web",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    description: "Click events on that UTC day, from non-anonymous users. Requires the analytics app.",
  },
  {
    id: "visitors",
    label: "Visitors",
    unit: "count",
    category: "web",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    description: "Distinct non-anonymous users with at least one page view on that UTC day. Requires the analytics app.",
  },
  {
    id: "bounce_rate",
    label: "Bounce rate",
    unit: "percent",
    category: "web",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Share of sessions on that day with exactly one page view, 0-100. Session = one browser tab's replay segment.",
  },
  {
    id: "avg_session_seconds",
    label: "Average session length",
    unit: "seconds",
    category: "web",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Mean session duration in seconds for sessions starting that day (first to last event within the session).",
  },
  // — email —
  {
    id: "emails_created",
    label: "Emails created",
    unit: "count",
    category: "email",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    description: "Outbox email rows created on that UTC day, across all statuses. Creation date, not delivery date.",
  },
  {
    id: "emails_ok",
    label: "Emails OK",
    unit: "count",
    category: "email",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Emails created that day whose current simple status is OK. Status is as of rollup time, so recent days can shift as in-progress emails settle.",
  },
  {
    id: "emails_error",
    label: "Emails errored",
    unit: "count",
    category: "email",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Emails created that day whose current simple status is ERROR. Status is as of rollup time.",
  },
  {
    id: "emails_sent_total",
    label: "Total emails sent",
    unit: "count",
    category: "email",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    legacyIdNote: "Same value as the legacy `emails_sent` growth metric (all-time finished sends).",
    description: "All-time count of emails that finished sending, as of the rollup.",
  },
  {
    id: "email_deliverability_rate",
    label: "Email deliverability rate",
    unit: "percent",
    category: "email",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "All-time delivered / finished-sending, 0-100, as of the rollup.",
  },
  {
    id: "email_bounce_rate",
    label: "Email bounce rate",
    unit: "percent",
    category: "email",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "All-time bounced / finished-sending, 0-100, as of the rollup.",
  },
  {
    id: "email_click_rate",
    label: "Email click rate",
    unit: "percent",
    category: "email",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "All-time clicked / finished-sending, 0-100, as of the rollup.",
  },
  // — revenue —
  {
    id: "revenue_cents",
    label: "Revenue",
    unit: "cents",
    category: "revenue",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    legacyIdNote: "The legacy `revenue` growth metric equals the trailing-30-day sum of revenue_cents.",
    description: "Paid/succeeded subscription-invoice revenue in cents, by invoice creation day (UTC).",
  },
  {
    id: "refund_cents",
    label: "Refunds",
    unit: "cents",
    category: "revenue",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    description: "Refunded amount in cents per day. Currently always 0 — refunds are not yet tracked as first-class data; the column exists so history is continuous once they are.",
  },
  {
    id: "new_subscriptions",
    label: "New subscriptions",
    unit: "count",
    category: "revenue",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: true,
    description: "Subscriptions created on that UTC day (any status).",
  },
  {
    id: "active_subscriptions",
    label: "Active subscriptions",
    unit: "count",
    category: "revenue",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Subscriptions currently in status active, as of the rollup.",
  },
  {
    id: "canceled_subscriptions",
    label: "Canceled subscriptions",
    unit: "count",
    category: "revenue",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Subscriptions currently in status canceled, as of the rollup.",
  },
  {
    id: "mrr_cents_proxy",
    label: "MRR (proxy)",
    unit: "cents",
    category: "revenue",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "A trailing-30-day proxy for MRR: paid invoice revenue in cents over the last 30 days as of the rollup. NOT true MRR — it conflates one-time and recurring revenue and ignores billing cadence.",
  },
  {
    id: "total_orders",
    label: "Total orders",
    unit: "count",
    category: "revenue",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    legacyIdNote: "Same value as the legacy `transactions` growth metric (all-time one-time purchases plus subscription invoices).",
    description: "All-time one-time purchases plus subscription invoices, as of the rollup.",
  },
  {
    id: "total_one_time_purchases",
    label: "Total one-time purchases",
    unit: "count",
    category: "revenue",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "All-time one-time purchases, as of the rollup.",
  },
  {
    id: "checkout_conversion_rate",
    label: "Checkout conversion rate",
    unit: "percent",
    category: "revenue",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "All-time successful checkouts / total orders, 0-100, as of the rollup.",
  },
  // — derived —
  {
    id: "visitor_signup_rate",
    label: "Visitor signup rate",
    unit: "percent",
    category: "derived",
    availability: "stored",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "new_users / visitors * 100 for that day. Days with zero visitors have NO row (rather than a fake 0 or infinity), so gaps mean no traffic data, not 0% conversion.",
  },
  {
    id: "dau_mau_stickiness",
    label: "DAU/MAU stickiness",
    unit: "percent",
    category: "derived",
    availability: "stored",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Latest-day DAU divided by trailing-30-day MAU, 0-100, as of the rollup. Missing when MAU is 0.",
  },
  // — ads (stored in the SEPARATE growth_daily_ad_metrics table) —
  {
    id: "ad_spend_minor",
    label: "Ad spend",
    unit: "minor_units",
    category: "ads",
    availability: "stored",
    kind: "flow",
    timezone: "ad_account",
    backfillable: false,
    description: "Daily ad spend in the account currency's minor units. Lives in `growth_daily_ad_metrics` (columns spend_minor, currency, account_timezone), NOT growth_daily_metrics; dates there are the AD ACCOUNT's local day exactly as the platform reports it, never UTC. Historical ranges are imported via the ad-metrics writer with an explicit date range, not the generic backfill.",
  },
  {
    id: "ad_impressions",
    label: "Ad impressions",
    unit: "count",
    category: "ads",
    availability: "stored",
    kind: "flow",
    timezone: "ad_account",
    backfillable: false,
    description: "Daily ad impressions per ad account. Lives in `growth_daily_ad_metrics` (column impressions) with account-local dates — see ad_spend_minor for the timezone caveat.",
  },
  {
    id: "ad_clicks",
    label: "Ad clicks",
    unit: "count",
    category: "ads",
    availability: "stored",
    kind: "flow",
    timezone: "ad_account",
    backfillable: false,
    description: "Daily ad clicks per ad account. Lives in `growth_daily_ad_metrics` (column clicks) with account-local dates — see ad_spend_minor for the timezone caveat.",
  },
];

// ── On-the-fly metrics ───────────────────────────────────────────────────────
// Real, runnable ClickHouse SQL against the default.* views. Row policies scope every query to the
// caller's project/branch, so the templates must not (and do not) mention project_id/branch_id.
// JSON event payloads are read via toString(data) + JSONExtractString, per the analytics query docs.

const ON_THE_FLY_METRICS: GrowthCatalogMetric[] = [
  {
    id: "utm_source_breakdown",
    label: "UTM source breakdown",
    unit: "count",
    category: "web",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Visitors and page views per utm_source over the last 30 days, extracted from the page-view URL query string. Rows without a utm_source parameter are excluded.",
    sqlTemplate: `
SELECT
  extractURLParameter(JSONExtractString(toString(data), 'url'), 'utm_source') AS utm_source,
  uniqExact(assumeNotNull(user_id)) AS visitors,
  count() AS page_views
FROM events
WHERE event_type = '$page-view'
  AND user_id IS NOT NULL
  AND event_at >= now() - INTERVAL 30 DAY
  AND extractURLParameter(JSONExtractString(toString(data), 'url'), 'utm_source') != ''
GROUP BY utm_source
ORDER BY visitors DESC
LIMIT 50`.trim(),
  },
  {
    id: "paid_click_landings",
    label: "Paid-click landing pages",
    unit: "count",
    category: "web",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Landing paths of page views arriving with an fbclid parameter (Meta paid clicks) over the last 30 days. Only catches click-through traffic that kept the parameter.",
    sqlTemplate: `
SELECT
  JSONExtractString(toString(data), 'path') AS landing_path,
  count() AS page_views,
  uniqExact(assumeNotNull(user_id)) AS visitors
FROM events
WHERE event_type = '$page-view'
  AND user_id IS NOT NULL
  AND event_at >= now() - INTERVAL 30 DAY
  AND extractURLParameter(JSONExtractString(toString(data), 'url'), 'fbclid') != ''
GROUP BY landing_path
ORDER BY visitors DESC
LIMIT 50`.trim(),
  },
  {
    id: "top_pages",
    label: "Top pages",
    unit: "count",
    category: "web",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Most-viewed paths by page views and distinct visitors over the last 30 days.",
    sqlTemplate: `
SELECT
  JSONExtractString(toString(data), 'path') AS path,
  count() AS page_views,
  uniqExact(assumeNotNull(user_id)) AS visitors
FROM events
WHERE event_type = '$page-view'
  AND user_id IS NOT NULL
  AND event_at >= now() - INTERVAL 30 DAY
GROUP BY path
ORDER BY page_views DESC
LIMIT 50`.trim(),
  },
  {
    id: "landing_pages",
    label: "Landing pages",
    unit: "count",
    category: "web",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "First path each user hit per day (argMin by event time) over the last 30 days — approximates session entry pages.",
    sqlTemplate: `
SELECT landing_path, count() AS user_days
FROM (
  SELECT
    assumeNotNull(user_id) AS uid,
    toDate(event_at) AS day,
    argMin(JSONExtractString(toString(data), 'path'), event_at) AS landing_path
  FROM events
  WHERE event_type = '$page-view'
    AND user_id IS NOT NULL
    AND event_at >= now() - INTERVAL 30 DAY
  GROUP BY uid, day
)
GROUP BY landing_path
ORDER BY user_days DESC
LIMIT 50`.trim(),
  },
  {
    id: "referrer_domains",
    label: "Referrer domains",
    unit: "count",
    category: "web",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Distinct visitors per referrer domain over the last 30 days; empty referrers are grouped as (direct).",
    sqlTemplate: `
SELECT
  if(referrer = '', '(direct)', domain(referrer)) AS referrer_domain,
  uniqExact(uid) AS visitors
FROM (
  SELECT
    assumeNotNull(user_id) AS uid,
    JSONExtractString(toString(data), 'referrer') AS referrer
  FROM events
  WHERE event_type = '$page-view'
    AND user_id IS NOT NULL
    AND event_at >= now() - INTERVAL 30 DAY
)
GROUP BY referrer_domain
ORDER BY visitors DESC
LIMIT 50`.trim(),
  },
  {
    id: "activation_rate_7d",
    label: "7-day activation rate",
    unit: "percent",
    category: "users",
    availability: "on_the_fly",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Share of users signed up 7-37 days ago who came back for a session between 1 and 7 days after signup. The cohort ends 7 days ago so every member had the full window.",
    sqlTemplate: `
SELECT
  count() AS cohort_users,
  countIf(activated = 1) AS activated_users,
  round(100 * countIf(activated = 1) / nullIf(count(), 0), 1) AS activation_rate_pct
FROM (
  SELECT
    u.id AS user_id,
    max(if(e.event_at > u.signed_up_at + INTERVAL 1 DAY AND e.event_at <= u.signed_up_at + INTERVAL 7 DAY, 1, 0)) AS activated
  FROM users AS u
  LEFT JOIN events AS e ON toString(u.id) = assumeNotNull(e.user_id) AND e.event_type = '$token-refresh'
  WHERE u.is_anonymous = 0
    AND u.signed_up_at >= now() - INTERVAL 37 DAY
    AND u.signed_up_at < now() - INTERVAL 7 DAY
  GROUP BY user_id
)`.trim(),
  },
  {
    id: "weekly_cohort_retention",
    label: "Weekly cohort retention",
    unit: "count",
    category: "engagement",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Classic cohort triangle: for each signup week in the last 90 days, distinct users active in each subsequent week. Divide by week 0 to get retention percentages.",
    sqlTemplate: `
SELECT
  toStartOfWeek(u.signed_up_at) AS cohort_week,
  dateDiff('week', toStartOfWeek(u.signed_up_at), toStartOfWeek(toDate(e.event_at))) AS weeks_since_signup,
  uniqExact(u.id) AS active_users
FROM users AS u
INNER JOIN events AS e ON toString(u.id) = assumeNotNull(e.user_id)
WHERE u.is_anonymous = 0
  AND u.signed_up_at >= now() - INTERVAL 90 DAY
  AND e.event_type = '$token-refresh'
  AND e.event_at >= u.signed_up_at
GROUP BY cohort_week, weeks_since_signup
ORDER BY cohort_week, weeks_since_signup`.trim(),
  },
  {
    id: "median_time_to_first_return",
    label: "Median time to first return",
    unit: "seconds",
    category: "engagement",
    availability: "on_the_fly",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Median seconds between signup and the first session at least 6 hours later, for users signed up in the last 90 days who returned at all. The 6-hour floor excludes the signup session itself.",
    sqlTemplate: `
SELECT round(median(seconds_to_first_return)) AS median_seconds_to_first_return
FROM (
  SELECT
    toString(u.id) AS uid,
    min(dateDiff('second', u.signed_up_at, e.event_at)) AS seconds_to_first_return
  FROM users AS u
  INNER JOIN events AS e ON toString(u.id) = assumeNotNull(e.user_id)
  WHERE u.is_anonymous = 0
    AND u.signed_up_at >= now() - INTERVAL 90 DAY
    AND e.event_type = '$token-refresh'
    AND e.event_at >= u.signed_up_at + INTERVAL 6 HOUR
  GROUP BY uid
)`.trim(),
  },
  {
    id: "signups_by_country",
    label: "Signups by country",
    unit: "count",
    category: "users",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Signups in the last 30 days grouped by the country of the user's earliest session IP. Users whose sessions carried no IP geo data are excluded.",
    sqlTemplate: `
SELECT country_code, count() AS signups
FROM (
  SELECT
    assumeNotNull(user_id) AS uid,
    argMin(JSONExtractString(toString(data), 'ip_info', 'country_code'), event_at) AS country_code
  FROM events
  WHERE event_type = '$token-refresh'
    AND user_id IS NOT NULL
    AND event_at >= now() - INTERVAL 30 DAY
  GROUP BY uid
) AS geo
INNER JOIN users AS u ON toString(u.id) = geo.uid
WHERE u.is_anonymous = 0
  AND u.signed_up_at >= now() - INTERVAL 30 DAY
  AND country_code != ''
GROUP BY country_code
ORDER BY signups DESC`.trim(),
  },
  {
    id: "traffic_heatmap",
    label: "Traffic heatmap",
    unit: "count",
    category: "web",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Page views bucketed by weekday (1=Monday) and UTC hour over the last 30 days. Hours are UTC — shift to the audience timezone before drawing conclusions about local behavior.",
    sqlTemplate: `
SELECT
  toDayOfWeek(event_at) AS weekday,
  toHour(event_at) AS hour_utc,
  count() AS page_views
FROM events
WHERE event_type = '$page-view'
  AND event_at >= now() - INTERVAL 30 DAY
GROUP BY weekday, hour_utc
ORDER BY weekday, hour_utc`.trim(),
  },
  {
    id: "events_per_active_user",
    label: "Events per active user",
    unit: "count",
    category: "engagement",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Daily engagement depth: total events divided by distinct active users, per UTC day, over the last 30 days.",
    sqlTemplate: `
SELECT
  toDate(event_at) AS day,
  count() AS events,
  uniqExact(assumeNotNull(user_id)) AS active_users,
  round(count() / nullIf(uniqExact(assumeNotNull(user_id)), 0), 2) AS events_per_active_user
FROM events
WHERE user_id IS NOT NULL
  AND event_at >= now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day`.trim(),
  },
  {
    id: "email_engagement_over_time",
    label: "Email engagement over time",
    unit: "count",
    category: "email",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Daily emails created, delivered, clicked, and bounced over the last 90 days, bucketed by creation day. Delivery timestamps can lag creation by days, so recent days undercount engagement.",
    sqlTemplate: `
SELECT
  toDate(created_at) AS day,
  count() AS emails_created,
  countIf(delivered_at IS NOT NULL) AS delivered,
  countIf(clicked_at IS NOT NULL) AS clicked,
  countIf(bounced_at IS NOT NULL) AS bounced
FROM email_outboxes
WHERE created_at >= now() - INTERVAL 90 DAY
GROUP BY day
ORDER BY day`.trim(),
  },
  {
    id: "login_method_mix",
    label: "Login method mix",
    unit: "count",
    category: "users",
    availability: "on_the_fly",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Distinct users per connected OAuth/SSO provider, all-time. Only covers OAuth-style logins — password/OTP/passkey users have no connected account and do not appear here.",
    sqlTemplate: `
SELECT provider, uniqExact(user_id) AS users
FROM connected_accounts
GROUP BY provider
ORDER BY users DESC`.trim(),
  },
  {
    id: "team_size_distribution",
    label: "Team size distribution",
    unit: "count",
    category: "teams",
    availability: "on_the_fly",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Histogram of current team sizes: how many teams have N members.",
    sqlTemplate: `
SELECT member_count, count() AS teams
FROM (
  SELECT team_id, uniqExact(user_id) AS member_count
  FROM team_member_profiles
  GROUP BY team_id
)
GROUP BY member_count
ORDER BY member_count`.trim(),
  },
  {
    id: "stored_metric_wow_growth",
    label: "Week-over-week metric growth",
    unit: "percent",
    category: "derived",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Week-over-week growth of every stored flow metric, from growth_daily_metrics over the last 8 weeks. Weekly values are sums of daily values, so this only makes sense for flow metrics (summing snapshots like mau is meaningless — filter metric_id accordingly).",
    sqlTemplate: `
SELECT
  metric_id,
  week_start,
  weekly_value,
  round(100 * (weekly_value - prev_weekly_value) / nullIf(prev_weekly_value, 0), 1) AS wow_growth_pct
FROM (
  SELECT
    metric_id,
    week_start,
    weekly_value,
    lagInFrame(weekly_value, 1) OVER (PARTITION BY metric_id ORDER BY week_start) AS prev_weekly_value
  FROM (
    SELECT metric_id, toStartOfWeek(date) AS week_start, sum(value) AS weekly_value
    FROM growth_daily_metrics
    WHERE date >= today() - 56
    GROUP BY metric_id, week_start
  )
)
ORDER BY metric_id, week_start`.trim(),
  },
  {
    id: "blended_cac_roas",
    label: "Blended CAC and ROAS",
    unit: "percent",
    category: "ads",
    availability: "on_the_fly",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Daily blended CAC (ad spend / new users) and a ROAS proxy (revenue / spend), joining growth_daily_metrics with growth_daily_ad_metrics by date. IMPORTANT caveat: growth_daily_metrics dates are UTC days while growth_daily_ad_metrics dates are the ad account's LOCAL day, so the join can be off by up to plus-or-minus 1 day — always state the timezone basis when reporting these numbers, and prefer multi-day windows over single-day reads. Also note spend is in the ad account currency's minor units while revenue is in cents; the ratio is only meaningful when the two currencies match.",
    sqlTemplate: `
WITH ad_spend AS (
  SELECT date, sum(spend_minor) AS spend_minor, sum(clicks) AS ad_clicks
  FROM growth_daily_ad_metrics
  WHERE date >= today() - 30
  GROUP BY date
),
core AS (
  SELECT
    date,
    sumIf(value, metric_id = 'new_users') AS new_users,
    sumIf(value, metric_id = 'revenue_cents') AS revenue_cents
  FROM growth_daily_metrics
  WHERE date >= today() - 30
  GROUP BY date
)
SELECT
  core.date AS date,
  ad_spend.spend_minor AS spend_minor,
  ad_spend.ad_clicks AS ad_clicks,
  core.new_users AS new_users,
  core.revenue_cents AS revenue_cents,
  round(ad_spend.spend_minor / nullIf(core.new_users, 0), 2) AS blended_cac_minor,
  round(core.revenue_cents / nullIf(ad_spend.spend_minor, 0), 2) AS roas_proxy
FROM core
INNER JOIN ad_spend ON core.date = ad_spend.date
ORDER BY core.date`.trim(),
  },
];

// ── Not-possible metrics ─────────────────────────────────────────────────────

const NOT_POSSIBLE_METRICS: GrowthCatalogMetric[] = [
  {
    id: "age_gender_demographics",
    label: "Age/gender demographics",
    unit: "count",
    category: "users",
    availability: "not_possible",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Not possible: no age or gender data is collected anywhere in the platform (only IP-derived geo). Would require the application to collect demographic profile fields and sync them into the users view.",
  },
  {
    id: "custom_product_events",
    label: "Custom product events",
    unit: "count",
    category: "engagement",
    availability: "not_possible",
    kind: "flow",
    timezone: "utc",
    backfillable: false,
    description: "Not possible: the analytics SDK only auto-captures $page-view, $click, and $token-refresh — there is no API for applications to emit custom named events (e.g. 'project_created'). Would require a custom-event ingestion endpoint plus SDK support.",
  },
  {
    id: "platform_conversions_attribution",
    label: "Ad conversion attribution",
    unit: "count",
    category: "ads",
    availability: "not_possible",
    kind: "flow",
    timezone: "ad_account",
    backfillable: false,
    description: "Not possible: attributing signups or revenue to specific ad campaigns needs conversion tracking (a pixel/CAPI feeding platform-attributed conversions, or click-ID capture joined to signups). Only account-level spend/impressions/clicks are stored today. paid_click_landings gives a weak fbclid-based proxy.",
  },
  {
    id: "email_open_rate",
    label: "Email open rate",
    unit: "percent",
    category: "email",
    availability: "not_possible",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Not possible: the email_outboxes schema has an opened_at column but no open-tracking pixel populates it, so any computed rate would be a misleading 0. Click and bounce rates are tracked and available instead. Would require enabling open tracking in the email delivery pipeline (and accepting its unreliability under mail-client prefetching).",
  },
  {
    id: "per_user_ltv",
    label: "Per-user lifetime value",
    unit: "cents",
    category: "revenue",
    availability: "not_possible",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Not possible: revenue is aggregated from subscription invoices without a reliable per-user attribution surface in the analytics views (invoices are not synced to ClickHouse, and Postgres revenue rows are keyed by subscription, not exposed per user here). Would require syncing invoices with their owning user into an analytics view.",
  },
  {
    id: "historical_state_snapshots",
    label: "Historical state snapshots",
    unit: "count",
    category: "users",
    availability: "not_possible",
    kind: "snapshot",
    timezone: "utc",
    backfillable: false,
    description: "Not possible for the past: snapshot metrics (mau, verified_users, active_subscriptions, ...) only exist from the day the rollup started running — there is no time-travel view of past state. Going forward the daily rollup accumulates them. total_users is the one exception (reconstructed from signup dates).",
  },
];

export const GROWTH_METRIC_CATALOG: readonly GrowthCatalogMetric[] = [
  ...STORED_METRICS,
  ...ON_THE_FLY_METRICS,
  ...NOT_POSSIBLE_METRICS,
];
