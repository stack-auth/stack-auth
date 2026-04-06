import {
  type MetricsResponse,
} from "@stackframe/stack-shared/dist/interface/admin-metrics";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

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
  MetricsPaymentsOverview,
  MetricsRecentEmail,
  MetricsResponse,
  MetricsTopReferrer,
  MetricsTopRegion,
} from "@stackframe/stack-shared/dist/interface/admin-metrics";

/**
 * Pulls the typed `useMetrics` hook out of the admin app via the internals
 * symbol. Throws as a programming error if the symbol is missing or malformed
 * — this should never happen at runtime in a correctly-built admin app.
 *
 * Returns the typed `MetricsResponse` shape derived from the same yup schemas
 * the backend route uses, so dashboard call sites do not need `as ...` casts.
 */
export function useMetricsOrThrow(adminApp: object, includeAnonymous: boolean): MetricsResponse {
  const internals = Reflect.get(adminApp, stackAppInternalsSymbol);
  if (typeof internals !== "object" || internals == null || !("useMetrics" in internals)) {
    throw new StackAssertionError("Admin app internals are unavailable: missing useMetrics");
  }

  const useMetrics = internals.useMetrics;
  if (typeof useMetrics !== "function") {
    throw new StackAssertionError("Admin app internals are unavailable: useMetrics is not callable");
  }

  return useMetrics(includeAnonymous) as MetricsResponse;
}
