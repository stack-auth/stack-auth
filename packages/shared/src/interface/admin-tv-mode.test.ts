import { describe, expect, it } from "vitest";
import {
  calculateTvEmailRates,
  calculateTvPaymentSuccessPercent,
  getTvBuiltInProfile,
  TV_SCREEN_IDS,
  TvProfileConfigurationSchema,
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
    presentation: { highlight: null, takeover: null },
    fatalErrorMessage: null,
  };
}

describe("TvSnapshotSchema", () => {
  it("validates the shared snapshot contract", async () => {
    await expect(TvSnapshotSchema.validate(validSnapshot(), { strict: true })).resolves.toMatchObject({
      profile: { id: "company-pulse" },
    });
  });

  it("accepts a profile-owned duration schedule aligned with the playlist", async () => {
    const snapshot = validSnapshot();
    await expect(TvSnapshotSchema.validate({
      ...snapshot,
      profile: {
        ...snapshot.profile,
        screenDurations: snapshot.profile.playlist.map((screenId) => ({
          screenId,
          durationSeconds: 20,
        })),
      },
    }, { strict: true })).resolves.toBeDefined();
  });

  it("rejects duration schedules that do not align with playlist order", async () => {
    const snapshot = validSnapshot();
    await expect(TvSnapshotSchema.validate({
      ...snapshot,
      profile: {
        ...snapshot.profile,
        screenDurations: [{ screenId: "live-pulse", durationSeconds: 20 }],
      },
    }, { strict: true })).rejects.toThrow("unique, known screen IDs");
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

  it("rejects inconsistent takeover and Highlight lifecycle states", async () => {
    const snapshot = validSnapshot();
    const event = {
      id: "event",
      type: "email-delivery-degradation",
      presentationClass: "critical-incident",
      status: "active",
      title: "Email delivery degraded",
      summary: "Delivery is outside its expected range.",
      metricLabel: "Delivery rate",
      metricValue: "78%",
      expectedRange: "Expected 95% or higher",
      sourceLabel: "Hexclave email",
      occurredAt: snapshot.generatedAt,
      updatedAt: snapshot.generatedAt,
    };
    await expect(TvSnapshotSchema.validate({
      ...snapshot,
      presentation: {
        takeover: {
          event,
          variant: "critical-incident",
          startedAt: snapshot.generatedAt,
          endsAt: "2026-07-25T12:01:00.000Z",
        },
        highlight: null,
      },
    }, { strict: true })).rejects.toThrow("inconsistent");
    await expect(TvSnapshotSchema.validate({
      ...snapshot,
      presentation: {
        takeover: null,
        highlight: {
          event,
          variant: "celebration",
          expiresAt: "2026-07-25T13:00:00.000Z",
          animationExpiresAt: "2026-07-25T14:00:00.000Z",
        },
      },
    }, { strict: true })).rejects.toThrow("inconsistent");
  });
});

describe("TvProfileConfigurationSchema", () => {
  it("validates built-in templates through the persisted configuration contract", async () => {
    const companyPulse = getTvBuiltInProfile("company-pulse");
    if (companyPulse == null) throw new Error("Company Pulse must exist.");
    await expect(TvProfileConfigurationSchema.validate(
      companyPulse.configuration,
      { strict: true },
    )).resolves.toEqual(companyPulse.configuration);
  });

  it("rejects duplicate screens and revenue celebrations in redacted profiles", async () => {
    const companyPulse = getTvBuiltInProfile("company-pulse");
    if (companyPulse == null) throw new Error("Company Pulse must exist.");
    await expect(TvProfileConfigurationSchema.validate({
      ...companyPulse.configuration,
      playlist: [
        companyPulse.configuration.playlist[0],
        companyPulse.configuration.playlist[0],
      ],
    }, { strict: true })).rejects.toThrow("unique screen IDs");
    await expect(TvProfileConfigurationSchema.validate({
      ...companyPulse.configuration,
      interruptionPreferences: {
        ...companyPulse.configuration.interruptionPreferences,
        celebrations: { userMilestone: true, revenueMilestone: true },
      },
    }, { strict: true })).rejects.toThrow("Revenue milestones require exact financial visibility");
  });

  it("rejects celebration animation that outlives its Highlight", async () => {
    const companyPulse = getTvBuiltInProfile("company-pulse");
    if (companyPulse == null) throw new Error("Company Pulse must exist.");
    await expect(TvProfileConfigurationSchema.validate({
      ...companyPulse.configuration,
      interruptionPreferences: {
        ...companyPulse.configuration.interruptionPreferences,
        timing: {
          ...companyPulse.configuration.interruptionPreferences.timing,
          celebration: {
            takeoverSeconds: 60,
            animationSeconds: 7200,
            highlightSeconds: 3600,
          },
        },
      },
    }, { strict: true })).rejects.toThrow("must not outlive");
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
