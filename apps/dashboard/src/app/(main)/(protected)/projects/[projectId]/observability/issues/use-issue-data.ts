"use client";

import type { StackAdminApp } from "@hexclave/next";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventSparklineBucket } from "../event-sparkline";
import { queryObservability } from "../filters";
import type { ObservabilityTimeRangeHours } from "../filters";
import {
  getIssueFacetsQuery,
  getIssueSparklineQuery,
  parseIssueFacetRows,
  parseIssueSparklineRows,
  type IssueFacets,
  type IssueListItem,
} from "./issues-data";

/**
 * The two ClickHouse-backed loaders behind the Issues list.
 *
 * Together with the one `internal/issues` REST call, they are the page's entire
 * network budget: **3 requests for the first page and 2 for every append,
 * independent of how many rows are on screen.** Facets only move when the time
 * range does, and sparklines are batched across the whole page. An N+1 here
 * (one sparkline query per row) is the single easiest way to make this page
 * unusable, so both loaders are written to make that impossible rather than
 * merely unlikely.
 */

// ─── Facets ──────────────────────────────────────────────────────────

const EMPTY_FACETS: IssueFacets = { services: [], environments: [] };

/**
 * Distinct services / environments for the filter dropdowns, memoized per
 * (admin app, time range) so switching tabs, sorting, or paging never re-asks.
 * Mirrors `useServiceIdentityLoader`, including clearing a failed entry so the
 * next call retries instead of returning a permanently rejected promise.
 */
export function useIssueFacetsLoader(adminApp: StackAdminApp<false>) {
  const cacheRef = useRef<{ adminApp: StackAdminApp<false>, byHours: Map<number, Promise<IssueFacets>> } | null>(null);

  return useCallback((hours: ObservabilityTimeRangeHours) => {
    if (cacheRef.current?.adminApp !== adminApp) {
      cacheRef.current = { adminApp, byHours: new Map() };
    }
    const cache = cacheRef.current;
    const cached = cache.byHours.get(hours);
    if (cached != null) return cached;

    const promise = (async () => {
      try {
        const { query, params } = getIssueFacetsQuery(hours);
        const response = await queryObservability(adminApp, { query, params });
        return parseIssueFacetRows(response.result);
      } catch (error) {
        if (cacheRef.current === cache) cache.byHours.delete(hours);
        throw error;
      }
    })();
    cache.byHours.set(hours, promise);
    return promise;
  }, [adminApp]);
}

export function useIssueFacets(adminApp: StackAdminApp<false>, hours: ObservabilityTimeRangeHours) {
  const loadFacets = useIssueFacetsLoader(adminApp);
  const [facets, setFacets] = useState<IssueFacets>(EMPTY_FACETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    runAsynchronously(async () => {
      try {
        const next = await loadFacets(hours);
        if (cancelled) return;
        setFacets(next);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        // Surfaced by the caller as a non-blocking notice: the filters degrade
        // to "no options", but the issue list itself is unaffected and must
        // still render.
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadFacets, hours]);

  useEffect(() => reload(), [reload]);

  return { facets, loading, error };
}

// ─── Sparklines ──────────────────────────────────────────────────────

const EMPTY_SPARKLINES: ReadonlyMap<string, readonly EventSparklineBucket[]> = new Map();

export type IssueSparklines = {
  /** Keyed by issue hash. A missing key means "still loading". */
  byHash: ReadonlyMap<string, readonly EventSparklineBucket[]>,
  error: Error | null,
  /** Re-requests everything currently on screen. */
  retry: () => void,
};

/**
 * Occurrence volume per issue, fetched **once per page of rows**.
 *
 * Rows render immediately with a flat hairline where the chart will be; the
 * sparkline never gates row display, and its failure never blocks triage. The
 * cache is keyed by time range, so changing the range drops it wholesale rather
 * than leaving 24h bars under a 7d header.
 */
export function useIssueSparklines(
  adminApp: StackAdminApp<false>,
  hours: ObservabilityTimeRangeHours,
  rows: readonly IssueListItem[],
): IssueSparklines {
  const [cache, setCache] = useState<{
    hours: ObservabilityTimeRangeHours,
    byHash: ReadonlyMap<string, readonly EventSparklineBucket[]>,
  }>({ hours, byHash: EMPTY_SPARKLINES });
  const [error, setError] = useState<Error | null>(null);
  // Hashes with a request in flight. Kept in a ref rather than state because a
  // second effect run must see the update synchronously — going through
  // setState would let the same hash be requested twice before React re-renders.
  const inFlightRef = useRef<{ hours: ObservabilityTimeRangeHours, hashes: Set<string> }>({ hours, hashes: new Set() });
  const [retryToken, setRetryToken] = useState(0);

  const byHash = cache.hours === hours ? cache.byHash : EMPTY_SPARKLINES;

  // `rows` gets a fresh array identity on every fetch, so depending on it
  // directly would re-run the effect for free. Round-tripping the hash list
  // through a string gives the array a content-stable identity, which is the
  // dependency the effect actually has. A newline separator can't appear in a
  // hex hash, so the split is exact.
  const visibleHashesKey = useMemo(
    () => [...new Set(rows.flatMap((row) => row.issue_hashes))].join("\n"),
    [rows],
  );
  const visibleHashes = useMemo(
    () => (visibleHashesKey === "" ? [] : visibleHashesKey.split("\n")),
    [visibleHashesKey],
  );

  useEffect(() => {
    void retryToken;
    if (inFlightRef.current.hours !== hours) {
      inFlightRef.current = { hours, hashes: new Set() };
    }
    const inFlight = inFlightRef.current.hashes;

    const wanted = visibleHashes.filter((hash) => !byHash.has(hash) && !inFlight.has(hash));
    if (wanted.length === 0) return;
    for (const hash of wanted) inFlight.add(hash);

    let cancelled = false;
    runAsynchronously(async () => {
      try {
        const { query, params } = getIssueSparklineQuery(hours, wanted);
        const response = await queryObservability(adminApp, { query, params });
        const parsed = parseIssueSparklineRows(response.result, wanted);
        if (cancelled) return;
        setError(null);
        setCache((current) => {
          const base = current.hours === hours ? current.byHash : EMPTY_SPARKLINES;
          const next = new Map(base);
          for (const [hash, buckets] of parsed) {
            next.set(hash, buckets.map((bucket) => ({ key: bucket.bucketMs, value: bucket.occurrences })));
          }
          return { hours, byHash: next };
        });
      } catch (caught) {
        // Release the hashes so a retry (or the next page) can ask again, and
        // surface the failure — a silently missing chart is indistinguishable
        // from an issue that genuinely had no occurrences.
        for (const hash of wanted) inFlight.delete(hash);
        if (cancelled) return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [adminApp, hours, visibleHashes, byHash, retryToken]);

  const retry = useCallback(() => {
    setError(null);
    setRetryToken((token) => token + 1);
  }, []);

  return { byHash, error, retry };
}
