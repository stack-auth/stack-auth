import {
  type MetricsResponse,
  type MetricsUserCounts,
  type UserActivityResponse,
} from "@hexclave/shared/dist/interface/admin-metrics";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export const hexclaveAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

// Re-export the metrics response type tree from the shared package so dashboard
// code can read these types without having to know where the schemas live.
export type {
  MetricsActivitySplit,
  MetricsAnalyticsOverview,
  MetricsAuthOverview,
  MetricsDailyEmailStatusBreakdown,
  MetricsDailyRevenuePoint,
  MetricsDataPoint,
  MetricsEmailOverview,
  MetricsLoginMethodEntry,
  MetricsNamedCount,
  MetricsPaymentsOverview,
  MetricsRecentEmail,
  MetricsResponse,
  MetricsTopCountry,
  MetricsTopReferrer,
  MetricsTopRegion,
  MetricsUserCounts,
  UserActivityResponse,
} from "@hexclave/shared/dist/interface/admin-metrics";

/**
 * Pulls the typed `useMetrics` hook out of the admin app via the internals
 * symbol. Throws as a programming error if the symbol is missing or malformed
 * — this should never happen at runtime in a correctly-built admin app.
 *
 * Returns the typed `MetricsResponse` shape derived from the same yup schemas
 * the backend route uses, so dashboard call sites do not need `as ...` casts.
 */
export type AnalyticsOverviewFilters = {
  country_code?: string,
  referrer?: string,
  browser?: string,
  os?: string,
  device?: string,
  // ISO 8601 datetimes bounding the analytics top-N breakdowns server-side
  // (top referrers / regions / browsers / OS / devices). The daily and hourly
  // series stay full-window so previous-period deltas can be computed locally.
  since?: string,
  until?: string,
};

// The typed contract for the hooks the admin app exposes through the internals
// symbol. The single `as` assertion in `getInternalsHookOrThrow` is the one
// place the untyped internals object is narrowed to this contract — call sites
// get inferred return types instead of casting each result.
type AdminAppInternalsHooks = {
  useMetrics: (includeAnonymous: boolean, filters?: AnalyticsOverviewFilters) => MetricsResponse,
  useUserActivity: (userId: string) => UserActivityResponse,
  useMetricsUserCounts: () => MetricsUserCounts,
};

function getInternalsHookOrThrow<K extends keyof AdminAppInternalsHooks>(adminApp: object, hookName: K): AdminAppInternalsHooks[K] {
  const internals = Reflect.get(adminApp, hexclaveAppInternalsSymbol);
  if (typeof internals !== "object" || internals == null || !(hookName in internals)) {
    throw new HexclaveAssertionError(`Admin app internals are unavailable: missing ${hookName}`);
  }

  const hook = (internals as Record<string, unknown>)[hookName];
  if (typeof hook !== "function") {
    throw new HexclaveAssertionError(`Admin app internals are unavailable: ${hookName} is not callable`);
  }

  return hook as AdminAppInternalsHooks[K];
}

export function useMetricsOrThrow(
  adminApp: object,
  includeAnonymous: boolean,
  filters?: AnalyticsOverviewFilters,
): MetricsResponse {
  return getInternalsHookOrThrow(adminApp, "useMetrics")(includeAnonymous, filters);
}

/**
 * Pulls the typed `useUserActivity` hook out of the admin app via the internals
 * symbol. Returns the daily event counts for a single user (backed by
 * `GET /internal/user-activity`) in the same `{ date, activity }` shape the
 * metrics endpoints use.
 */
export function useUserActivityOrThrow(adminApp: object, userId: string): UserActivityResponse {
  return getInternalsHookOrThrow(adminApp, "useUserActivity")(userId);
}

export function useMetricsUserCountsOrThrow(adminApp: object): MetricsUserCounts {
  return getInternalsHookOrThrow(adminApp, "useMetricsUserCounts")();
}
