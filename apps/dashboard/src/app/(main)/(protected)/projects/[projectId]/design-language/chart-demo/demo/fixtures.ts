import {
  ANALYTICS_CHART_DEFAULT_LAYERS,
  DEFAULT_FORMAT_KIND,
  pointValue,
  type AnalyticsChartLayer,
  type AnalyticsChartSeries,
  type AnalyticsChartState,
  type Annotation,
  type Point,
} from "@stackframe/dashboard-ui-components";

const DAY_COUNT = 30;

export const SERIES: Point[] = Array.from({ length: DAY_COUNT }, (_, i) => {
  const base = 420;
  const trend = i * 14;
  const wave = Math.sin(i * 0.48) * 78 + Math.cos(i * 0.21) * 34;
  const prev = base + (i * 9) + Math.sin(i * 0.52 + 1.4) * 62;
  return {
    ts: Date.UTC(2026, 2, 7 + i),
    values: {
      signups: Math.max(0, Math.round(base + trend + wave)),
      previous: Math.max(0, Math.round(prev)),
    },
  };
});

export const DEMO_BREAKDOWN_SERIES: AnalyticsChartSeries[] = [
  { key: "us", label: "United States" },
  { key: "eu", label: "European Union" },
  { key: "asia", label: "Asia-Pacific" },
  { key: "latam", label: "Latin America" },
  { key: "other", label: "Other" },
];

const DEMO_BREAKDOWN_RATIOS = [0.32, 0.26, 0.20, 0.13, 0.09];

export function allocateByWeight(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sumW);
  const floors = raw.map((r) => Math.floor(r));
  const base = floors.reduce((a, b) => a + b, 0);
  const remainder = total - base;
  const order = raw
    .map((r, idx) => ({ idx, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let i = 0; i < remainder; i++) {
    result[order[i % order.length]!.idx]!++;
  }
  return result;
}

export const DEMO_BREAKDOWN: number[][] = SERIES.map((p, i) => {
  const weights = DEMO_BREAKDOWN_RATIOS.map((r, k) => {
    const wave = Math.sin((i + k * 3) * 0.32) * 0.06;
    return Math.max(0.01, r + wave);
  });
  return allocateByWeight(pointValue(p, "signups"), weights);
});

export const DEMO_BREAKDOWN_PREV: number[][] = SERIES.map((p, i) => {
  const weights = DEMO_BREAKDOWN_RATIOS.map((r, k) => {
    const wave = Math.sin((i + k * 3) * 0.32 + 1.7) * 0.05;
    return Math.max(0.01, r + wave);
  });
  return allocateByWeight(pointValue(p, "previous"), weights);
});

export const ANNOTATIONS: Annotation[] = [
  { index: 8, label: "v4.2", description: "Release v4.2 — new SSO provider" },
  { index: 17, label: "Fix", description: "Hotfix deployed — rate-limit regression" },
  { index: 24, label: "Exp", description: "A/B test launched — signup copy" },
];

function wireDemoLayer(layer: AnalyticsChartLayer): AnalyticsChartLayer {
  if (layer.kind === "primary") {
    return {
      ...layer,
      id: "signups",
      label: "Sign-ups",
      segments: DEMO_BREAKDOWN,
      segmentSeries: DEMO_BREAKDOWN_SERIES,
      inProgressFromIndex: DAY_COUNT - 1,
    };
  }
  if (layer.kind === "compare") {
    return {
      ...layer,
      id: "previous",
      segments: DEMO_BREAKDOWN_PREV,
      segmentSeries: DEMO_BREAKDOWN_SERIES,
      inProgressFromIndex: null,
    };
  }
  return layer;
}

export const DEMO_DEFAULT_STATE: AnalyticsChartState = {
  view: "timeseries",
  layers: ANALYTICS_CHART_DEFAULT_LAYERS.map(wireDemoLayer),
  xFormatKind: DEFAULT_FORMAT_KIND.datetime,
  yFormatKind: DEFAULT_FORMAT_KIND.short,
  showGrid: true,
  showXAxis: true,
  showYAxis: true,
  zoomRange: null,
  pinnedIndex: null,
};

export type TableRow = {
  key: string,
  label: string,
  light: string,
  dark: string,
  current: number,
  previous: number,
  trend: number[],
};

export const TABLE_ROWS: TableRow[] = [
  { key: "gh", label: "google.com", light: "#2563eb", dark: "#60a5fa", current: 14_820, previous: 12_310, trend: [8, 10, 12, 14, 13, 15, 18, 21, 23, 27, 30, 34] },
  { key: "tw", label: "twitter.com", light: "#059669", dark: "#34d399", current: 7_430, previous: 9_120, trend: [28, 26, 24, 23, 20, 18, 17, 15, 14, 13, 12, 11] },
  { key: "prod", label: "producthunt.com", light: "#d97706", dark: "#fbbf24", current: 5_290, previous: 2_480, trend: [3, 4, 5, 8, 11, 14, 17, 19, 22, 26, 30, 32] },
  { key: "hn", label: "news.ycombinator.com", light: "#7c3aed", dark: "#a78bfa", current: 4_120, previous: 3_980, trend: [12, 13, 14, 14, 13, 15, 14, 13, 14, 15, 14, 14] },
  { key: "direct", label: "(direct)", light: "#94a3b8", dark: "#64748b", current: 3_610, previous: 3_420, trend: [20, 21, 21, 22, 22, 23, 22, 23, 23, 24, 24, 24] },
];
