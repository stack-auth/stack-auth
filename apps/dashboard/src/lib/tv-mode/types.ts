import type { TvScreenId } from "@hexclave/shared/dist/interface/admin-tv-mode";

export {
  TV_SCREEN_IDS,
  TV_SNAPSHOT_POLL_INTERVAL_MS,
  TV_SNAPSHOT_STALE_AFTER_MS,
  TvSnapshotSchema,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
export type {
  TvAudienceMomentumScreen,
  TvEmailHealthScreen,
  TvEvent,
  TvLivePulseScreen,
  TvPresentedEvent,
  TvProfileSnapshot,
  TvReportingWindow,
  TvRevenuePaymentsScreen,
  TvScreenId,
  TvScreenSnapshot,
  TvSnapshot,
  TvSourceStatus,
  TvStackedTrendPoint,
  TvStatusFact,
  TvTrendPoint,
} from "@hexclave/shared/dist/interface/admin-tv-mode";

function defineTvFixtureVariants<const TVariants extends readonly string[]>(variants: TVariants): TVariants {
  return variants;
}

export const TV_FIXTURE_VARIANTS = defineTvFixtureVariants([
  "default",
  "banner",
  "temporary-takeover",
  "critical-takeover",
  "stale",
  "offline",
  "loading",
  "empty",
  "insufficient-data",
  "unavailable",
  "partial-failure",
  "financial-redacted",
  "long-names",
  "error",
]);
export type TvFixtureVariant = typeof TV_FIXTURE_VARIANTS[number];

export type TvConnectionStatus = "online" | "stale" | "offline";
export type TvEventKind = "incident" | "celebration";
export type TvEventSeverity = "info" | "warning" | "critical";
export type TvPresentationTreatment =
  | "banner"
  | "temporary-takeover"
  | "persistent-takeover";

export type TvProfileFixture = {
  id: string,
  displayName: string,
  description: string,
  mode: "general",
  defaultDurationSeconds: number,
  playlist: Array<{
    screenId: TvScreenId,
    enabled: boolean,
    durationSecondsOverride: number | null,
  }>,
  incidentLevels: {
    critical: "persistent-takeover" | "disabled",
    high: "temporary-takeover" | "banner" | "disabled",
    medium: "banner" | "disabled",
  },
  incidentTypes: {
    emailDeliveryDegradation: boolean,
  },
  celebrations: {
    userMilestone: boolean,
    revenueMilestone: boolean,
  },
  showExactFinancialValues: boolean,
};
