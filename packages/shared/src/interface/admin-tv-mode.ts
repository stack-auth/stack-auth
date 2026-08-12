import yup from "yup";
import {
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupUnion,
} from "../schema-fields";

export const TV_SCREEN_IDS = [
  "live-pulse",
  "audience-momentum",
  "revenue-payments",
  "email-health",
] as const;

export const TV_MINIMUM_PAYMENT_ATTEMPTS = 10;
export const TV_MINIMUM_FINISHED_SENDS = 20;
export const TV_SNAPSHOT_POLL_INTERVAL_MS = 15_000;
export const TV_SNAPSHOT_STALE_AFTER_MS = 45_000;

export function calculateTvPaymentSuccessPercent(applicableAttempts: number, successfulAttempts: number): number | null {
  if (applicableAttempts < TV_MINIMUM_PAYMENT_ATTEMPTS) return null;
  return Math.round((successfulAttempts / applicableAttempts) * 1000) / 10;
}

export function calculateTvEmailRates(
  finishedSends: number,
  delivered: number,
  bounced: number,
): { deliveryRatePercent: number | null, bounceRatePercent: number | null } {
  if (finishedSends < TV_MINIMUM_FINISHED_SENDS) {
    return { deliveryRatePercent: null, bounceRatePercent: null };
  }
  return {
    deliveryRatePercent: Math.round(Math.min(delivered / finishedSends, 1) * 1000) / 10,
    bounceRatePercent: Math.round(Math.min(bounced / finishedSends, 1) * 1000) / 10,
  };
}

export const TvScreenIdSchema = yupString().oneOf(TV_SCREEN_IDS).defined();
const TvSourceStatusSchema = yupString()
  .oneOf(["ready", "empty", "insufficient-data", "unavailable", "error", "stale"])
  .defined();

const TvReportingWindowSchema = yupObject({
  current: yupObject({
    startsAt: yupString().defined(),
    endsAt: yupString().defined(),
    label: yupString().defined(),
  }).noUnknown().defined(),
  comparison: yupObject({
    startsAt: yupString().defined(),
    endsAt: yupString().defined(),
    label: yupString().defined(),
  }).noUnknown().nullable().defined(),
}).noUnknown().defined();

const TvTrendPointSchema = yupObject({
  label: yupString().defined(),
  value: yupNumber().defined(),
}).noUnknown().defined();

const TvStackedTrendPointSchema = yupObject({
  label: yupString().defined(),
  primary: yupNumber().defined(),
  secondary: yupNumber().defined(),
  tertiary: yupNumber().defined(),
}).noUnknown().defined();

const TvStatusFactSchema = yupObject({
  label: yupString().defined(),
  status: yupString().oneOf(["healthy", "ready", "empty", "insufficient-data", "unavailable", "error", "stale"]).defined(),
  value: yupString().defined(),
  detail: yupString().defined(),
}).noUnknown().defined();

const TvScreenEnvelopeSchema = {
  sourceStatus: TvSourceStatusSchema,
  sourceLabel: yupString().defined(),
  observedAt: yupString().defined(),
  window: TvReportingWindowSchema,
  diagnosticCode: yupString().nullable().defined(),
};

function isTvScreenDataStateConsistent(screen: {
  sourceStatus?: string,
  data?: unknown,
  insight?: unknown,
} | undefined): boolean {
  if (screen == null) return false;
  if (screen.sourceStatus === "empty" || screen.sourceStatus === "unavailable" || screen.sourceStatus === "error") {
    return screen.data === null && screen.insight === null;
  }
  return screen.data != null;
}

export const TvLivePulseScreenSchema = yupObject({
  id: yupString().oneOf(["live-pulse"]).defined(),
  ...TvScreenEnvelopeSchema,
  data: yupObject({
    liveUsers: yupNumber().integer().min(0).defined(),
    todayActiveUsers: yupNumber().integer().min(0).defined(),
    hourlyActivity: yupArray(TvTrendPointSchema).defined(),
    sourceHealth: yupArray(TvStatusFactSchema).defined(),
  }).noUnknown().nullable().defined(),
  insight: yupObject({
    kind: yupString().oneOf(["live-activity-above-baseline"]).defined(),
    message: yupString().defined(),
    evidence: yupObject({
      currentLiveUsers: yupNumber().min(0).defined(),
      baselineLiveUsers: yupNumber().min(0).defined(),
      deltaPercent: yupNumber().defined(),
    }).noUnknown().defined(),
  }).noUnknown().nullable().defined(),
}).noUnknown().defined().test("source-data-state", "TV source state is inconsistent with its data", isTvScreenDataStateConsistent);

export const TvAudienceMomentumScreenSchema = yupObject({
  id: yupString().oneOf(["audience-momentum"]).defined(),
  ...TvScreenEnvelopeSchema,
  data: yupObject({
    totalUsers: yupNumber().integer().min(0).defined(),
    userGrowthPercent: yupNumber().defined(),
    newUsers: yupNumber().integer().min(0).defined(),
    monthlyActiveUsers: yupNumber().integer().min(0).defined(),
    visitors: yupNumber().integer().min(0).defined(),
    averageSessionSeconds: yupNumber().min(0).defined(),
    verificationRatePercent: yupNumber().min(0).max(100).defined(),
    lifecycle: yupArray(TvStackedTrendPointSchema).defined(),
  }).noUnknown().nullable().defined(),
  insight: yupObject({
    kind: yupString().oneOf(["returning-users-leading"]).defined(),
    message: yupString().defined(),
    evidence: yupObject({
      newActivity: yupNumber().integer().min(0).defined(),
      retainedActivity: yupNumber().integer().min(0).defined(),
      reactivatedActivity: yupNumber().integer().min(0).defined(),
      leadMarginPercent: yupNumber().min(0).defined(),
    }).noUnknown().defined(),
  }).noUnknown().nullable().defined(),
}).noUnknown().defined().test("source-data-state", "TV source state is inconsistent with its data", isTvScreenDataStateConsistent);

const TvExactFinancialsSchema = yupObject({
  visibility: yupString().oneOf(["exact"]).defined(),
  paidRevenueCents: yupNumber().integer().defined(),
  mrrProxyCents: yupNumber().integer().defined(),
  revenueTrend: yupArray(TvTrendPointSchema).defined(),
}).noUnknown().defined();

const TvRedactedFinancialsSchema = yupObject({
  visibility: yupString().oneOf(["redacted"]).defined(),
  direction: yupString().oneOf(["up", "down", "flat"]).defined(),
  normalizedRevenueTrend: yupArray(TvTrendPointSchema).defined(),
}).noUnknown().defined();

export const TvRevenuePaymentsScreenSchema = yupObject({
  id: yupString().oneOf(["revenue-payments"]).defined(),
  ...TvScreenEnvelopeSchema,
  data: yupObject({
    financials: yupUnion(TvExactFinancialsSchema, TvRedactedFinancialsSchema).defined(),
    revenueChangePercent: yupNumber().defined(),
    activeSubscriptions: yupNumber().integer().min(0).defined(),
    newSubscriptions: yupNumber().integer().min(0).defined(),
    pastDueSubscriptions: yupNumber().integer().min(0).defined(),
    paymentSuccess: yupObject({
      applicableAttempts: yupNumber().integer().min(0).defined(),
      percent: yupNumber().min(0).max(100).nullable().defined(),
    }).noUnknown().defined(),
  }).noUnknown().nullable().defined(),
  insight: yupObject({
    kind: yupString().oneOf(["revenue-up-payments-stable"]).defined(),
    message: yupString().defined(),
    evidence: yupObject({
      revenueChangePercent: yupNumber().defined(),
      paymentSuccessPercent: yupNumber().min(0).max(100).defined(),
      applicablePaymentAttempts: yupNumber().integer().min(0).defined(),
    }).noUnknown().defined(),
  }).noUnknown().nullable().defined(),
}).noUnknown().defined()
  .test("source-data-state", "TV source state is inconsistent with its data", isTvScreenDataStateConsistent)
  .test("payment-sample-threshold", "TV payment sample threshold is inconsistent", (screen) => {
    if (screen.data == null) return true;
    const { applicableAttempts, percent } = screen.data.paymentSuccess;
    if (applicableAttempts < TV_MINIMUM_PAYMENT_ATTEMPTS) {
      return screen.sourceStatus === "insufficient-data" && percent === null && screen.insight === null;
    }
    return screen.sourceStatus !== "insufficient-data" && percent !== null;
  });

export const TvEmailHealthScreenSchema = yupObject({
  id: yupString().oneOf(["email-health"]).defined(),
  ...TvScreenEnvelopeSchema,
  data: yupObject({
    sent: yupNumber().integer().min(0).defined(),
    delivered: yupNumber().integer().min(0).defined(),
    bounced: yupNumber().integer().min(0).defined(),
    errors: yupNumber().integer().min(0).defined(),
    inProgress: yupNumber().integer().min(0).defined(),
    deliveryRatePercent: yupNumber().min(0).max(100).nullable().defined(),
    bounceRatePercent: yupNumber().min(0).max(100).nullable().defined(),
    volumeChangePercent: yupNumber().defined(),
    statusTrend: yupArray(TvStackedTrendPointSchema).defined(),
  }).noUnknown().nullable().defined(),
  insight: yupObject({
    kind: yupString().oneOf(["delivery-healthy-volume-up"]).defined(),
    message: yupString().defined(),
    evidence: yupObject({
      deliveryRatePercent: yupNumber().min(0).max(100).defined(),
      volumeChangePercent: yupNumber().defined(),
      finishedSends: yupNumber().integer().min(0).defined(),
    }).noUnknown().defined(),
  }).noUnknown().nullable().defined(),
}).noUnknown().defined()
  .test("source-data-state", "TV source state is inconsistent with its data", isTvScreenDataStateConsistent)
  .test("email-sample-threshold", "TV email sample threshold is inconsistent", (screen) => {
    if (screen.data == null) return true;
    if (screen.data.sent < TV_MINIMUM_FINISHED_SENDS) {
      return screen.sourceStatus === "insufficient-data"
        && screen.data.deliveryRatePercent === null
        && screen.data.bounceRatePercent === null
        && screen.insight === null;
    }
    return screen.sourceStatus !== "insufficient-data"
      && screen.data.deliveryRatePercent !== null
      && screen.data.bounceRatePercent !== null;
  });

export const TvScreenSnapshotSchema = yupUnion(
  TvLivePulseScreenSchema,
  TvAudienceMomentumScreenSchema,
  TvRevenuePaymentsScreenSchema,
  TvEmailHealthScreenSchema,
).defined();

const TvEventSchema = yupObject({
  id: yupString().defined(),
  type: yupString().oneOf(["email-delivery-degradation", "user-milestone"]).defined(),
  presentationClass: yupString().oneOf(["celebration", "incident", "critical-incident"]).defined(),
  status: yupString().oneOf(["active", "resolved"]).defined(),
  title: yupString().defined(),
  summary: yupString().defined(),
  metricLabel: yupString().defined(),
  metricValue: yupString().defined(),
  expectedRange: yupString().nullable().defined(),
  sourceLabel: yupString().defined(),
  occurredAt: yupString().defined(),
  updatedAt: yupString().defined(),
}).noUnknown().defined();

const TvPresentedTakeoverSchema = yupObject({
  event: TvEventSchema,
  variant: yupString().oneOf(["celebration", "incident", "critical-incident", "recovery-confirmation"]).defined(),
  startedAt: yupString().defined(),
  endsAt: yupString().defined(),
}).noUnknown().defined().test({
  name: "takeover-lifecycle-integrity",
  message: "TV takeover variant, event lifecycle, and deadline are inconsistent",
  skipAbsent: true,
  test: (takeover) => {
    const startedAt = Date.parse(takeover.startedAt);
    const endsAt = Date.parse(takeover.endsAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) return false;
    if (takeover.variant === "celebration") {
      return takeover.event.presentationClass === "celebration"
        && takeover.event.status === "active"
        && Number.isFinite(endsAt);
    }
    if (takeover.variant === "recovery-confirmation") {
      return takeover.event.presentationClass !== "celebration"
        && takeover.event.status === "resolved"
        && Number.isFinite(endsAt);
    }
    return takeover.event.presentationClass === takeover.variant
      && takeover.event.status === "active"
      && Number.isFinite(endsAt);
  },
});

const TvPresentedEventHighlightSchema = yupObject({
  event: TvEventSchema,
  variant: yupString().oneOf(["celebration", "active-incident", "resolved-incident"]).defined(),
  expiresAt: yupString().nullable().defined(),
  animationExpiresAt: yupString().nullable().defined(),
}).noUnknown().defined().test({
  name: "event-highlight-lifecycle-integrity",
  message: "TV Event Highlight variant and deadlines are inconsistent",
  skipAbsent: true,
  test: (highlight) => {
    const expiresAt = highlight.expiresAt == null ? null : Date.parse(highlight.expiresAt);
    const animationExpiresAt = highlight.animationExpiresAt == null ? null : Date.parse(highlight.animationExpiresAt);
    if (
      (expiresAt != null && !Number.isFinite(expiresAt))
      || (animationExpiresAt != null && !Number.isFinite(animationExpiresAt))
    ) return false;
    if (highlight.variant === "celebration") {
      return highlight.event.presentationClass === "celebration"
        && expiresAt != null
        && animationExpiresAt != null
        && animationExpiresAt <= expiresAt;
    }
    if (highlight.variant === "active-incident") {
      return highlight.event.presentationClass !== "celebration"
        && highlight.event.status === "active"
        && expiresAt == null
        && animationExpiresAt == null;
    }
    return highlight.event.presentationClass !== "celebration"
      && highlight.event.status === "resolved"
      && expiresAt != null
      && animationExpiresAt == null;
  },
});

export const TvProfileSnapshotSchema = yupObject({
  id: yupString().defined(),
  displayName: yupString().defined(),
  mode: yupString().oneOf(["general"]).defined(),
  defaultDurationSeconds: yupNumber().integer().min(1).defined(),
  playlist: yupArray(TvScreenIdSchema).min(1).defined(),
  screenDurations: yupArray(yupObject({
    screenId: TvScreenIdSchema,
    durationSeconds: yupNumber().integer().min(1).defined(),
  }).noUnknown().defined()).optional(),
}).noUnknown().defined();

export const TvSnapshotSchema = yupObject({
  generatedAt: yupString().defined(),
  staleAfter: yupString().defined(),
  connectionStatus: yupString().oneOf(["online", "stale", "offline"]).defined(),
  project: yupObject({
    id: yupString().defined(),
    displayName: yupString().defined(),
  }).noUnknown().defined(),
  profile: TvProfileSnapshotSchema,
  screens: yupArray(TvScreenSnapshotSchema).length(TV_SCREEN_IDS.length).defined(),
  presentation: yupObject({
    takeover: TvPresentedTakeoverSchema.nullable().defined(),
    highlight: TvPresentedEventHighlightSchema.nullable().defined(),
  }).noUnknown().defined(),
  fatalErrorMessage: yupString().nullable().defined(),
}).noUnknown().defined().test(
  "tv-snapshot-screen-integrity",
  "TV snapshot screens and profile playlist must contain unique, known screen IDs",
  (snapshot) => {
    const screenIds = snapshot.screens.map((screen) => screen.id);
    const uniqueScreenIds = new Set(screenIds);
    const uniquePlaylistIds = new Set(snapshot.profile.playlist);
    const durationScreenIds = snapshot.profile.screenDurations?.map((entry) => entry.screenId);
    return uniqueScreenIds.size === TV_SCREEN_IDS.length
      && TV_SCREEN_IDS.every((screenId) => uniqueScreenIds.has(screenId))
      && uniquePlaylistIds.size === snapshot.profile.playlist.length
      && snapshot.profile.playlist.every((screenId) => uniqueScreenIds.has(screenId))
      && (durationScreenIds == null
        || (
          durationScreenIds.length === snapshot.profile.playlist.length
          && durationScreenIds.every((screenId, index) => screenId === snapshot.profile.playlist[index])
        ));
  },
);

export type TvScreenId = yup.InferType<typeof TvScreenIdSchema>;
export type TvSourceStatus = yup.InferType<typeof TvSourceStatusSchema>;
export type TvReportingWindow = yup.InferType<typeof TvReportingWindowSchema>;
export type TvTrendPoint = yup.InferType<typeof TvTrendPointSchema>;
export type TvStackedTrendPoint = yup.InferType<typeof TvStackedTrendPointSchema>;
export type TvStatusFact = yup.InferType<typeof TvStatusFactSchema>;
export type TvLivePulseScreen = yup.InferType<typeof TvLivePulseScreenSchema>;
export type TvAudienceMomentumScreen = yup.InferType<typeof TvAudienceMomentumScreenSchema>;
export type TvRevenuePaymentsScreen = yup.InferType<typeof TvRevenuePaymentsScreenSchema>;
export type TvEmailHealthScreen = yup.InferType<typeof TvEmailHealthScreenSchema>;
export type TvScreenSnapshot = yup.InferType<typeof TvScreenSnapshotSchema>;
export type TvEvent = yup.InferType<typeof TvEventSchema>;
export type TvPresentedTakeover = yup.InferType<typeof TvPresentedTakeoverSchema>;
export type TvPresentedEventHighlight = yup.InferType<typeof TvPresentedEventHighlightSchema>;
export type TvProfileSnapshot = yup.InferType<typeof TvProfileSnapshotSchema>;
export type TvSnapshot = yup.InferType<typeof TvSnapshotSchema>;

export const TV_PROFILE_DURATION_SECONDS = [15, 16, 18, 20, 30] as const;

export const TvProfilePlaylistEntrySchema = yupObject({
  screenId: TvScreenIdSchema,
  durationSecondsOverride: yupNumber().integer().oneOf(TV_PROFILE_DURATION_SECONDS).nullable().defined(),
}).noUnknown().defined();
export const TvProfilePlaylistSchema = yupArray(TvProfilePlaylistEntrySchema).min(1).defined();

export const TV_TAKEOVER_DURATION_SECONDS = [30, 60, 90, 120] as const;
export const TV_CELEBRATION_ANIMATION_DURATION_SECONDS = [600, 1800, 3600, 7200] as const;
export const TV_EVENT_HIGHLIGHT_DURATION_SECONDS = [3600, 21600, 43200, 86400] as const;

export const TvInterruptionPreferencesSchema = yupObject({
  incidentTypes: yupObject({
    emailDeliveryDegradation: yupBoolean().defined(),
  }).noUnknown().defined(),
  celebrations: yupObject({
    userMilestone: yupBoolean().defined(),
    revenueMilestone: yupBoolean().defined(),
  }).noUnknown().defined(),
  timing: yupObject({
    celebration: yupObject({
      takeoverSeconds: yupNumber().integer().oneOf(TV_TAKEOVER_DURATION_SECONDS).defined(),
      animationSeconds: yupNumber().integer().oneOf(TV_CELEBRATION_ANIMATION_DURATION_SECONDS).defined(),
      highlightSeconds: yupNumber().integer().oneOf(TV_EVENT_HIGHLIGHT_DURATION_SECONDS).defined(),
    }).noUnknown().defined(),
    incident: yupObject({
      takeoverSeconds: yupNumber().integer().oneOf(TV_TAKEOVER_DURATION_SECONDS).defined(),
      recoveryTakeoverSeconds: yupNumber().integer().oneOf(TV_TAKEOVER_DURATION_SECONDS).defined(),
      resolvedHighlightSeconds: yupNumber().integer().oneOf(TV_EVENT_HIGHLIGHT_DURATION_SECONDS).defined(),
    }).noUnknown().defined(),
    criticalIncident: yupObject({
      takeoverSeconds: yupNumber().integer().oneOf(TV_TAKEOVER_DURATION_SECONDS).defined(),
      recoveryTakeoverSeconds: yupNumber().integer().oneOf(TV_TAKEOVER_DURATION_SECONDS).defined(),
      resolvedHighlightSeconds: yupNumber().integer().oneOf(TV_EVENT_HIGHLIGHT_DURATION_SECONDS).defined(),
    }).noUnknown().defined(),
  }).noUnknown().defined(),
}).noUnknown().defined().test(
  "celebration-animation-within-highlight",
  "Celebration animation must not outlive its Event Highlight",
  (preferences) => preferences.timing.celebration.animationSeconds <= preferences.timing.celebration.highlightSeconds,
);

export const TvProfileConfigurationSchema = yupObject({
  displayName: yupString().trim().min(1).max(80).defined(),
  description: yupString().max(240).defined(),
  mode: yupString().oneOf(["general"]).defined(),
  defaultDurationSeconds: yupNumber().integer().oneOf(TV_PROFILE_DURATION_SECONDS).defined(),
  playlist: TvProfilePlaylistSchema,
  interruptionPreferences: TvInterruptionPreferencesSchema,
  financialVisibility: yupString().oneOf(["redacted", "exact"]).defined(),
}).noUnknown().defined()
  .test("unique-playlist-screens", "TV profile playlist must contain unique screen IDs", (profile) => (
    new Set(profile.playlist.map((entry) => entry.screenId)).size === profile.playlist.length
  ))
  .test("financial-celebration-privacy", "Revenue milestones require exact financial visibility", (profile) => (
    profile.financialVisibility === "exact" || !profile.interruptionPreferences.celebrations.revenueMilestone
  ));

const TvProfileResourceFields = {
  id: yupString().defined(),
  configuration: TvProfileConfigurationSchema,
};

export const TvBuiltInProfileResourceSchema = yupObject({
  ...TvProfileResourceFields,
  origin: yupString().oneOf(["built-in"]).defined(),
  version: yupNumber().nullable().oneOf([null]).defined(),
  createdAt: yupString().nullable().oneOf([null]).defined(),
  updatedAt: yupString().nullable().oneOf([null]).defined(),
}).noUnknown().defined();

export const TvSavedProfileResourceSchema = yupObject({
  ...TvProfileResourceFields,
  id: yupString().uuid().defined(),
  origin: yupString().oneOf(["saved"]).defined(),
  version: yupNumber().integer().min(1).defined(),
  createdAt: yupString().defined(),
  updatedAt: yupString().defined(),
}).noUnknown().defined();

export const TvProfileResourceSchema = yupUnion(
  TvBuiltInProfileResourceSchema,
  TvSavedProfileResourceSchema,
).defined();

export type TvProfilePlaylistEntry = yup.InferType<typeof TvProfilePlaylistEntrySchema>;
export type TvInterruptionPreferences = yup.InferType<typeof TvInterruptionPreferencesSchema>;
export type TvProfileConfiguration = yup.InferType<typeof TvProfileConfigurationSchema>;
export type TvBuiltInProfileResource = yup.InferType<typeof TvBuiltInProfileResourceSchema>;
export type TvSavedProfileResource = yup.InferType<typeof TvSavedProfileResourceSchema>;
export type TvProfileResource = yup.InferType<typeof TvProfileResourceSchema>;

export type TvBuiltInProfile = TvBuiltInProfileResource;

const defaultInterruptionPreferences: TvInterruptionPreferences = {
  incidentTypes: { emailDeliveryDegradation: true },
  celebrations: { userMilestone: true, revenueMilestone: false },
  timing: {
    celebration: { takeoverSeconds: 60, animationSeconds: 3600, highlightSeconds: 21600 },
    incident: { takeoverSeconds: 60, recoveryTakeoverSeconds: 30, resolvedHighlightSeconds: 3600 },
    criticalIncident: { takeoverSeconds: 120, recoveryTakeoverSeconds: 60, resolvedHighlightSeconds: 21600 },
  },
};

export const TV_BUILT_IN_PROFILES: readonly TvBuiltInProfile[] = [
  {
    id: "engineering-office",
    origin: "built-in",
    version: null,
    createdAt: null,
    updatedAt: null,
    configuration: {
      displayName: "Engineering Office TV",
      description: "A broad company pulse for the engineering workspace.",
      mode: "general",
      defaultDurationSeconds: 20,
      playlist: [
        { screenId: "live-pulse", durationSecondsOverride: 15 },
        { screenId: "audience-momentum", durationSecondsOverride: 20 },
        { screenId: "email-health", durationSecondsOverride: 18 },
      ],
      interruptionPreferences: defaultInterruptionPreferences,
      financialVisibility: "redacted",
    },
  },
  {
    id: "company-pulse",
    origin: "built-in",
    version: null,
    createdAt: null,
    updatedAt: null,
    configuration: {
      displayName: "Company Pulse",
      description: "The complete General Mode rotation for shared office spaces.",
      mode: "general",
      defaultDurationSeconds: 20,
      playlist: [
        { screenId: "live-pulse", durationSecondsOverride: 15 },
        { screenId: "audience-momentum", durationSecondsOverride: 20 },
        { screenId: "revenue-payments", durationSecondsOverride: 18 },
        { screenId: "email-health", durationSecondsOverride: 18 },
      ],
      interruptionPreferences: defaultInterruptionPreferences,
      financialVisibility: "redacted",
    },
  },
];

export function getTvBuiltInProfile(profileId: string): TvBuiltInProfile | null {
  return TV_BUILT_IN_PROFILES.find((profile) => profile.id === profileId) ?? null;
}
