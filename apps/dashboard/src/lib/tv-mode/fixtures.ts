import { throwErr } from "@hexclave/shared/dist/utils/errors";
import {
  calculateTvEmailRates,
  calculateTvPaymentSuccessPercent,
  getTvBuiltInProfile,
  TV_MINIMUM_FINISHED_SENDS,
  TV_MINIMUM_PAYMENT_ATTEMPTS,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import type {
  TvAudienceMomentumScreen,
  TvEmailHealthScreen,
  TvEvent,
  TvFixtureVariant,
  TvLivePulseScreen,
  TvPresentedEvent,
  TvProfileFixture,
  TvRevenuePaymentsScreen,
  TvScreenSnapshot,
  TvSnapshot,
} from "./types";

const FIXTURE_NOW = "2026-07-23T14:32:00.000Z";
const FIXTURE_STALE_AFTER = "2026-07-23T14:32:45.000Z";
const DAY = 24 * 60 * 60 * 1000;
export { TV_MINIMUM_FINISHED_SENDS, TV_MINIMUM_PAYMENT_ATTEMPTS };
const engineeringProfile = getTvBuiltInProfile("engineering-office") ?? throwErr("Missing shared engineering-office TV profile");
const companyPulseProfile = getTvBuiltInProfile("company-pulse") ?? throwErr("Missing shared company-pulse TV profile");

export function calculateFixturePaymentSuccess(applicableAttempts: number, successfulAttempts: number): number | null {
  return calculateTvPaymentSuccessPercent(applicableAttempts, successfulAttempts);
}

export function calculateFixtureEmailRates(finishedSends: number, delivered: number, bounced: number) {
  return calculateTvEmailRates(finishedSends, delivered, bounced);
}

function windowFrom(days: number, comparison = true) {
  const endsAt = new Date(FIXTURE_NOW);
  const startsAt = new Date(endsAt.getTime() - days * DAY);
  const comparisonEndsAt = new Date(startsAt);
  const comparisonStartsAt = new Date(comparisonEndsAt.getTime() - days * DAY);
  return {
    current: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      label: days === 1 ? "Today · UTC" : `Trailing ${days} days`,
    },
    comparison: comparison ? {
      startsAt: comparisonStartsAt.toISOString(),
      endsAt: comparisonEndsAt.toISOString(),
      label: `Previous ${days} days`,
    } : null,
  };
}

const livePulseScreen: TvLivePulseScreen = {
  id: "live-pulse",
  sourceStatus: "ready",
  sourceLabel: "Hexclave activity",
  observedAt: FIXTURE_NOW,
  window: windowFrom(1, false),
  diagnosticCode: null,
  data: {
    liveUsers: 42,
    todayActiveUsers: 186,
    hourlyActivity: [
      { label: "08:00", value: 12 }, { label: "09:00", value: 18 },
      { label: "10:00", value: 17 }, { label: "11:00", value: 29 },
      { label: "12:00", value: 25 }, { label: "13:00", value: 37 },
      { label: "14:00", value: 42 },
    ],
    sourceHealth: [
      { label: "Email delivery", status: "healthy", value: "99.2%", detail: "No issues detected" },
      { label: "Payment collection", status: "healthy", value: "98.6%", detail: "No issues detected" },
      { label: "Analytics", status: "healthy", value: "Fresh", detail: "Updated 1 min ago" },
    ],
  },
  insight: {
    kind: "live-activity-above-baseline",
    message: "Live activity is 18% above the comparable recent baseline.",
    evidence: { currentLiveUsers: 42, baselineLiveUsers: 35.5, deltaPercent: 18.3 },
  },
};

const audienceMomentumScreen: TvAudienceMomentumScreen = {
  id: "audience-momentum",
  sourceStatus: "ready",
  sourceLabel: "Hexclave users & analytics",
  observedAt: FIXTURE_NOW,
  window: windowFrom(7),
  diagnosticCode: null,
  data: {
    totalUsers: 512,
    userGrowthPercent: 12.8,
    newUsers: 38,
    monthlyActiveUsers: 361,
    visitors: 923,
    averageSessionSeconds: 252,
    verificationRatePercent: 91.6,
    lifecycle: [
      { label: "Thu", primary: 18, secondary: 48, tertiary: 12 },
      { label: "Fri", primary: 24, secondary: 56, tertiary: 14 },
      { label: "Sat", primary: 16, secondary: 51, tertiary: 11 },
      { label: "Sun", primary: 21, secondary: 58, tertiary: 15 },
      { label: "Mon", primary: 29, secondary: 72, tertiary: 18 },
      { label: "Tue", primary: 31, secondary: 79, tertiary: 22 },
      { label: "Wed", primary: 38, secondary: 91, tertiary: 25 },
    ],
  },
  insight: {
    kind: "returning-users-leading",
    message: "Audience momentum is being driven primarily by returning users.",
    evidence: {
      newActivity: 177,
      retainedActivity: 455,
      reactivatedActivity: 117,
      leadMarginPercent: 157.1,
    },
  },
};

const exactRevenueTrend = [
  { label: "Jun 24", value: 112000 }, { label: "Jun 29", value: 149000 },
  { label: "Jul 4", value: 128000 }, { label: "Jul 9", value: 176000 },
  { label: "Jul 14", value: 162000 }, { label: "Jul 19", value: 201000 },
  { label: "Jul 23", value: 238000 },
];

const revenuePaymentsScreen: TvRevenuePaymentsScreen = {
  id: "revenue-payments",
  sourceStatus: "ready",
  sourceLabel: "Hexclave payments",
  observedAt: FIXTURE_NOW,
  window: windowFrom(30),
  diagnosticCode: null,
  data: {
    financials: {
      visibility: "exact",
      paidRevenueCents: 4823100,
      mrrProxyCents: 3128000,
      revenueTrend: exactRevenueTrend,
    },
    revenueChangePercent: 14.2,
    activeSubscriptions: 147,
    newSubscriptions: 24,
    pastDueSubscriptions: 3,
    paymentSuccess: { applicableAttempts: 286, percent: calculateFixturePaymentSuccess(286, 282) },
  },
  insight: {
    kind: "revenue-up-payments-stable",
    message: "Paid revenue increased while payment collection remained stable.",
    evidence: {
      revenueChangePercent: 14.2,
      paymentSuccessPercent: 98.6,
      applicablePaymentAttempts: 286,
    },
  },
};

const emailHealthScreen: TvEmailHealthScreen = {
  id: "email-health",
  sourceStatus: "ready",
  sourceLabel: "Hexclave email",
  observedAt: FIXTURE_NOW,
  window: windowFrom(7),
  diagnosticCode: null,
  data: {
    sent: 12640,
    delivered: 12539,
    bounced: 63,
    errors: 38,
    inProgress: 21,
    ...calculateFixtureEmailRates(12640, 12539, 63),
    volumeChangePercent: 22.1,
    statusTrend: [
      { label: "Thu", primary: 1298, secondary: 8, tertiary: 14 },
      { label: "Fri", primary: 1463, secondary: 9, tertiary: 16 },
      { label: "Sat", primary: 1080, secondary: 5, tertiary: 13 },
      { label: "Sun", primary: 1188, secondary: 7, tertiary: 16 },
      { label: "Mon", primary: 1752, secondary: 12, tertiary: 19 },
      { label: "Tue", primary: 1977, secondary: 14, tertiary: 20 },
      { label: "Wed", primary: 2347, secondary: 19, tertiary: 18 },
    ],
  },
  insight: {
    kind: "delivery-healthy-volume-up",
    message: "Delivery remained above 99% while sending volume increased by 22%.",
    evidence: { deliveryRatePercent: 99.2, volumeChangePercent: 22.1, finishedSends: 12640 },
  },
};

export const TV_PROFILE_FIXTURES = [
  {
    id: "engineering-office",
    displayName: engineeringProfile.displayName,
    description: "A broad company pulse for the engineering workspace.",
    mode: "general",
    defaultDurationSeconds: engineeringProfile.defaultDurationSeconds,
    playlist: [
      { screenId: "live-pulse", enabled: engineeringProfile.playlist.includes("live-pulse"), durationSecondsOverride: 15 },
      { screenId: "audience-momentum", enabled: engineeringProfile.playlist.includes("audience-momentum"), durationSecondsOverride: 20 },
      { screenId: "revenue-payments", enabled: engineeringProfile.playlist.includes("revenue-payments"), durationSecondsOverride: 18 },
      { screenId: "email-health", enabled: engineeringProfile.playlist.includes("email-health"), durationSecondsOverride: 18 },
    ],
    incidentLevels: { critical: "persistent-takeover", high: "temporary-takeover", medium: "banner" },
    incidentTypes: { emailDeliveryDegradation: true },
    celebrations: { userMilestone: true, revenueMilestone: false },
    showExactFinancialValues: false,
  },
  {
    id: "company-pulse",
    displayName: companyPulseProfile.displayName,
    description: "The complete General Mode rotation for shared office spaces.",
    mode: "general",
    defaultDurationSeconds: companyPulseProfile.defaultDurationSeconds,
    playlist: [
      { screenId: "live-pulse", enabled: companyPulseProfile.playlist.includes("live-pulse"), durationSecondsOverride: 15 },
      { screenId: "audience-momentum", enabled: companyPulseProfile.playlist.includes("audience-momentum"), durationSecondsOverride: 20 },
      { screenId: "revenue-payments", enabled: companyPulseProfile.playlist.includes("revenue-payments"), durationSecondsOverride: 18 },
      { screenId: "email-health", enabled: companyPulseProfile.playlist.includes("email-health"), durationSecondsOverride: 18 },
    ],
    incidentLevels: { critical: "persistent-takeover", high: "temporary-takeover", medium: "banner" },
    incidentTypes: { emailDeliveryDegradation: true },
    celebrations: { userMilestone: true, revenueMilestone: true },
    showExactFinancialValues: true,
  },
] satisfies readonly TvProfileFixture[];

const userMilestoneEvent: TvEvent = {
  id: "fixture-user-milestone-500", kind: "celebration", type: "user-milestone",
  severity: "info", title: "500 users", summary: "A new community milestone, reached together.",
  metricLabel: "Total users", metricValue: "512", sourceLabel: "Hexclave users", startedAt: FIXTURE_NOW,
};

const emailDegradationEvent: TvEvent = {
  id: "fixture-email-delivery-degradation", kind: "incident", type: "email-delivery-degradation",
  severity: "critical", title: "Email delivery degraded",
  summary: "Delivery failures are above the configured threshold.", metricLabel: "Delivery rate",
  metricValue: "82.4%", sourceLabel: "Hexclave email", startedAt: "2026-07-23T14:28:00.000Z",
};

function presentedEvent(event: TvEvent, priority: 1 | 2 | 3, treatment: "banner" | "temporary-takeover" | "persistent-takeover"): TvPresentedEvent {
  return {
    event,
    decision: {
      eventId: event.id, priority, treatment,
      displayForSeconds: treatment === "banner" ? 12 : treatment === "temporary-takeover" ? 20 : null,
      preemptible: treatment !== "persistent-takeover",
    },
  };
}

export function getTvProfileFixture(profileId: string): TvProfileFixture | null {
  return TV_PROFILE_FIXTURES.find((profile) => profile.id === profileId) ?? null;
}

function redactRevenue(screen: TvRevenuePaymentsScreen): void {
  if (screen.data == null) return;
  screen.data.financials = {
    visibility: "redacted",
    direction: screen.data.revenueChangePercent > 0 ? "up" : screen.data.revenueChangePercent < 0 ? "down" : "flat",
    normalizedRevenueTrend: exactRevenueTrend.map((point, index) => ({ label: point.label, value: 100 + index * 4 })),
  };
}

function setNonDataState(screen: TvScreenSnapshot, status: "empty" | "unavailable" | "error"): void {
  screen.sourceStatus = status;
  screen.data = null;
  screen.insight = null;
  screen.diagnosticCode = status === "unavailable" ? "required-app-disabled" : status === "error" ? "source-query-failed" : null;
}

export function createTvFixtureSnapshot(projectId: string, profile: TvProfileFixture, variant: TvFixtureVariant = "default"): TvSnapshot {
  const screens: TvScreenSnapshot[] = structuredClone([
    livePulseScreen, audienceMomentumScreen, revenuePaymentsScreen, emailHealthScreen,
  ]);
  const revenue = screens.find((screen) => screen.id === "revenue-payments")
    ?? throwErr("The centralized TV fixture must include revenue-payments");
  const email = screens.find((screen) => screen.id === "email-health")
    ?? throwErr("The centralized TV fixture must include email-health");

  if (!profile.showExactFinancialValues || variant === "financial-redacted") redactRevenue(revenue);
  if (variant === "empty" || variant === "unavailable") {
    for (const screen of screens) setNonDataState(screen, variant);
  }
  if (variant === "stale") {
    for (const screen of screens) {
      screen.sourceStatus = "stale";
      screen.observedAt = "2026-07-23T13:58:00.000Z";
      screen.insight = null;
    }
  }
  if (variant === "partial-failure") setNonDataState(email, "error");
  if (variant === "insufficient-data") {
    revenue.sourceStatus = "insufficient-data";
    revenue.insight = null;
    if (revenue.data != null) revenue.data.paymentSuccess = { applicableAttempts: 9, percent: null };
    email.sourceStatus = "insufficient-data";
    email.insight = null;
    if (email.data != null) {
      email.data.sent = 19;
      email.data.delivered = 19;
      Object.assign(email.data, calculateFixtureEmailRates(19, 19, 0));
    }
  }

  const banner = variant === "banner" ? presentedEvent(userMilestoneEvent, 1, "banner") : null;
  const takeover = variant === "temporary-takeover"
    ? presentedEvent(userMilestoneEvent, 2, "temporary-takeover")
    : variant === "critical-takeover"
      ? presentedEvent(emailDegradationEvent, 3, "persistent-takeover")
      : null;
  const configuredPlaylist = profile.playlist.filter((entry) => entry.enabled).map((entry) => entry.screenId);
  const playlist: TvProfileFixture["playlist"][number]["screenId"][] = variant === "partial-failure" && configuredPlaylist.includes("email-health")
    ? ["email-health", ...configuredPlaylist.filter((id) => id !== "email-health")]
    : configuredPlaylist;

  return {
    generatedAt: variant === "stale" ? "2026-07-23T13:58:00.000Z" : FIXTURE_NOW,
    staleAfter: variant === "stale" ? "2026-07-23T13:58:45.000Z" : FIXTURE_STALE_AFTER,
    connectionStatus: variant === "offline" ? "offline" : variant === "stale" ? "stale" : "online",
    project: {
      id: projectId,
      displayName: variant === "long-names"
        ? "Acme International Production Platform and Customer Identity Services"
        : "Acme Production",
    },
    profile: {
      id: profile.id,
      displayName: variant === "long-names"
        ? "Global Engineering, Revenue, Customer Success, and Operations Office Display"
        : profile.displayName,
      mode: "general", defaultDurationSeconds: profile.defaultDurationSeconds, playlist,
    },
    screens, presentation: { banner, takeover },
    fatalErrorMessage: variant === "error" ? "The presentation snapshot could not be prepared." : null,
  };
}

export function getTvFixtureSnapshot(projectId: string, profileId: string, variant: TvFixtureVariant = "default"): TvSnapshot | null {
  const profile = getTvProfileFixture(profileId);
  return profile == null ? null : createTvFixtureSnapshot(projectId, profile, variant);
}
