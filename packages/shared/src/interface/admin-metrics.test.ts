import { describe, expect, it } from "vitest";
import { MetricsAnalyticsOverviewSchema } from "./admin-metrics";

const validAnalyticsOverview = {
  daily_page_views: [],
  daily_clicks: [],
  daily_visitors: [],
  hourly_page_views: [],
  hourly_active_users: [],
  hourly_visitors: [],
  daily_revenue: [],
  total_revenue_cents: 0,
  total_replays: 0,
  recent_replays: 0,
  visitors: 0,
  avg_session_seconds: 0,
  online_live: 0,
  revenue_per_visitor: 0,
  top_referrers: [],
  top_region: null,
  top_regions: [],
  bounce_rate: 0,
  daily_bounce_rate: [],
  daily_avg_session_seconds: [],
  top_browsers: [],
  top_operating_systems: [],
  top_devices: [],
};

describe("MetricsAnalyticsOverviewSchema", () => {
  it("rejects an older partial response instead of manufacturing current metrics", async () => {
    await expect(MetricsAnalyticsOverviewSchema.validate({
      ...validAnalyticsOverview,
      hourly_page_views: undefined,
    })).rejects.toThrow(/hourly_page_views/);
  });
});
