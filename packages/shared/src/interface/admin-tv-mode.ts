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

const TvScreenIdSchema = yupString().oneOf(TV_SCREEN_IDS).defined();
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
  status: yupString().oneOf(["healthy", "insufficient-data", "unavailable"]).defined(),
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
  kind: yupString().oneOf(["incident", "celebration"]).defined(),
  type: yupString().oneOf(["email-delivery-degradation", "user-milestone"]).defined(),
  severity: yupString().oneOf(["info", "warning", "critical"]).defined(),
  title: yupString().defined(),
  summary: yupString().defined(),
  metricLabel: yupString().defined(),
  metricValue: yupString().defined(),
  sourceLabel: yupString().defined(),
  startedAt: yupString().defined(),
}).noUnknown().defined();

const TvPresentationDecisionSchema = yupObject({
  eventId: yupString().defined(),
  priority: yupNumber().oneOf([1, 2, 3]).defined(),
  treatment: yupString().oneOf(["banner", "temporary-takeover", "persistent-takeover"]).defined(),
  displayForSeconds: yupNumber().min(1).nullable().defined(),
  preemptible: yupBoolean().defined(),
}).noUnknown().defined();

const TvPresentedEventSchema = yupObject({
  event: TvEventSchema,
  decision: TvPresentationDecisionSchema,
}).noUnknown().defined();

export const TvProfileSnapshotSchema = yupObject({
  id: yupString().defined(),
  displayName: yupString().defined(),
  mode: yupString().oneOf(["general"]).defined(),
  defaultDurationSeconds: yupNumber().integer().min(1).defined(),
  playlist: yupArray(TvScreenIdSchema).min(1).defined(),
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
    banner: TvPresentedEventSchema.nullable().defined(),
    takeover: TvPresentedEventSchema.nullable().defined(),
  }).noUnknown().defined(),
  fatalErrorMessage: yupString().nullable().defined(),
}).noUnknown().defined().test(
  "tv-snapshot-screen-integrity",
  "TV snapshot screens and profile playlist must contain unique, known screen IDs",
  (snapshot) => {
    const screenIds = snapshot.screens.map((screen) => screen.id);
    const uniqueScreenIds = new Set(screenIds);
    const uniquePlaylistIds = new Set(snapshot.profile.playlist);
    return uniqueScreenIds.size === TV_SCREEN_IDS.length
      && TV_SCREEN_IDS.every((screenId) => uniqueScreenIds.has(screenId))
      && uniquePlaylistIds.size === snapshot.profile.playlist.length
      && snapshot.profile.playlist.every((screenId) => uniqueScreenIds.has(screenId));
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
export type TvPresentationDecision = yup.InferType<typeof TvPresentationDecisionSchema>;
export type TvPresentedEvent = yup.InferType<typeof TvPresentedEventSchema>;
export type TvProfileSnapshot = yup.InferType<typeof TvProfileSnapshotSchema>;
export type TvSnapshot = yup.InferType<typeof TvSnapshotSchema>;

export type TvBuiltInProfile = {
  id: string,
  displayName: string,
  defaultDurationSeconds: number,
  playlist: TvScreenId[],
};

export const TV_BUILT_IN_PROFILES: readonly TvBuiltInProfile[] = [
  {
    id: "engineering-office",
    displayName: "Engineering Office TV",
    defaultDurationSeconds: 20,
    playlist: ["live-pulse", "audience-momentum", "email-health"],
  },
  {
    id: "company-pulse",
    displayName: "Company Pulse",
    defaultDurationSeconds: 20,
    playlist: [...TV_SCREEN_IDS],
  },
];

export function getTvBuiltInProfile(profileId: string): TvBuiltInProfile | null {
  return TV_BUILT_IN_PROFILES.find((profile) => profile.id === profileId) ?? null;
}
