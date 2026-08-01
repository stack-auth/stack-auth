"use client";

import { useCallback, useRef } from "react";
import type { StackAdminApp } from "@hexclave/next";
import { parseServiceIdentityRow, type ServiceIdentity } from "./service-identity";

/**
 * Shared filter vocabulary for the Observability pages.
 *
 * Traces, Logs, and Services each grew their own copy of the time-range table,
 * their own `ALL_SERVICES_SELECT_VALUE`, and their own service-list loader. The
 * copies had already begun to drift — the ranges were declared with three
 * different hour types, so a value that typechecked on one page did not on
 * another. One declaration here removes both the duplication and the drift.
 */

export const OBSERVABILITY_TIME_RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
] as const;

export type ObservabilityTimeRangeHours = (typeof OBSERVABILITY_TIME_RANGES)[number]["hours"];

/** Suggested default. Pages deliberately differ (Logs opens on 30d, Services on 24h). */
export const DEFAULT_OBSERVABILITY_TIME_RANGE_HOURS: ObservabilityTimeRangeHours = 24;

export function isObservabilityTimeRangeHours(hours: number): hours is ObservabilityTimeRangeHours {
  return OBSERVABILITY_TIME_RANGES.some((range) => range.hours === hours);
}

/** DesignPillToggle option list ({ label, id } is that component's shape). */
export const OBSERVABILITY_TIME_RANGE_OPTIONS = OBSERVABILITY_TIME_RANGES.map((range) => ({
  label: range.label,
  id: String(range.hours),
}));

/**
 * Converts a toggle id back to an hours literal. Throws rather than falling back
 * to a default: an unrecognized id means the option list and the parser have
 * diverged, which is a bug to surface, not to paper over. (Each page previously
 * did this inline with a `.find()` whose miss was silently ignored.)
 */
export function parseObservabilityTimeRangeId(id: string): ObservabilityTimeRangeHours {
  const hours = Number(id);
  if (!isObservabilityTimeRangeHours(hours)) {
    throw new Error(`Unknown observability time range: ${id}`);
  }
  return hours;
}

/** The "no service filter" sentinel, shared with service-identity's codec. */
export const ALL_SERVICES_SELECT_VALUE = "all";

/**
 * Loads the distinct service identities a page can filter by, memoized per
 * admin app so remounting a page does not re-query.
 *
 * `refresh` forces a re-query for pages that surface a newly-seen service
 * without a full reload. On failure the memo entry is cleared so the next call
 * retries instead of returning a permanently rejected promise.
 */
export function useServiceIdentityLoader(adminApp: StackAdminApp<false>, query: string) {
  const requestRef = useRef<{ adminApp: StackAdminApp<false>, promise: Promise<ServiceIdentity[]> } | null>(null);

  return useCallback((refresh = false) => {
    const currentRequest = requestRef.current;
    if (!refresh && currentRequest?.adminApp === adminApp) return currentRequest.promise;

    const promise = (async () => {
      try {
        const response = await queryObservability(adminApp, { query, params: {} });
        return response.result.map(parseServiceIdentityRow);
      } catch (error) {
        if (requestRef.current?.adminApp === adminApp) {
          requestRef.current = null;
        }
        throw error;
      }
    })();
    requestRef.current = { adminApp, promise };
    return promise;
  }, [adminApp, query]);
}

/**
 * `queryAnalytics` with the options every Observability call site passed
 * identically. Branch scoping stays off because these pages are always scoped to
 * the branch the dashboard is viewing; the timeout is the read-only query budget.
 */
export function queryObservability(adminApp: StackAdminApp<false>, options: { query: string, params: Record<string, unknown> }) {
  return adminApp.queryAnalytics({
    query: options.query,
    params: options.params,
    include_all_branches: false,
    timeout_ms: 30000,
  });
}
