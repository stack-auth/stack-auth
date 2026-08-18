import { describe, expect, it } from "vitest";
import { GROWTH_METRIC_CATALOG } from "./metric-catalog";
import { buildGrowthMetricRows, type GrowthMetricRowSources } from "./metric-store";

const point = (date: string, activity: number) => ({ date, activity });

// Two-day fixture: small enough to reason about exhaustively, but exercises every metric family.
function makeRowSources(overrides: Partial<GrowthMetricRowSources> = {}): GrowthMetricRowSources {
  const days = ["2026-08-01", "2026-08-02"];
  return {
    projectId: "proj",
    branchId: "main",
    dailySignups: [point(days[0], 2), point(days[1], 4)],
    dailyActiveUsersSplit: {
      total: [point(days[0], 10), point(days[1], 12)],
      new: [point(days[0], 2), point(days[1], 4)],
      retained: [point(days[0], 6), point(days[1], 5)],
      reactivated: [point(days[0], 2), point(days[1], 3)],
    },
    dailyActiveTeamsSplit: {
      total: [point(days[0], 3), point(days[1], 4)],
      new: [point(days[0], 1), point(days[1], 0)],
      retained: [point(days[0], 2), point(days[1], 3)],
      reactivated: [point(days[0], 0), point(days[1], 1)],
    },
    dailyPageViews: [point(days[0], 100), point(days[1], 150)],
    dailyClicks: [point(days[0], 20), point(days[1], 30)],
    dailyVisitors: [point(days[0], 40), point(days[1], 50)],
    dailyBounceRate: [point(days[0], 55.5), point(days[1], 60)],
    dailyAvgSessionSeconds: [point(days[0], 120), point(days[1], 90)],
    dailyEmailsByStatus: [
      { date: days[0], ok: 5, error: 1, in_progress: 2 },
      { date: days[1], ok: 7, error: 0, in_progress: 0 },
    ],
    dailyRevenue: [
      { date: days[0], new_cents: 1000, refund_cents: 0 },
      { date: days[1], new_cents: 2500, refund_cents: 0 },
    ],
    dailySubscriptions: [point(days[0], 1), point(days[1], 2)],
    totalUsersFiltered: 500,
    mau: 200,
    verifiedUsers: 300,
    unverifiedUsers: 200,
    anonymousUsers: 42,
    totalTeams: 12,
    emailsSentTotal: 999,
    emailDeliverabilityRate: 98.5,
    emailBounceRate: 1.2,
    emailClickRate: 10,
    activeSubscriptions: 20,
    canceledSubscriptions: 3,
    mrrCentsProxy: 123456,
    totalOrders: 77,
    totalOneTimePurchases: 30,
    checkoutConversionRate: 88.9,
    ...overrides,
  };
}

function rowsFor(rows: ReturnType<typeof buildGrowthMetricRows>, metricId: string) {
  return rows.filter((row) => row.metric_id === metricId);
}

describe("buildGrowthMetricRows", () => {
  it("rejects malformed target dates", () => {
    expect(() => buildGrowthMetricRows(makeRowSources(), "08/02/2026")).toThrowError(/YYYY-MM-DD/);
    expect(() => buildGrowthMetricRows(makeRowSources(), "2026-8-2")).toThrowError(/YYYY-MM-DD/);
  });

  it("emits flow rows for every day of the loader window and snapshot rows for targetDate only", () => {
    const rows = buildGrowthMetricRows(makeRowSources(), "2026-08-02");

    // Flow metrics: one row per day in the window, dates aligned with the input series.
    for (const flowId of ["new_users", "dau", "retained_users", "reactivated_users", "returning_users_daily", "new_teams", "active_teams", "page_views", "clicks", "visitors", "bounce_rate", "avg_session_seconds", "emails_created", "emails_ok", "emails_error", "revenue_cents", "refund_cents", "new_subscriptions", "visitor_signup_rate"]) {
      expect(rowsFor(rows, flowId).map((row) => row.date), `flow metric ${flowId}`).toEqual(["2026-08-01", "2026-08-02"]);
    }

    // Snapshot metrics: exactly one row, dated targetDate.
    for (const snapshotId of ["total_users", "mau", "verified_users", "unverified_users", "anonymous_users", "total_teams", "emails_sent_total", "email_deliverability_rate", "email_bounce_rate", "email_click_rate", "active_subscriptions", "canceled_subscriptions", "mrr_cents_proxy", "total_orders", "total_one_time_purchases", "checkout_conversion_rate", "dau_mau_stickiness"]) {
      const metricRows = rowsFor(rows, snapshotId);
      expect(metricRows.length, `snapshot metric ${snapshotId}`).toBe(1);
      expect(metricRows[0].date, `snapshot metric ${snapshotId}`).toBe("2026-08-02");
    }

    // No metric ids beyond the two groups above.
    const expectedIdCount = 19 + 17;
    expect(new Set(rows.map((row) => row.metric_id)).size).toBe(expectedIdCount);
  });

  it("emits exactly the catalog's stored, non-ads metrics with matching kinds", () => {
    const rows = buildGrowthMetricRows(makeRowSources(), "2026-08-02");
    const catalogById = new Map(GROWTH_METRIC_CATALOG.map((metric) => [metric.id, metric]));
    const emittedIds = new Set(rows.map((row) => row.metric_id));
    for (const id of emittedIds) {
      const metric = catalogById.get(id);
      expect(metric, `row builder emitted "${id}" which is not in the catalog`).toBeDefined();
      expect(metric?.availability, id).toBe("stored");
      expect(metric?.timezone, `${id} rows go into growth_daily_metrics, which is UTC-only`).toBe("utc");
      // Snapshot metrics must emit exactly one row (targetDate); flows one per window day.
      expect(rowsFor(rows, id).length, id).toBe(metric?.kind === "snapshot" ? 1 : 2);
    }
    // ...and the other way: every stored catalog metric outside the ads table is emitted by this
    // fixture (which has no zero-division or non-finite skips).
    for (const metric of GROWTH_METRIC_CATALOG) {
      if (metric.availability !== "stored" || metric.category === "ads") continue;
      expect(emittedIds.has(metric.id), `catalog stored metric "${metric.id}" is never emitted by buildGrowthMetricRows`).toBe(true);
    }
  });

  it("computes the derived values correctly", () => {
    const rows = buildGrowthMetricRows(makeRowSources(), "2026-08-02");
    // returning = retained + reactivated
    expect(rowsFor(rows, "returning_users_daily").map((row) => row.value)).toEqual([8, 8]);
    // emails_created = ok + error + in_progress
    expect(rowsFor(rows, "emails_created").map((row) => row.value)).toEqual([8, 7]);
    // visitor_signup_rate = signups / visitors * 100
    expect(rowsFor(rows, "visitor_signup_rate").map((row) => row.value)).toEqual([5, 8]);
    // dau_mau_stickiness = targetDate dau / mau * 100
    expect(rowsFor(rows, "dau_mau_stickiness")[0].value).toBe(6);
    // every row carries the project/branch scope
    for (const row of rows) {
      expect(row.project_id).toBe("proj");
      expect(row.branch_id).toBe("main");
    }
  });

  it("skips visitor_signup_rate on zero-visitor days instead of storing 0 or Infinity", () => {
    const rows = buildGrowthMetricRows(makeRowSources({
      dailyVisitors: [point("2026-08-01", 0), point("2026-08-02", 50)],
    }), "2026-08-02");
    expect(rowsFor(rows, "visitor_signup_rate")).toEqual([
      { project_id: "proj", branch_id: "main", date: "2026-08-02", metric_id: "visitor_signup_rate", value: 8 },
    ]);
  });

  it("skips dau_mau_stickiness when mau is 0", () => {
    const rows = buildGrowthMetricRows(makeRowSources({ mau: 0 }), "2026-08-02");
    expect(rowsFor(rows, "dau_mau_stickiness")).toEqual([]);
    // mau itself is still a valid 0-valued snapshot
    expect(rowsFor(rows, "mau").map((row) => row.value)).toEqual([0]);
  });

  it("skips dau_mau_stickiness when targetDate is outside the dau window", () => {
    const rows = buildGrowthMetricRows(makeRowSources(), "2026-08-09");
    expect(rowsFor(rows, "dau_mau_stickiness")).toEqual([]);
  });

  it("skips non-finite values instead of storing them", () => {
    const rows = buildGrowthMetricRows(makeRowSources({
      dailyPageViews: [point("2026-08-01", Number.NaN), point("2026-08-02", 150)],
      mrrCentsProxy: Number.POSITIVE_INFINITY,
    }), "2026-08-02");
    expect(rowsFor(rows, "page_views")).toEqual([
      { project_id: "proj", branch_id: "main", date: "2026-08-02", metric_id: "page_views", value: 150 },
    ]);
    expect(rowsFor(rows, "mrr_cents_proxy")).toEqual([]);
  });

  it("emits no analytics rows when the analytics series are empty (app not installed)", () => {
    const rows = buildGrowthMetricRows(makeRowSources({
      dailyPageViews: [],
      dailyClicks: [],
      dailyVisitors: [],
      dailyBounceRate: [],
      dailyAvgSessionSeconds: [],
    }), "2026-08-02");
    for (const webId of ["page_views", "clicks", "visitors", "bounce_rate", "avg_session_seconds", "visitor_signup_rate"]) {
      expect(rowsFor(rows, webId), webId).toEqual([]);
    }
    // non-analytics metrics are unaffected
    expect(rowsFor(rows, "new_users").length).toBe(2);
  });

  it("produces a stable full snapshot for a one-day window", () => {
    const days = ["2026-08-02"];
    const rows = buildGrowthMetricRows(makeRowSources({
      dailySignups: [point(days[0], 4)],
      dailyActiveUsersSplit: {
        total: [point(days[0], 12)],
        new: [point(days[0], 4)],
        retained: [point(days[0], 5)],
        reactivated: [point(days[0], 3)],
      },
      dailyActiveTeamsSplit: {
        total: [point(days[0], 4)],
        new: [point(days[0], 0)],
        retained: [point(days[0], 3)],
        reactivated: [point(days[0], 1)],
      },
      dailyPageViews: [point(days[0], 150)],
      dailyClicks: [point(days[0], 30)],
      dailyVisitors: [point(days[0], 50)],
      dailyBounceRate: [point(days[0], 60)],
      dailyAvgSessionSeconds: [point(days[0], 90)],
      dailyEmailsByStatus: [{ date: days[0], ok: 7, error: 0, in_progress: 0 }],
      dailyRevenue: [{ date: days[0], new_cents: 2500, refund_cents: 0 }],
      dailySubscriptions: [point(days[0], 2)],
    }), "2026-08-02");

    expect(rows.map((row) => `${row.metric_id} ${row.date} ${row.value}`)).toMatchInlineSnapshot(`
      [
        "new_users 2026-08-02 4",
        "dau 2026-08-02 12",
        "retained_users 2026-08-02 5",
        "reactivated_users 2026-08-02 3",
        "returning_users_daily 2026-08-02 8",
        "new_teams 2026-08-02 0",
        "active_teams 2026-08-02 4",
        "page_views 2026-08-02 150",
        "clicks 2026-08-02 30",
        "visitors 2026-08-02 50",
        "bounce_rate 2026-08-02 60",
        "avg_session_seconds 2026-08-02 90",
        "emails_created 2026-08-02 7",
        "emails_ok 2026-08-02 7",
        "emails_error 2026-08-02 0",
        "revenue_cents 2026-08-02 2500",
        "refund_cents 2026-08-02 0",
        "new_subscriptions 2026-08-02 2",
        "visitor_signup_rate 2026-08-02 8",
        "total_users 2026-08-02 500",
        "mau 2026-08-02 200",
        "verified_users 2026-08-02 300",
        "unverified_users 2026-08-02 200",
        "anonymous_users 2026-08-02 42",
        "total_teams 2026-08-02 12",
        "emails_sent_total 2026-08-02 999",
        "email_deliverability_rate 2026-08-02 98.5",
        "email_bounce_rate 2026-08-02 1.2",
        "email_click_rate 2026-08-02 10",
        "active_subscriptions 2026-08-02 20",
        "canceled_subscriptions 2026-08-02 3",
        "mrr_cents_proxy 2026-08-02 123456",
        "total_orders 2026-08-02 77",
        "total_one_time_purchases 2026-08-02 30",
        "checkout_conversion_rate 2026-08-02 88.9",
        "dau_mau_stickiness 2026-08-02 6",
      ]
    `);
  });
});
