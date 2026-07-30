import { describe, expect, it } from "vitest";
import type {
  TvAudienceMomentumScreen,
  TvEmailHealthScreen,
  TvLivePulseScreen,
  TvRevenuePaymentsScreen,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import { getTvBuiltInProfile } from "@hexclave/shared/dist/interface/admin-tv-mode";
import {
  addTvSourceHealth,
  assembleTvSnapshot,
  createReadyTvLivePulseScreen,
  createTvLivePulseErrorScreen,
  getTvOperationalMetricsClient,
  isTvEmailInsightEligible,
  isTvReturningInsightEligible,
} from "./snapshot";

const observedAt = "2026-07-25T12:00:00.000Z";
const window = {
  current: { startsAt: observedAt, endsAt: observedAt, label: "Current" },
  comparison: null,
};

const screens = {
  livePulse: {
    id: "live-pulse",
    sourceStatus: "ready",
    sourceLabel: "Activity",
    observedAt,
    window,
    diagnosticCode: null,
    data: { liveUsers: 1, todayActiveUsers: 2, hourlyActivity: [], sourceHealth: [] },
    insight: null,
  } satisfies TvLivePulseScreen,
  audience: {
    id: "audience-momentum",
    sourceStatus: "error",
    sourceLabel: "Audience",
    observedAt,
    window,
    diagnosticCode: "source-query-failed",
    data: null,
    insight: null,
  } satisfies TvAudienceMomentumScreen,
  revenue: {
    id: "revenue-payments",
    sourceStatus: "unavailable",
    sourceLabel: "Payments",
    observedAt,
    window,
    diagnosticCode: "payments-app-disabled",
    data: null,
    insight: null,
  } satisfies TvRevenuePaymentsScreen,
  email: {
    id: "email-health",
    sourceStatus: "insufficient-data",
    sourceLabel: "Email",
    observedAt,
    window,
    diagnosticCode: null,
    data: {
      sent: 5,
      delivered: 5,
      bounced: 0,
      errors: 0,
      inProgress: 0,
      deliveryRatePercent: null,
      bounceRatePercent: null,
      volumeChangePercent: 0,
      statusTrend: [],
    },
    insight: null,
  } satisfies TvEmailHealthScreen,
};

const companyPulseProfile = getTvBuiltInProfile("company-pulse");
if (companyPulseProfile == null) {
  throw new Error("The Company Pulse TV profile must exist.");
}

describe("assembleTvSnapshot", () => {
  it("keeps each source state isolated in one authoritative snapshot", () => {
    const snapshot = assembleTvSnapshot({
      project: { id: "project-a", displayName: "Project A" },
      profile: companyPulseProfile,
      now: new Date(observedAt),
      screens,
    });

    expect(snapshot).toMatchObject({
      generatedAt: observedAt,
      staleAfter: "2026-07-25T12:00:45.000Z",
      project: { id: "project-a", displayName: "Project A" },
      profile: { id: "company-pulse" },
      screens: [
        { id: "live-pulse", sourceStatus: "ready" },
        { id: "audience-momentum", sourceStatus: "error" },
        { id: "revenue-payments", sourceStatus: "unavailable" },
        { id: "email-health", sourceStatus: "insufficient-data" },
      ],
    });
  });

  it("places resolved per-screen timing under the snapshot profile", () => {
    const snapshot = assembleTvSnapshot({
      project: { id: "project-a", displayName: "Project A" },
      profile: companyPulseProfile,
      now: new Date(observedAt),
      includeScreenDurations: true,
      screens,
    });

    expect(snapshot.profile.screenDurations).toEqual([
      { screenId: "live-pulse", durationSeconds: 15 },
      { screenId: "audience-momentum", durationSeconds: 20 },
      { screenId: "revenue-payments", durationSeconds: 18 },
      { screenId: "email-health", durationSeconds: 18 },
    ]);
  });

  it("returns redacted live financial data supplied by the payments adapter", () => {
    const snapshot = assembleTvSnapshot({
      project: { id: "project-a", displayName: "Project A" },
      profile: companyPulseProfile,
      now: new Date(observedAt),
      screens: {
        ...screens,
        revenue: {
          ...screens.revenue,
          sourceStatus: "ready",
          diagnosticCode: null,
          data: {
            financials: { visibility: "redacted", direction: "up", normalizedRevenueTrend: [] },
            revenueChangePercent: 10,
            activeSubscriptions: 2,
            newSubscriptions: 1,
            pastDueSubscriptions: 0,
            paymentSuccess: { applicableAttempts: 10, percent: 100 },
          },
        },
      },
    });
    const revenueScreen = snapshot.screens.find((screen) => screen.id === "revenue-payments");
    expect(revenueScreen?.data?.financials).toEqual({
      visibility: "redacted",
      direction: "up",
      normalizedRevenueTrend: [],
    });
  });

  it("rejects exact financial values at the live snapshot assembly boundary", () => {
    expect(() => assembleTvSnapshot({
      project: { id: "project-a", displayName: "Project A" },
      profile: companyPulseProfile,
      now: new Date(observedAt),
      screens: {
        ...screens,
        revenue: {
          ...screens.revenue,
          sourceStatus: "ready",
          diagnosticCode: null,
          data: {
            financials: {
              visibility: "exact",
              paidRevenueCents: 100,
              mrrProxyCents: 100,
              revenueTrend: [],
            },
            revenueChangePercent: 0,
            activeSubscriptions: 1,
            newSubscriptions: 0,
            pastDueSubscriptions: 0,
            paymentSuccess: { applicableAttempts: 10, percent: 100 },
          },
        },
      },
    })).toThrow("must not expose exact financial values");
  });
});

describe("Live Pulse activity source states", () => {
  it("keeps a successful all-zero activity observation ready", () => {
    expect(createReadyTvLivePulseScreen({
      now: new Date(observedAt),
      liveUsers: 0,
      todayActiveUsers: 0,
      hourlyActivity: [],
    })).toMatchObject({
      sourceStatus: "ready",
      diagnosticCode: null,
      data: {
        liveUsers: 0,
        todayActiveUsers: 0,
        hourlyActivity: [{ value: 0 }],
      },
    });
  });

  it("keeps zero live users with positive current-day activity ready", () => {
    expect(createReadyTvLivePulseScreen({
      now: new Date(observedAt),
      liveUsers: 0,
      todayActiveUsers: 12,
      hourlyActivity: [{ label: "11:00", value: 12 }],
    })).toMatchObject({
      sourceStatus: "ready",
      data: {
        liveUsers: 0,
        todayActiveUsers: 12,
        hourlyActivity: [{ label: "11:00", value: 12 }],
      },
    });
  });

  it("keeps Live Pulse ready when Email and Payments have limited samples", () => {
    const livePulse = addTvSourceHealth(
      createReadyTvLivePulseScreen({
        now: new Date(observedAt),
        liveUsers: 0,
        todayActiveUsers: 0,
        hourlyActivity: [],
      }),
      {
        email: screens.email,
        revenue: {
          ...screens.revenue,
          sourceStatus: "insufficient-data",
          diagnosticCode: null,
          data: {
            financials: { visibility: "redacted", direction: "flat", normalizedRevenueTrend: [] },
            revenueChangePercent: 0,
            activeSubscriptions: 0,
            newSubscriptions: 0,
            pastDueSubscriptions: 0,
            paymentSuccess: { applicableAttempts: 4, percent: null },
          },
        },
        audience: screens.audience,
      },
    );

    expect(livePulse.sourceStatus).toBe("ready");
    expect(livePulse.data?.sourceHealth.slice(0, 2)).toEqual([
      {
        label: "Email delivery",
        status: "insufficient-data",
        value: "Limited",
        detail: "Insufficient data",
      },
      {
        label: "Payment collection",
        status: "insufficient-data",
        value: "Limited",
        detail: "Insufficient data",
      },
    ]);
  });

  it("keeps an activity query failure in the error state", () => {
    expect(createTvLivePulseErrorScreen(new Date(observedAt))).toMatchObject({
      sourceStatus: "error",
      diagnosticCode: "source-query-failed",
      data: null,
      insight: null,
    });
  });
});

describe("TV deterministic insight eligibility", () => {
  it("requires returning activity to lead new activity by at least ten percent", () => {
    expect(isTvReturningInsightEligible(100, 109)).toBe(false);
    expect(isTvReturningInsightEligible(100, 110)).toBe(true);
    expect(isTvReturningInsightEligible(0, 10)).toBe(false);
  });

  it("requires qualifying email delivery and a volume increase above twenty percent", () => {
    expect(isTvEmailInsightEligible(null, 25)).toBe(false);
    expect(isTvEmailInsightEligible(98.9, 25)).toBe(false);
    expect(isTvEmailInsightEligible(99, 20)).toBe(false);
    expect(isTvEmailInsightEligible(99, 20.1)).toBe(true);
  });
});

describe("TV operational metric routing", () => {
  it("uses the configured replica client for stale-tolerant operational metrics", () => {
    const replicaClient = { role: "replica" };
    let replicaSelections = 0;
    const selected = getTvOperationalMetricsClient({
      $replica: () => {
        replicaSelections += 1;
        return replicaClient;
      },
    });

    expect(selected).toBe(replicaClient);
    expect(replicaSelections).toBe(1);
  });
});
