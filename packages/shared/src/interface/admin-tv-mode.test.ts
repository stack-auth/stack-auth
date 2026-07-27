import { describe, expect, it } from "vitest";
import {
  calculateTvEmailRates,
  calculateTvPaymentSuccessPercent,
  TV_SCREEN_IDS,
  TvSnapshotSchema,
} from "./admin-tv-mode";

function validSnapshot() {
  const observedAt = "2026-07-25T12:00:00.000Z";
  const window = {
    current: { startsAt: observedAt, endsAt: observedAt, label: "Current" },
    comparison: null,
  };
  return {
    generatedAt: observedAt,
    staleAfter: "2026-07-25T12:00:45.000Z",
    connectionStatus: "online",
    project: { id: "project", displayName: "Project" },
    profile: {
      id: "company-pulse",
      displayName: "Company Pulse",
      mode: "general",
      defaultDurationSeconds: 20,
      playlist: [...TV_SCREEN_IDS],
    },
    screens: [
      {
        id: "live-pulse",
        sourceStatus: "ready",
        sourceLabel: "Activity",
        observedAt,
        window,
        diagnosticCode: null,
        data: { liveUsers: 1, todayActiveUsers: 2, hourlyActivity: [], sourceHealth: [] },
        insight: null,
      },
      {
        id: "audience-momentum",
        sourceStatus: "ready",
        sourceLabel: "Audience",
        observedAt,
        window,
        diagnosticCode: null,
        data: {
          totalUsers: 2,
          userGrowthPercent: 0,
          newUsers: 1,
          monthlyActiveUsers: 2,
          visitors: 2,
          averageSessionSeconds: 10,
          verificationRatePercent: 50,
          lifecycle: [],
        },
        insight: null,
      },
      {
        id: "revenue-payments",
        sourceStatus: "insufficient-data",
        sourceLabel: "Payments",
        observedAt,
        window,
        diagnosticCode: null,
        data: {
          financials: { visibility: "redacted", direction: "flat", normalizedRevenueTrend: [] },
          revenueChangePercent: 0,
          activeSubscriptions: 0,
          newSubscriptions: 0,
          pastDueSubscriptions: 0,
          paymentSuccess: { applicableAttempts: 0, percent: null },
        },
        insight: null,
      },
      {
        id: "email-health",
        sourceStatus: "insufficient-data",
        sourceLabel: "Email",
        observedAt,
        window,
        diagnosticCode: null,
        data: {
          sent: 0,
          delivered: 0,
          bounced: 0,
          errors: 0,
          inProgress: 0,
          deliveryRatePercent: null,
          bounceRatePercent: null,
          volumeChangePercent: 0,
          statusTrend: [],
        },
        insight: null,
      },
    ],
    presentation: { banner: null, takeover: null },
    fatalErrorMessage: null,
  };
}

describe("TvSnapshotSchema", () => {
  it("validates the shared snapshot contract", async () => {
    await expect(TvSnapshotSchema.validate(validSnapshot(), { strict: true })).resolves.toMatchObject({
      profile: { id: "company-pulse" },
    });
  });

  it("rejects PII and unknown fields", async () => {
    const snapshot = validSnapshot();
    await expect(TvSnapshotSchema.validate({
      ...snapshot,
      project: { ...snapshot.project, primaryEmail: "private@example.com" },
    }, { strict: true })).rejects.toThrow();
  });

  it("rejects duplicate or missing screen IDs", async () => {
    const snapshot = validSnapshot();
    await expect(TvSnapshotSchema.validate({
      ...snapshot,
      screens: [snapshot.screens[0], snapshot.screens[0], snapshot.screens[2], snapshot.screens[3]],
    }, { strict: true })).rejects.toThrow("unique, known screen IDs");
  });
});

describe("TV sample thresholds", () => {
  it.each([
    [9, 9, null],
    [10, 9, 90],
    [11, 10, 90.9],
  ])("applies the payment threshold at %i attempts", (attempts, successes, expected) => {
    expect(calculateTvPaymentSuccessPercent(attempts, successes)).toBe(expected);
  });

  it.each([
    [19, 18, null],
    [20, 19, 95],
    [21, 20, 95.2],
  ])("applies the email threshold at %i finished sends", (finished, delivered, expectedDelivery) => {
    expect(calculateTvEmailRates(finished, delivered, 0).deliveryRatePercent).toBe(expectedDelivery);
  });
});
