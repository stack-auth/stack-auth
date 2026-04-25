import yup from "yup";
import { yupArray, yupMixed, yupNumber, yupObject, yupRecord, yupString } from "../schema-fields";

// Single source of truth for the `/internal/metrics` endpoint shape.
//
// Both the backend route handler (`apps/backend/src/app/api/latest/internal/metrics/route.tsx`)
// and the dashboard hook (`apps/dashboard/src/lib/stack-app-internals.ts`) import
// these schemas. The runtime validation lives in the schemas; the static types
// are derived via `yup.InferType` so we never have to keep parallel copies in
// sync.

export const MetricsDataPointSchema = yupObject({
  date: yupString().defined(),
  activity: yupNumber().defined(),
}).defined();

export const MetricsDataPointsSchema = yupArray(MetricsDataPointSchema).defined();

export const MetricsActivitySplitSchema = yupObject({
  total: MetricsDataPointsSchema,
  new: MetricsDataPointsSchema,
  retained: MetricsDataPointsSchema,
  reactivated: MetricsDataPointsSchema,
}).defined();

export const MetricsAuthOverviewSchema = yupObject({
  verified_users: yupNumber().integer().defined(),
  unverified_users: yupNumber().integer().defined(),
  anonymous_users: yupNumber().integer().defined(),
  total_teams: yupNumber().integer().defined(),
  mau: yupNumber().integer().defined(),
  daily_active_users_split: MetricsActivitySplitSchema,
  daily_active_teams_split: MetricsActivitySplitSchema,
  total_users_filtered: yupNumber().integer().defined(),
}).defined();

export const MetricsPaymentsOverviewSchema = yupObject({
  subscriptions_by_status: yupRecord(yupString().defined(), yupNumber().defined()).defined(),
  active_subscription_count: yupNumber().integer().defined(),
  total_one_time_purchases: yupNumber().integer().defined(),
  daily_subscriptions: MetricsDataPointsSchema,
  revenue_cents: yupNumber().integer().defined(),
  mrr_cents: yupNumber().integer().defined(),
  total_orders: yupNumber().integer().defined(),
  checkout_conversion_rate: yupNumber().defined(),
}).defined();

export const MetricsRecentEmailSchema = yupObject({
  id: yupString().defined(),
  status: yupString().defined(),
  subject: yupString().defined(),
  created_at_millis: yupNumber().defined(),
}).defined();

export const MetricsDailyEmailStatusBreakdownSchema = yupObject({
  date: yupString().defined(),
  ok: yupNumber().integer().defined(),
  error: yupNumber().integer().defined(),
  in_progress: yupNumber().integer().defined(),
}).defined();

export const MetricsEmailOverviewSchema = yupObject({
  emails_by_status: yupRecord(yupString().defined(), yupNumber().defined()).defined(),
  total_emails: yupNumber().integer().defined(),
  daily_emails: MetricsDataPointsSchema,
  daily_emails_by_status: yupArray(MetricsDailyEmailStatusBreakdownSchema).defined(),
  emails_sent: yupNumber().integer().defined(),
  recent_emails: yupArray(MetricsRecentEmailSchema).defined(),
  deliverability_status: yupObject({
    delivered: yupNumber().integer().defined(),
    bounced: yupNumber().integer().defined(),
    error: yupNumber().integer().defined(),
    in_progress: yupNumber().integer().defined(),
  }).defined(),
  deliverability_rate: yupNumber().defined(),
  bounce_rate: yupNumber().defined(),
  click_rate: yupNumber().defined(),
}).defined();

export const MetricsDailyRevenuePointSchema = yupObject({
  date: yupString().defined(),
  new_cents: yupNumber().integer().defined(),
  refund_cents: yupNumber().integer().defined(),
}).defined();

export const MetricsTopReferrerSchema = yupObject({
  referrer: yupString().defined(),
  visitors: yupNumber().integer().defined(),
}).defined();

export const MetricsTopRegionSchema = yupObject({
  country_code: yupString().nullable().defined(),
  region_code: yupString().nullable().defined(),
  count: yupNumber().integer().defined(),
}).defined();

export const MetricsAnalyticsOverviewSchema = yupObject({
  daily_page_views: MetricsDataPointsSchema,
  daily_clicks: MetricsDataPointsSchema,
  daily_visitors: MetricsDataPointsSchema,
  // Token-refresh-derived anonymous-visitor fallback. Populated only when the
  // analytics app isn't installed (no `$page-view` events) — counts DISTINCT
  // anonymous users per day from the events table. See
  // `loadAnonymousVisitorsFromTokenRefresh` in the backend metrics route.
  //
  // Optional for one release cycle so older clients/servers don't hard-fail
  // validation during a staged rollout. Tighten to `.defined()` after.
  daily_anonymous_visitors_fallback: yupArray(MetricsDataPointSchema).optional().default([]),
  daily_revenue: yupArray(MetricsDailyRevenuePointSchema).defined(),
  total_revenue_cents: yupNumber().integer().defined(),
  total_replays: yupNumber().integer().defined(),
  recent_replays: yupNumber().integer().defined(),
  visitors: yupNumber().integer().defined(),
  anonymous_visitors_fallback: yupNumber().integer().optional().default(0),
  avg_session_seconds: yupNumber().defined(),
  online_live: yupNumber().integer().defined(),
  revenue_per_visitor: yupNumber().defined(),
  top_referrers: yupArray(MetricsTopReferrerSchema).defined(),
  top_region: MetricsTopRegionSchema.nullable().defined(),
  // dev-fallback fields (only present in non-production environments)
  bounce_rate: yupNumber().optional(),
  conversion_rate: yupNumber().optional(),
  deltas: yupMixed().optional(),
}).defined();

export const MetricsLoginMethodEntrySchema = yupObject({
  method: yupString().defined(),
  count: yupNumber().integer().defined(),
}).defined();

// Recent user summary — a slim projection of UsersCrud["Admin"]["Read"] with
// just the fields the overview list views actually read. Defined here so the
// metrics response stays self-contained and doesn't pull in users-crud.
//
// `.noUnknown(false)` tells our strict object validator to allow the extra
// fields that the backend returns as part of the full users-crud payload —
// `is_anonymous`, `has_password`, `oauth_providers`, etc. — without rejecting
// them. Only the keys explicitly listed here are validated; extras pass through.
export const MetricsRecentUserSchema = yupObject({
  id: yupString().defined(),
  display_name: yupString().nullable().defined(),
  primary_email: yupString().nullable().defined(),
  profile_image_url: yupString().nullable().defined(),
  signed_up_at_millis: yupNumber().defined(),
  last_active_at_millis: yupNumber().nullable().defined(),
}).noUnknown(false).defined();

// Sampled "currently live" users keyed by ISO country code. Populated by
// joining a bounded ClickHouse sample (last N hours of `$token-refresh`
// events grouped by country) with the corresponding Prisma profile rows, so
// the overview globe can render real avatars of real users from each
// country. Optional for one release cycle so clients talking to older
// servers don't fail validation on the returned body.
export const MetricsActiveUsersByCountrySchema = yupRecord(
  yupString().defined(),
  yupArray(MetricsRecentUserSchema).defined(),
).optional().default({});

export const MetricsResponseBodySchema = yupObject({
  total_users: yupNumber().integer().defined(),
  // Count of distinct users seen refreshing a token in the last ~2 minutes —
  // the "who's online right now" number rendered on the overview globe. Derived
  // from the same `$token-refresh` window that powers `active_users_by_country`,
  // so it works for every project regardless of whether the analytics app
  // (page-view-based `analytics_overview.online_live`) is installed.
  //
  // Optional for one release cycle so older servers don't fail schema
  // validation on the returned body. Tighten to `.defined()` after.
  live_users: yupNumber().integer().optional().default(0),
  daily_users: MetricsDataPointsSchema,
  daily_active_users: MetricsDataPointsSchema,
  users_by_country: yupRecord(yupString().defined(), yupNumber().defined()).defined(),
  active_users_by_country: MetricsActiveUsersByCountrySchema,
  // recently_registered/active are CRUD User objects passed through from the
  // backend. The schema only validates the fields the dashboard actually
  // reads — extra fields from UsersCrud["Admin"]["Read"] are allowed through.
  recently_registered: yupArray(MetricsRecentUserSchema).defined(),
  recently_active: yupArray(MetricsRecentUserSchema).defined(),
  login_methods: yupArray(MetricsLoginMethodEntrySchema).defined(),
  auth_overview: MetricsAuthOverviewSchema,
  payments_overview: MetricsPaymentsOverviewSchema,
  email_overview: MetricsEmailOverviewSchema,
  analytics_overview: MetricsAnalyticsOverviewSchema,
}).defined();

// Derived static types — single source of truth lives in the schemas above.
export type MetricsDataPoint = yup.InferType<typeof MetricsDataPointSchema>;
export type MetricsActivitySplit = yup.InferType<typeof MetricsActivitySplitSchema>;
export type MetricsAuthOverview = yup.InferType<typeof MetricsAuthOverviewSchema>;
export type MetricsPaymentsOverview = yup.InferType<typeof MetricsPaymentsOverviewSchema>;
export type MetricsRecentEmail = yup.InferType<typeof MetricsRecentEmailSchema>;
export type MetricsDailyEmailStatusBreakdown = yup.InferType<typeof MetricsDailyEmailStatusBreakdownSchema>;
export type MetricsEmailOverview = yup.InferType<typeof MetricsEmailOverviewSchema>;
export type MetricsDailyRevenuePoint = yup.InferType<typeof MetricsDailyRevenuePointSchema>;
export type MetricsTopReferrer = yup.InferType<typeof MetricsTopReferrerSchema>;
export type MetricsTopRegion = yup.InferType<typeof MetricsTopRegionSchema>;
export type MetricsAnalyticsOverview = yup.InferType<typeof MetricsAnalyticsOverviewSchema>;
export type MetricsLoginMethodEntry = yup.InferType<typeof MetricsLoginMethodEntrySchema>;
export type MetricsRecentUser = yup.InferType<typeof MetricsRecentUserSchema>;
export type MetricsResponse = yup.InferType<typeof MetricsResponseBodySchema>;
