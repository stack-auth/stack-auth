import type { Attributes, Gauge, Meter } from "@opentelemetry/api";

/**
 * Minimal web-vitals collection (TTFB / FCP / LCP / CLS / INP / FPS) built directly on
 * PerformanceObserver — intentionally NOT the `web-vitals` npm package, both to
 * avoid a dependency and because we need a snapshot-able accumulator. The
 * caller stores the snapshot on the current `$page-view` span and records the
 * same observation through the native OTel Metrics path.
 *
 * Scope: the EventTracker attaches one collector per `$page-view` span and
 * freezes its values when that span ends (SPA navigation or pagehide).
 *
 * - `initial` mode covers the tab's hard load: all five load metrics plus FPS.
 * - `soft-nav` mode covers a SPA navigation: CLS, INP, and FPS, windowed to
 *   entries after the navigation started. TTFB/FCP/LCP describe the HARD load
 *   and reporting them per soft-nav would be a lie, so those observers are not
 *   installed at all. The snapshot carries `soft_nav: 1` so dashboard
 *   percentiles never mix LCP-less soft-nav rows into load metrics.
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
  /** Approximate visible animation frame rate, sampled in one-second windows. */
  fps?: number,
  /** Present (1) when the collector ran in soft-nav mode — CLS/INP/FPS describe
   * the SPA navigation window and the hard-load metrics are intentionally absent. */
  soft_nav?: 1,
};

export type WebVitalsCollectorOptions =
  | { mode: "initial" }
  /** `navStartTime` is the navigation's `performance.now()` timestamp — the
   * same clock PerformanceEntry.startTime uses — so buffered pre-navigation
   * entries can be excluded exactly. */
  | { mode: "soft-nav", navStartTime: number };

export type WebVitalsCollector = {
  snapshot: () => WebVitalsSnapshot,
  /** Stops all observers; snapshot() keeps returning the frozen values. */
  disconnect: () => void,
};

type WebVitalsMetricKey = "ttfb_ms" | "fcp_ms" | "lcp_ms" | "cls" | "inp_ms" | "fps";
type WebVitalsGauge = Pick<Gauge, "record">;
type WebVitalsMeter = Pick<Meter, "createGauge">;

const WEB_VITAL_METRICS: readonly {
  key: WebVitalsMetricKey,
  name: string,
  description: string,
  unit: string,
}[] = [
  {
    key: "lcp_ms",
    name: "hexclave.web.vitals.lcp",
    description: "Largest Contentful Paint observed in a browser page view",
    unit: "ms",
  },
  {
    key: "fcp_ms",
    name: "hexclave.web.vitals.fcp",
    description: "First Contentful Paint observed in a browser page view",
    unit: "ms",
  },
  {
    key: "cls",
    name: "hexclave.web.vitals.cls",
    description: "Cumulative Layout Shift observed in a browser page view",
    unit: "1",
  },
  {
    key: "inp_ms",
    name: "hexclave.web.vitals.inp",
    description: "Interaction to Next Paint observed in a browser page view",
    unit: "ms",
  },
  {
    key: "ttfb_ms",
    name: "hexclave.web.vitals.ttfb",
    description: "Time to First Byte observed in a browser page view",
    unit: "ms",
  },
  {
    key: "fps",
    name: "hexclave.web.vitals.fps",
    description: "Animation frame rate observed while a browser page view was visible",
    unit: "frame/s",
  },
];

/**
 * Web Vitals are page-view samples, so gauges preserve each observation as a
 * native Metrics point without pretending that the browser collector is a
 * request-duration histogram. The low-cardinality navigation attribute keeps
 * hard loads and SPA navigation samples distinguishable for future queries.
 */
export class OtlpWebVitalsMetricRecorder {
  private readonly _gauges: Map<WebVitalsMetricKey, WebVitalsGauge>;

  constructor(meter: WebVitalsMeter) {
    const gauges = new Map<WebVitalsMetricKey, WebVitalsGauge>();
    for (const metric of WEB_VITAL_METRICS) {
      gauges.set(metric.key, meter.createGauge(metric.name, {
        description: metric.description,
        unit: metric.unit,
      }));
    }
    this._gauges = gauges;
  }

  record(snapshot: WebVitalsSnapshot): void {
    const attributes: Attributes = {
      "hexclave.web.vitals.navigation": snapshot.soft_nav === 1 ? "soft" : "initial",
    };
    for (const metric of WEB_VITAL_METRICS) {
      const value = snapshot[metric.key];
      if (value === undefined || !Number.isFinite(value)) continue;
      this._gauges.get(metric.key)?.record(value, attributes);
    }
  }
}

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

function nativeInteractionCount(): number | null {
  const value: unknown = Reflect.get(performance, "interactionCount");
  return typeof value === "number" ? value : null;
}

/**
 * Starts collecting; returns null where PerformanceObserver is unavailable
 * (SSR, ancient browsers, some webviews). `onUpdate` fires whenever any metric
 * changes — the caller decides how to persist the snapshot to spans and
 * Metrics (updates within one flush window coalesce into a single wire row, so
 * no extra throttling is needed here).
 */
export function startWebVitalsCollector(onUpdate: (snapshot: WebVitalsSnapshot) => void, options: WebVitalsCollectorOptions = { mode: "initial" }): WebVitalsCollector | null {
  if (typeof PerformanceObserver !== "function" || typeof performance === "undefined") return null;

  const softNav = options.mode === "soft-nav";
  // Entries strictly before the navigation belong to the PREVIOUS page-view's
  // collector; observers use buffered:true, so this cutoff is what scopes a
  // soft-nav collector to its own navigation window.
  const entryCutoffTime = softNav ? options.navStartTime : 0;
  // `performance.interactionCount` is monotonic-global for the tab, so the
  // INP percentile index for a soft-nav window must use the count of
  // interactions WITHIN the window: snapshot a baseline at nav start.
  const interactionCountBase = softNav ? nativeInteractionCount() ?? 0 : 0;

  const state: WebVitalsSnapshot = softNav ? { soft_nav: 1 } : {};
  const observers: PerformanceObserver[] = [];
  const notify = () => onUpdate({ ...state });

  // FPS is a product-facing smoothness signal rather than a Core Web Vital.
  // Sampling one-second rAF windows keeps the collector bounded and avoids
  // exporting one metric point per animation frame.
  let fpsFrameHandle: number | null = null;
  let fpsWindowStart: number | null = null;
  let fpsFrameCount = 0;
  const sampleFrame = (timestamp: number) => {
    fpsWindowStart ??= timestamp;
    fpsFrameCount += 1;
    const elapsed = timestamp - fpsWindowStart;
    if (elapsed >= 1000) {
      state.fps = Math.round((fpsFrameCount * 1000 / elapsed) * 10) / 10;
      fpsWindowStart = timestamp;
      fpsFrameCount = 0;
      notify();
    }
    fpsFrameHandle = requestAnimationFrame(sampleFrame);
  };
  if (typeof requestAnimationFrame === "function") {
    fpsFrameHandle = requestAnimationFrame(sampleFrame);
  }

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
    if (entry.startTime < entryCutoffTime) return false;
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

    const currentCount = nativeInteractionCount();
    const index = currentCount !== null
      ? Math.min(Math.floor(Math.max(currentCount - interactionCountBase, 0) / 50), longestInteractions.length - 1)
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

  // The three load metrics describe the hard load only — not installed at all
  // in soft-nav mode (see the module comment).
  if (!softNav) {
    tryObserve("navigation", (entries) => {
      for (const entry of entries) {
        if ("responseStart" in entry && typeof entry.responseStart === "number" && entry.responseStart > 0) {
          state.ttfb_ms = Math.round(entry.responseStart);
          notify();
        }
      }
    });

    tryObserve("paint", (entries) => {
      for (const entry of entries) {
        if (entry.name === "first-contentful-paint") {
          state.fcp_ms = Math.round(entry.startTime);
          notify();
        }
      }
    });

    tryObserve("largest-contentful-paint", (entries) => {
      if (entries.length === 0) return;
      state.lcp_ms = Math.round(entries[entries.length - 1].startTime);
      notify();
    });
  }

  tryObserve("layout-shift", (entries) => {
    let changed = false;
    for (const entry of entries) {
      if (entry.startTime < entryCutoffTime) continue;
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
    if (changed) notify();
  });

  tryObserve("event", (entries) => {
    let changed = false;
    for (const entry of entries) {
      if (recordInteraction(entry)) changed = true;
    }
    if (changed) notify();
  }, { durationThreshold: INP_DURATION_THRESHOLD_MS });

  // `event` intentionally filters durations below 40ms. `first-input` supplies
  // the valid fast single-interaction case and dedupes by interactionId when
  // the same first interaction also appears in the event stream.
  tryObserve("first-input", (entries) => {
    let changed = false;
    for (const entry of entries) {
      if (recordInteraction(entry)) changed = true;
    }
    if (changed) notify();
  });

  return {
    snapshot: () => ({ ...state }),
    disconnect: () => {
      if (fpsFrameHandle !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(fpsFrameHandle);
        fpsFrameHandle = null;
      }
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
