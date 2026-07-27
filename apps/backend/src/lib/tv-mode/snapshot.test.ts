import { describe, expect, it } from "vitest";
import type {
  TvAudienceMomentumScreen,
  TvEmailHealthScreen,
  TvLivePulseScreen,
  TvRevenuePaymentsScreen,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import {
  assembleTvSnapshot,
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

describe("assembleTvSnapshot", () => {
  it("keeps each source state isolated in one authoritative snapshot", () => {
    const snapshot = assembleTvSnapshot({
      project: { id: "project-a", displayName: "Project A" },
      profileId: "company-pulse",
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

  it("rejects unknown non-persisted profile IDs before querying", () => {
    expect(assembleTvSnapshot({
      project: { id: "project-a", displayName: "Project A" },
      profileId: "unknown",
      now: new Date(observedAt),
      screens,
    })).toBeNull();
  });

  it("returns redacted live financial data supplied by the payments adapter", () => {
    const snapshot = assembleTvSnapshot({
      project: { id: "project-a", displayName: "Project A" },
      profileId: "company-pulse",
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
    const revenueScreen = snapshot?.screens.find((screen) => screen.id === "revenue-payments");
    expect(revenueScreen?.data?.financials).toEqual({
      visibility: "redacted",
      direction: "up",
      normalizedRevenueTrend: [],
    });
  });

  it("rejects exact financial values at the live snapshot assembly boundary", () => {
    expect(() => assembleTvSnapshot({
      project: { id: "project-a", displayName: "Project A" },
      profileId: "company-pulse",
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
    })).toThrow("must redact exact financial values");
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
