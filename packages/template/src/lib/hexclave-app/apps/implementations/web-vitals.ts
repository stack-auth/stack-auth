/**
 * Minimal web-vitals collection (TTFB / FCP / LCP / CLS / INP) built directly on
 * PerformanceObserver — intentionally NOT the `web-vitals` npm package, both to
 * avoid a dependency and because we only need a snapshot-able accumulator: the
 * values are absorbed into the initial `$page-view` span's data (via setData)
 * rather than reported as standalone metric events.
 *
 * Scope: vitals describe the INITIAL page load, so the EventTracker attaches a
 * collector only to the tab's first `$page-view` span and freezes the values
 * when that span ends (first SPA navigation or pagehide). Metrics that would
 * keep accumulating afterwards (CLS, INP) thus measure "the initial page until
 * the first navigation" — the closest honest per-page attribution without
 * browser soft-navigation support.
 */

export type WebVitalsSnapshot = {
  /** Time to first byte of the navigation response, ms. */
  ttfb_ms?: number,
  /** First contentful paint, ms. */
  fcp_ms?: number,
  /** Largest contentful paint (latest candidate), ms. */
  lcp_ms?: number,
  /** Cumulative layout shift, session-window maximum per the CLS definition. */
  cls?: number,
  /** Interaction to next paint, estimated like the web-vitals library (p98-ish). */
  inp_ms?: number,
};

export type WebVitalsCollector = {
  snapshot: () => WebVitalsSnapshot,
  /** Stops all observers; snapshot() keeps returning the frozen values. */
  disconnect: () => void,
};

// INP ignores interactions faster than this (matches the web-vitals library's
// default durationThreshold); reporting every sub-threshold interaction would
// flood the entry buffer without changing the high-percentile estimate.
const INP_DURATION_THRESHOLD_MS = 40;
// The INP estimate keeps only the N longest interactions (see the web-vitals
// library): the reported value is the min(floor(count/50), N-1)-th longest, so
// anything beyond the top 10 can never be selected for realistic counts.
const INP_LONGEST_KEPT = 10;
type LongestInteraction = { id: number, durationMs: number };

function supportsEntryType(type: string): boolean {
  const supported: unknown = (PerformanceObserver as unknown as { supportedEntryTypes?: unknown }).supportedEntryTypes;
  return Array.isArray(supported) && supported.includes(type);
}

/**
 * Starts collecting; returns null where PerformanceObserver is unavailable
 * (SSR, ancient browsers, some webviews). `onUpdate` fires whenever any metric
 * changes — the caller decides how to persist (updates within one flush window
 * coalesce into a single wire row, so no extra throttling is needed here).
 */
export function startWebVitalsCollector(onUpdate: () => void): WebVitalsCollector | null {
  if (typeof PerformanceObserver !== "function" || typeof performance === "undefined") return null;

  const state: WebVitalsSnapshot = {};
  const observers: PerformanceObserver[] = [];

  // CLS session windows: shifts (without recent input) accumulate into a window
  // while gaps stay under 1s and the window under 5s; CLS is the max window.
  let clsSessionValue = 0;
  let clsSessionFirstTs = 0;
  let clsSessionLastTs = 0;

  // INP bookkeeping (mirrors the web-vitals library): the longest interactions
  // by id. The native distinct-interaction count is used to pick the percentile
  // index when available; without it, the duration-threshold observer is not a
  // complete denominator, so the honest fallback is the longest interaction.
  const longestInteractions: LongestInteraction[] = [];
  const longestById = new Map<number, LongestInteraction>();

  const recordInteraction = (entry: PerformanceEntry): boolean => {
    if (!("interactionId" in entry) || typeof entry.interactionId !== "number" || entry.interactionId === 0) return false;
    if (typeof entry.duration !== "number") return false;

    const existing = longestById.get(entry.interactionId);
    if (existing) {
      existing.durationMs = Math.max(existing.durationMs, entry.duration);
    } else {
      longestInteractions.push({ id: entry.interactionId, durationMs: entry.duration });
      longestById.set(entry.interactionId, longestInteractions[longestInteractions.length - 1]);
    }
    longestInteractions.sort((a, b) => b.durationMs - a.durationMs);
    while (longestInteractions.length > INP_LONGEST_KEPT) {
      const dropped = longestInteractions.pop();
      if (dropped !== undefined) longestById.delete(dropped.id);
    }

    const nativeInteractionCount: unknown = Reflect.get(performance, "interactionCount");
    const index = typeof nativeInteractionCount === "number"
      ? Math.min(Math.floor(nativeInteractionCount / 50), longestInteractions.length - 1)
      : 0;
    const inp = Math.round(longestInteractions[index].durationMs);
    if (inp === state.inp_ms) return false;
    state.inp_ms = inp;
    return true;
  };

  const tryObserve = (type: string, callback: (entries: PerformanceEntry[]) => void, extraOptions?: Record<string, unknown>) => {
    if (!supportsEntryType(type)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        callback(list.getEntries());
      });
      observer.observe({ type, buffered: true, ...extraOptions } as PerformanceObserverInit);
      observers.push(observer);
    } catch {
      // A browser advertising the type but rejecting the observe options just
      // means this one metric is missing from the snapshot.
    }
  };

  tryObserve("navigation", (entries) => {
    for (const entry of entries) {
      if ("responseStart" in entry && typeof entry.responseStart === "number" && entry.responseStart > 0) {
        state.ttfb_ms = Math.round(entry.responseStart);
        onUpdate();
      }
    }
  });

  tryObserve("paint", (entries) => {
    for (const entry of entries) {
      if (entry.name === "first-contentful-paint") {
        state.fcp_ms = Math.round(entry.startTime);
        onUpdate();
      }
    }
  });

  tryObserve("largest-contentful-paint", (entries) => {
    if (entries.length === 0) return;
    state.lcp_ms = Math.round(entries[entries.length - 1].startTime);
    onUpdate();
  });

  tryObserve("layout-shift", (entries) => {
    let changed = false;
    for (const entry of entries) {
      if (!("value" in entry) || typeof entry.value !== "number") continue;
      if ("hadRecentInput" in entry && entry.hadRecentInput === true) continue;
      const ts = entry.startTime;
      if (clsSessionValue > 0 && ts - clsSessionLastTs < 1000 && ts - clsSessionFirstTs < 5000) {
        clsSessionValue += entry.value;
      } else {
        clsSessionValue = entry.value;
        clsSessionFirstTs = ts;
      }
      clsSessionLastTs = ts;
      if (clsSessionValue > (state.cls ?? 0)) {
        // 4 decimals: CLS is a small unitless score; more precision is noise.
        state.cls = Math.round(clsSessionValue * 10_000) / 10_000;
        changed = true;
      }
    }
    if (changed) onUpdate();
  });

  tryObserve("event", (entries) => {
    let changed = false;
    for (const entry of entries) {
      if (recordInteraction(entry)) changed = true;
    }
    if (changed) onUpdate();
  }, { durationThreshold: INP_DURATION_THRESHOLD_MS });

  // `event` intentionally filters durations below 40ms. `first-input` supplies
  // the valid fast single-interaction case and dedupes by interactionId when
  // the same first interaction also appears in the event stream.
  tryObserve("first-input", (entries) => {
    let changed = false;
    for (const entry of entries) {
      if (recordInteraction(entry)) changed = true;
    }
    if (changed) onUpdate();
  });

  return {
    snapshot: () => ({ ...state }),
    disconnect: () => {
      for (const observer of observers) {
        try {
          observer.disconnect();
        } catch {
          // Disconnect after teardown races are harmless.
        }
      }
      observers.length = 0;
    },
  };
}
