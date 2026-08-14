import {
  loadActiveUsersByCountry,
  loadAnalyticsOverview,
  loadAuthOverview,
  loadDailyActiveUsers,
  loadDailyRevenue,
  loadEmailOverview,
  loadHourlyActiveUsers,
  loadHourlyUsers,
  loadLiveUsersCount,
  loadLoginMethods,
  loadPaymentsOverview,
  loadRecentlyActiveUsers,
  loadTotalUsers,
  loadUsersByCountry,
  normalizeAnalyticsOverviewFilters,
  RECENT_LIST_PAGE_SIZE,
} from "@/lib/metrics/loaders";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import {
  MetricsActiveUsersByCountrySchema,
  MetricsAnalyticsOverviewSchema,
  MetricsAuthOverviewSchema,
  MetricsDataPointsSchema as DataPointsSchema,
  MetricsEmailOverviewSchema,
  MetricsLoginMethodEntrySchema,
  MetricsPaymentsOverviewSchema,
  MetricsRecentUserSchema,
} from "@hexclave/shared/dist/interface/admin-metrics";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupRecord, yupString } from "@hexclave/shared/dist/schema-fields";
import { usersCrudHandlers } from "../../users/crud";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
    query: yupObject({
      include_anonymous: yupString().oneOf(["true", "false"]).optional(),
      filter_country_code: yupString().optional(),
      filter_referrer: yupString().optional(),
      filter_browser: yupString().optional(),
      filter_os: yupString().optional(),
      filter_device: yupString().optional(),
      // ISO 8601 datetimes bounding the analytics top-N breakdowns (referrers,
      // regions, browsers/OS/devices); clamped to the analytics window.
      filter_since: yupString().optional(),
      filter_until: yupString().optional(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      total_users: yupNumber().integer().defined(),
      live_users: yupNumber().integer().defined(),
      daily_users: DataPointsSchema,
      daily_active_users: DataPointsSchema,
      hourly_users: DataPointsSchema,
      hourly_active_users: DataPointsSchema,
      users_by_country: yupRecord(yupString().defined(), yupNumber().defined()).defined(),
      active_users_by_country: MetricsActiveUsersByCountrySchema,
      // recently_registered/active are CRUD User objects passed through from
      // usersCrudHandlers. Validated against MetricsRecentUserSchema, which
      // covers the fields the dashboard reads — extra fields from
      // UsersCrud["Admin"]["Read"] flow through.
      recently_registered: yupArray(MetricsRecentUserSchema).defined(),
      recently_active: yupArray(MetricsRecentUserSchema).defined(),
      login_methods: yupArray(MetricsLoginMethodEntrySchema).defined(),
      auth_overview: MetricsAuthOverviewSchema,
      payments_overview: MetricsPaymentsOverviewSchema,
      email_overview: MetricsEmailOverviewSchema,
      analytics_overview: MetricsAnalyticsOverviewSchema,
    }).defined(),
  }),
  handler: async (req) => {
    const now = new Date();
    const includeAnonymous = req.query.include_anonymous === "true";
    const analyticsFilters = normalizeAnalyticsOverviewFilters({
      country_code: req.query.filter_country_code || undefined,
      referrer: req.query.filter_referrer || undefined,
      browser: req.query.filter_browser || undefined,
      os: req.query.filter_os || undefined,
      device: req.query.filter_device || undefined,
      since: req.query.filter_since || undefined,
      until: req.query.filter_until || undefined,
    });

    const [
      dailyUsers,
      dailyActiveUsers,
      hourlyUsers,
      hourlyActiveUsers,
      usersByCountry,
      activeUsersByCountry,
      liveUsers,
      recentlyRegistered,
      recentlyActive,
      loginMethods,
      authOverview,
      paymentsOverview,
      emailOverview,
      analyticsOverview,
      dailyRevenue,
    ] = await Promise.all([
      loadTotalUsers(req.auth.tenancy, now, includeAnonymous),
      loadDailyActiveUsers(req.auth.tenancy, now, includeAnonymous),
      loadHourlyUsers(req.auth.tenancy, now, includeAnonymous),
      loadHourlyActiveUsers(req.auth.tenancy, now, includeAnonymous),
      loadUsersByCountry(req.auth.tenancy, now, includeAnonymous),
      loadActiveUsersByCountry(req.auth.tenancy, now, includeAnonymous),
      loadLiveUsersCount(req.auth.tenancy, now, includeAnonymous),
      usersCrudHandlers.adminList({
        tenancy: req.auth.tenancy,
        query: {
          order_by: 'signed_up_at',
          desc: "true",
          limit: RECENT_LIST_PAGE_SIZE,
          include_anonymous: includeAnonymous ? "true" : "false",
        },
        allowedErrorTypes: [
          KnownErrors.UserNotFound,
        ],
      }).then(res => res.items),
      loadRecentlyActiveUsers(req.auth.tenancy, includeAnonymous),
      loadLoginMethods(req.auth.tenancy),
      loadAuthOverview(req.auth.tenancy, includeAnonymous, now),
      loadPaymentsOverview(req.auth.tenancy, now),
      loadEmailOverview(req.auth.tenancy, now),
      loadAnalyticsOverview(req.auth.tenancy, now, includeAnonymous, analyticsFilters),
      loadDailyRevenue(req.auth.tenancy, now),
    ] as const);

    const totalUsers = authOverview.total_users_filtered;

    // Stitch real daily revenue (from paid invoices) into analytics_overview so
    // the dashboard can read it from a single location.
    const finalAnalyticsOverview = { ...analyticsOverview, daily_revenue: dailyRevenue };

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        total_users: totalUsers,
        live_users: liveUsers,
        daily_users: dailyUsers,
        daily_active_users: dailyActiveUsers,
        hourly_users: hourlyUsers,
        hourly_active_users: hourlyActiveUsers,
        users_by_country: usersByCountry,
        active_users_by_country: activeUsersByCountry,
        recently_registered: recentlyRegistered,
        recently_active: recentlyActive,
        login_methods: loginMethods,
        auth_overview: authOverview,
        payments_overview: paymentsOverview,
        email_overview: emailOverview,
        analytics_overview: finalAnalyticsOverview,
      }
    };
  },
});
