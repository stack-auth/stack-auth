"use client";

import { cn } from "@stackframe/stack-ui";
import { DesignButton } from "../button";
import {
  type DesignChartConfig,
  DesignChartContainer,
} from "../chart-container";
import {
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  FlagIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnalyticsChartPie } from "./analytics-chart-pie";
import {
  DefaultAnalyticsChartTooltip,
  type AnalyticsChartTooltipContext,
  type AnalyticsChartTooltipLayerView,
  type AnalyticsChartTooltipSegmentRow,
} from "./default-analytics-chart-tooltip";
import { formatDelta, formatValue } from "./format";
import {
  buildRampColors,
  resolveAnalyticsChartPalette,
} from "./palette";
import { renderDataSeries } from "./render-data-series";
import {
  computeLocalInProgressIdx,
  EMPTY_MATRIX,
  EMPTY_SERIES,
  findAnnotationsLayer,
  findCompareLayer,
  findPrimaryLayer,
  isAnalyticsChartDataLayer,
  isTimeseriesState,
  resolveDataLayerStyle,
  STROKE_DASHARRAY,
  type ResolvedDataLayerStyle,
} from "./state";
import { resolveAnalyticsChartStrings } from "./strings";
import type {
  AnalyticsChartDelta,
  AnalyticsChartPalette,
  AnalyticsChartPieProps,
  AnalyticsChartSeries,
  AnalyticsChartState,
  AnalyticsChartTimeseriesState,
  Annotation,
  FormatKind,
  Point,
} from "./types";
import { cssIdent, pointValue } from "./types";
import type { AnalyticsChartStrings } from "./strings";

/** Mirrors Recharts' internal `Margin` shape (not exported from their typings). */
export type Margin = {
  top?: number,
  right?: number,
  bottom?: number,
  left?: number,
};

/**
 * Props for {@link AnalyticsChart}.
 *
 * ## HOW TO REFERENCE THIS COMPONENT
 *
 * **In the custom dashboard sandbox** (AI-generated dashboard code): every
 * export lives on the global `DashboardUI` object. Use
 * `DashboardUI.AnalyticsChart`, `DashboardUI.ANALYTICS_CHART_DEFAULT_STATE`,
 * `DashboardUI.pointValue`, etc. **Never** use bare identifiers like
 * `<AnalyticsChart />` inside the sandbox — there is no module system and
 * nothing is destructured into scope. Types (`AnalyticsChartState`,
 * `Point`, …) don't exist at runtime anyway, so just drop the type
 * annotations in sandbox code.
 *
 * **In a regular TypeScript app** (anywhere importing `@stackframe/dashboard-ui-components`
 * directly): `import { AnalyticsChart, ANALYTICS_CHART_DEFAULT_STATE } from
 * "@stackframe/dashboard-ui-components"` and use the bare name. Drop the
 * `DashboardUI.` prefix from the examples below when doing so.
 *
 * ## Data shape in 30 seconds
 *
 * - `data` is `Point[]`. Each `Point` is `{ ts: number, values: Record<string, number> }`.
 *   `ts` is a Unix millisecond timestamp; `values` is keyed by **layer id**.
 * - `state` is fully controlled. Start from
 *   `DashboardUI.ANALYTICS_CHART_DEFAULT_STATE` (which ships with a
 *   `"primary"` + `"compare"` + `"annotations"` layer set) and override
 *   what you need. Do **not** hand-build the layer array from scratch.
 * - For a breakdown (e.g. signups by region), add `segments` (a `number[][]`
 *   with one row per `data` point) and `segmentSeries` (the category labels)
 *   to the primary layer. Rows of `segments` should sum to the point's layer
 *   value. Same for the compare layer if you want a compared breakdown.
 *
 * ## **SCALE YOUR DATA BEFORE PUTTING IT ON A POINT** (critical)
 *
 * The chart renders every visible layer on a **single shared y-axis**. If
 * two layers are on different orders of magnitude (e.g. revenue in cents
 * `1_200_000` and sign-ups `450`), the smaller series collapses to a flat
 * line at the bottom and the chart looks broken. You **must** normalize
 * both metrics into the same range before building `data`. Rules of thumb:
 *
 * - **Cents → dollars / units**: divide money amounts by 100 (or 1000 for
 *   large currencies). Use a `valueFormatter` to render the original unit
 *   in tooltips so the UX still reads as "$12,543".
 * - **Counts vs rates**: if one layer is a count (e.g. requests) and the
 *   other is a ratio (e.g. error rate 0.02), multiply the ratio by the
 *   count's scale (or by `max(counts)`) so both sit in the same band.
 * - **Very different counts** (e.g. page views `120_000` vs sign-ups `430`):
 *   either divide the large metric (`views / 100`) or promote the small
 *   one to a rate (`signups / views * 1000`). Note the transformation in
 *   the layer `label` ("Sign-ups per 1k views") so it's honest.
 * - **Pick the target range from the layer with the most natural scale**
 *   — usually the metric the user actually cares about — and normalize
 *   everything else into it. Don't normalize by fighting Recharts with
 *   `yDomain` hacks; do it in the data.
 *
 * If the two metrics truly can't share an axis (e.g. latency ms vs error
 * count), render them as **two separate `AnalyticsChart` instances** stacked
 * in the layout instead of jamming them into one chart.
 *
 * ## Example 1 — simplest possible: one area layer, no compare
 *
 * ```jsx
 * // Sandbox dashboard code — everything prefixed with DashboardUI.*
 * function Dashboard() {
 *   const data = [
 *     { ts: Date.UTC(2026, 2, 1), values: { primary: 420 } },
 *     { ts: Date.UTC(2026, 2, 2), values: { primary: 512 } },
 *     { ts: Date.UTC(2026, 2, 3), values: { primary: 604 } },
 *     // ...one row per time bucket
 *   ];
 *
 *   // Start from defaults, hide the compare layer so it's a single series.
 *   const [state, setState] = React.useState({
 *     ...DashboardUI.ANALYTICS_CHART_DEFAULT_STATE,
 *     layers: DashboardUI.ANALYTICS_CHART_DEFAULT_STATE.layers.map((l) =>
 *       l.kind === "compare" ? { ...l, visible: false } : l,
 *     ),
 *   });
 *
 *   return (
 *     <DashboardUI.DesignChartCard title="Sign-ups" description="Last 30 days">
 *       <DashboardUI.AnalyticsChart
 *         data={data}
 *         state={state}
 *         onChange={setState}
 *       />
 *     </DashboardUI.DesignChartCard>
 *   );
 * }
 * ```
 *
 * ## Example 2 — current vs previous period (compare)
 *
 * Each point carries both layer values under their layer ids. The default
 * state's `"primary"` and `"compare"` layers are already visible, so no
 * state customization is needed.
 *
 * ```jsx
 * function Dashboard() {
 *   const data = rows.map((r) => ({
 *     ts: r.bucketTs,
 *     values: {
 *       primary: r.signupsThisPeriod,   // keyed by layer id "primary"
 *       compare: r.signupsLastPeriod,   // keyed by layer id "compare"
 *     },
 *   }));
 *
 *   const [state, setState] = React.useState(
 *     DashboardUI.ANALYTICS_CHART_DEFAULT_STATE,
 *   );
 *
 *   return (
 *     <DashboardUI.AnalyticsChart
 *       data={data}
 *       state={state}
 *       onChange={setState}
 *     />
 *   );
 * }
 * ```
 *
 * ## Example 3 — stacked bar with region breakdown (segmented)
 *
 * ```jsx
 * function Dashboard() {
 *   const regions = [
 *     { key: "us", label: "United States" },
 *     { key: "eu", label: "European Union" },
 *     { key: "asia", label: "Asia-Pacific" },
 *   ];
 *
 *   // Row index matches `data` index; column index matches `regions`.
 *   // Each row MUST sum to data[i].values.primary.
 *   const segments = [
 *     [210, 140,  70],  // day 0 → total 420
 *     [250, 170,  92],  // day 1 → total 512
 *     [300, 200, 104],  // day 2 → total 604
 *   ];
 *
 *   const data = [
 *     { ts: Date.UTC(2026, 2, 1), values: { primary: 420 } },
 *     { ts: Date.UTC(2026, 2, 2), values: { primary: 512 } },
 *     { ts: Date.UTC(2026, 2, 3), values: { primary: 604 } },
 *   ];
 *
 *   const [state, setState] = React.useState({
 *     ...DashboardUI.ANALYTICS_CHART_DEFAULT_STATE,
 *     layers: DashboardUI.ANALYTICS_CHART_DEFAULT_STATE.layers.map((l) => {
 *       if (l.kind === "primary") {
 *         return {
 *           ...l,
 *           type: "bar",        // switch from area → stacked bars
 *           segmented: true,
 *           segments,
 *           segmentSeries: regions,
 *         };
 *       }
 *       if (l.kind === "compare") {
 *         return { ...l, visible: false };
 *       }
 *       return l;
 *     }),
 *   });
 *
 *   return (
 *     <DashboardUI.AnalyticsChart
 *       data={data}
 *       state={state}
 *       onChange={setState}
 *     />
 *   );
 * }
 * ```
 *
 * ## Example 4 — mixing display types (e.g. revenue bars + signups area)
 *
 * Use two layers. The "primary" layer holds one metric; reuse the "compare"
 * layer slot for the second metric by overriding its `id`, `label`, and
 * `type`. Then key both values in each `Point`.
 *
 * **IMPORTANT**: the two metrics share a single y-axis, so scale them into
 * the same range before putting them on the point. A common trick is to
 * pass a `valueFormatter` that reports each layer's number with its own
 * unit so tooltips still read correctly.
 *
 * ```jsx
 * function Dashboard() {
 *   // Sign-ups are already in range; revenue cents would dwarf them, so
 *   // we normalize revenue (cents → dollars) onto the same scale.
 *   const data = rows.map((r) => ({
 *     ts: r.bucketTs,
 *     values: {
 *       revenue: r.revenueCents / 100,
 *       signups: r.signups,
 *     },
 *   }));
 *
 *   const [state, setState] = React.useState({
 *     ...DashboardUI.ANALYTICS_CHART_DEFAULT_STATE,
 *     layers: DashboardUI.ANALYTICS_CHART_DEFAULT_STATE.layers.map((l) => {
 *       if (l.kind === "primary") {
 *         return { ...l, id: "revenue", label: "Revenue", type: "bar" };
 *       }
 *       if (l.kind === "compare") {
 *         return {
 *           ...l,
 *           id: "signups",
 *           label: "Sign-ups",
 *           type: "area",
 *           visible: true,
 *         };
 *       }
 *       return l;
 *     }),
 *   });
 *
 *   // Per-layer formatter: `kind` lets you branch per-axis vs per-layer
 *   // using the layer id passed in via the tooltip context. For most
 *   // cases formatting by raw value is enough.
 *   const valueFormatter = (value, kind) => {
 *     if (kind.type === "currency") return `$${value.toFixed(0)}`;
 *     return value.toLocaleString();
 *   };
 *
 *   return (
 *     <DashboardUI.AnalyticsChart
 *       data={data}
 *       state={state}
 *       onChange={setState}
 *       valueFormatter={valueFormatter}
 *     />
 *   );
 * }
 * ```
 *
 * ## Example 5 — segmented sign-ups stacked with a revenue line (mix + segment)
 *
 * Combines Example 3 and Example 4: primary layer is revenue as a line
 * (un-segmented), compare layer is sign-ups as a stacked bar (segmented
 * by region). Remember: row sums of the compare segments must equal
 * `point.values.signups`, and both metrics share one y-axis.
 *
 * ```jsx
 * function Dashboard() {
 *   const regions = [
 *     { key: "us", label: "United States" },
 *     { key: "eu", label: "European Union" },
 *     { key: "asia", label: "Asia-Pacific" },
 *   ];
 *
 *   // Normalize revenue to the same order of magnitude as sign-ups.
 *   const data = rows.map((r) => ({
 *     ts: r.bucketTs,
 *     values: {
 *       revenue: r.revenueCents / 100,
 *       signups: r.signupsTotal,
 *     },
 *   }));
 *
 *   // Row index matches `data` index. Each row sums to signupsTotal.
 *   const signupSegments = rows.map((r) => [
 *     r.signupsUs,
 *     r.signupsEu,
 *     r.signupsAsia,
 *   ]);
 *
 *   const [state, setState] = React.useState({
 *     ...DashboardUI.ANALYTICS_CHART_DEFAULT_STATE,
 *     layers: DashboardUI.ANALYTICS_CHART_DEFAULT_STATE.layers.map((l) => {
 *       if (l.kind === "primary") {
 *         return { ...l, id: "revenue", label: "Revenue", type: "line" };
 *       }
 *       if (l.kind === "compare") {
 *         return {
 *           ...l,
 *           id: "signups",
 *           label: "Sign-ups",
 *           type: "bar",
 *           visible: true,
 *           segmented: true,
 *           segments: signupSegments,
 *           segmentSeries: regions,
 *         };
 *       }
 *       return l;
 *     }),
 *   });
 *
 *   return (
 *     <DashboardUI.AnalyticsChart
 *       data={data}
 *       state={state}
 *       onChange={setState}
 *     />
 *   );
 * }
 * ```
 */
export type AnalyticsChartProps = {
  /** Time-series points — each point carries `values` keyed by layer id.
   * See {@link AnalyticsChartProps} for full data-shape examples. */
  data: Point[],
  /** Annotations. Fully prop-driven; the consumer owns the array. */
  annotations?: Annotation[],
  /** Fully-controlled state + dispatch. The chart reads every config and
   * persistent-interaction slice from `state` and mutates it through
   * `onChange`. Ephemeral interaction state (hover, brush, pin, draft) is
   * managed internally and surfaces only through the state callbacks. */
  state: AnalyticsChartState,
  onChange: React.Dispatch<React.SetStateAction<AnalyticsChartState>>,
  /** Fired when the user submits the in-chart annotation form. The consumer
   * is expected to append to its own annotations array. */
  onAnnotationCreate?: (annotation: Annotation) => void,
  /** Override any user-visible copy. Shallow-merges over the defaults. */
  strings?: Partial<AnalyticsChartStrings>,
  /** Override segment color ramps. Each ramp is either procedural
   * (hue + sat + lightness range) or explicit (concrete color lists). */
  palette?: Partial<AnalyticsChartPalette>,
  /** Render slot for the tooltip body. Receives a prepared context with
   * the active point, primary/compare layer views, pre-bound formatters,
   * and resolved strings. Defaults to `DefaultAnalyticsChartTooltip`. */
  renderTooltip?: (ctx: AnalyticsChartTooltipContext) => ReactNode,
  /** Recharts plot margins. Also drives overlay positioning math so the
   * crosshair, tooltip anchor, brush popup, and flag markers line up with
   * the actual plot area. Defaults to `{ top: 16, right: 24, bottom: 8, left: 12 }`. */
  plotMargin?: Margin,
  /** Y-axis reserved width in pixels. Defaults to 48. */
  yAxisWidth?: number,
  /** Fractional headroom added to the y-axis top. Defaults to 0.1. */
  yDomainPadding?: number,
  /** Grouped pie configuration. Each field has a sensible default. */
  pie?: AnalyticsChartPieProps,
  /** Custom number formatter. Receives the raw value and the kind to format
   * with — the same function is invoked for both x-axis and y-axis values. */
  valueFormatter?: (value: number, kind: FormatKind) => string,
};

type RechartsMouseState = {
  activeTooltipIndex?: number,
  isTooltipActive?: boolean,
};

const FALLBACK_PRIMARY_STYLE: ResolvedDataLayerStyle = {
  color: "#2563eb",
  type: "area",
  strokeStyle: "solid",
  fillOpacity: 0,
};
const FALLBACK_COMPARE_STYLE: ResolvedDataLayerStyle = {
  color: "#f59e0b",
  type: "line",
  strokeStyle: "dashed",
  fillOpacity: 0,
};
const FALLBACK_ANNOTATION_COLOR = "#f59e0b";

function buildTooltipLayerView(args: {
  show: boolean,
  layer: { id: string, label: string } | undefined,
  color: string,
  segmented: boolean,
  segmentSeries: readonly AnalyticsChartSeries[],
  segmentRows: readonly (readonly number[])[],
  segmentTotals: readonly number[],
  segmentColorsLight: readonly string[],
  segmentColorsDark: readonly string[],
  activeIndex: number,
  activePoint: Point,
  fallbackLabel?: string,
}): AnalyticsChartTooltipLayerView | null {
  const {
    show,
    layer,
    color,
    segmented,
    segmentSeries,
    segmentRows,
    segmentTotals,
    segmentColorsLight,
    segmentColorsDark,
    activeIndex,
    activePoint,
    fallbackLabel,
  } = args;
  if (!show || !layer) return null;
  const segments: AnalyticsChartTooltipSegmentRow[] = segmented
    ? segmentSeries.map((s, sIdx) => ({
      key: s.key,
      label: s.label,
      value: segmentRows[activeIndex]?.[sIdx] ?? 0,
      color: segmentColorsLight[sIdx],
      colorDark: segmentColorsDark[sIdx],
    }))
    : [];
  return {
    id: layer.id,
    label: layer.label || fallbackLabel || "",
    color,
    colorDark: color,
    total: segmented
      ? (segmentTotals[activeIndex] ?? 0)
      : pointValue(activePoint, layer.id),
    segmented,
    segments,
  };
}

/**
 * Preferred chart for all time-series: area, line, bar, compare layers,
 * segmented stacks, tooltips, zoom, and annotations. Wrap in
 * `DesignChartCard` for the title/description chrome. Only fall back to
 * raw Recharts for non-time-series visuals (static rankings etc.).
 *
 * ## Data shape
 *
 * `data` is `Point[]`, where `Point = { ts: number, values: Record<string, number> }`.
 * `ts` is a Unix milliseconds timestamp. `values` maps layer id → numeric value
 * at that bucket. Example:
 *
 * ```ts
 * { ts: 1743465600000, values: { primary: 420 } }
 * { ts: 1743465600000, values: { primary: 420, compare: 380 } }  // with compare layer
 * ```
 *
 * ## State is fully controlled — start from ANALYTICS_CHART_DEFAULT_STATE
 *
 * The default state ships with three pre-configured layers: `"primary"`,
 * `"compare"`, and `"annotations"`. ALWAYS spread from
 * `ANALYTICS_CHART_DEFAULT_STATE` and map over `layers` to override. Do NOT
 * hand-build the layer array from scratch — you will miss fields and crash.
 *
 * ```ts
 * // Default state shape (for reference — spread from the constant, don't copy):
 * {
 *   view: "timeseries",
 *   layers: [
 *     { id: "primary", kind: "primary", label: "Current", visible: true, color: "#2563eb",
 *       segmented: false, type: "area", strokeStyle: "solid", fillOpacity: 0.22, inProgressFromIndex: null },
 *     { id: "compare", kind: "compare", label: "Previous period", visible: true, color: "#f59e0b",
 *       segmented: false, type: "line", strokeStyle: "dashed", inProgressFromIndex: null },
 *     { id: "annotations", kind: "annotations", label: "Annotations", visible: true, color: "#f59e0b" },
 *   ],
 *   xFormatKind: { type: "datetime", style: "short" },
 *   yFormatKind: { type: "short" },
 *   showGrid: true, showXAxis: true, showYAxis: true,
 *   zoomRange: null, pinnedIndex: null,
 * }
 * ```
 *
 * ## onChange — CRITICAL, get this right
 *
 * `onChange` fires with an `AnalyticsChartState` object — NOT your custom
 * wrapper. If you store chart data and state together, `onChange` MUST only
 * update the state part. Keep data and state in SEPARATE hooks:
 *
 * ```tsx
 * // WRONG — overwrites your data with a bare state object, crashes on next render:
 * const [combined, setCombined] = React.useState({ data: [], state: ANALYTICS_CHART_DEFAULT_STATE });
 * <AnalyticsChart data={combined.data} state={combined.state} onChange={setCombined} />
 *
 * // RIGHT — two hooks:
 * const [data, setData] = React.useState([]);
 * const [chartState, setChartState] = React.useState({ ...ANALYTICS_CHART_DEFAULT_STATE });
 * <AnalyticsChart data={data} state={chartState} onChange={setChartState} />
 * ```
 *
 * NEVER pass a setter that manages a combined `{ data, state }` object directly to `onChange`.
 *
 * ## Common patterns
 *
 * ### 1. Simplest — one area layer, no compare
 *
 * ```tsx
 * const data = rows.map(r => ({ ts: r.bucketTs, values: { primary: r.count } }));
 * const [state, setState] = React.useState({
 *   ...ANALYTICS_CHART_DEFAULT_STATE,
 *   layers: ANALYTICS_CHART_DEFAULT_STATE.layers.map(l =>
 *     l.kind === "compare" ? { ...l, visible: false } : l
 *   ),
 * });
 * <DesignChartCard title="Signups" description="Last 30 days">
 *   <AnalyticsChart data={data} state={state} onChange={setState} />
 * </DesignChartCard>
 * ```
 *
 * ### 2. Current vs previous period (compare)
 *
 * ```tsx
 * const data = rows.map(r => ({
 *   ts: r.bucketTs,
 *   values: { primary: r.thisPeriod, compare: r.lastPeriod },
 * }));
 * const [state, setState] = React.useState(ANALYTICS_CHART_DEFAULT_STATE);
 * <AnalyticsChart data={data} state={state} onChange={setState} />
 * ```
 *
 * ### 3. Stacked bar with breakdown (segmented)
 *
 * ```tsx
 * const regions = [{ key: "us", label: "US" }, { key: "eu", label: "EU" }];
 * const segments = rows.map(r => [r.signupsUs, r.signupsEu]); // MUST sum to primary value per row
 * const [state, setState] = React.useState({
 *   ...ANALYTICS_CHART_DEFAULT_STATE,
 *   layers: ANALYTICS_CHART_DEFAULT_STATE.layers.map(l => {
 *     if (l.kind === "primary") return { ...l, type: "bar", segmented: true, segments, segmentSeries: regions };
 *     if (l.kind === "compare") return { ...l, visible: false };
 *     return l;
 *   }),
 * });
 * <AnalyticsChart data={data} state={state} onChange={setState} />
 * ```
 *
 * ### 4. Two metrics on one chart (revenue bars + signups area)
 *
 * ```tsx
 * // IMPORTANT: metrics share one y-axis, so normalize into the same range.
 * const data = rows.map(r => ({
 *   ts: r.bucketTs,
 *   values: { revenue: r.revenueCents / 100, signups: r.signups },
 * }));
 * const [state, setState] = React.useState({
 *   ...ANALYTICS_CHART_DEFAULT_STATE,
 *   layers: ANALYTICS_CHART_DEFAULT_STATE.layers.map(l => {
 *     if (l.kind === "primary") return { ...l, id: "revenue", label: "Revenue", type: "bar" };
 *     if (l.kind === "compare") return { ...l, id: "signups", label: "Sign-ups", type: "area", visible: true };
 *     return l;
 *   }),
 * });
 * <AnalyticsChart data={data} state={state} onChange={setState} />
 * ```
 *
 * ### 5. Pie view (distribution / breakdown, non-time-series)
 *
 * Pie needs one data point, `segments` with one row, and `segmentSeries` with labels:
 *
 * ```tsx
 * const categories = [{ key: "verified", label: "Verified" }, { key: "unverified", label: "Unverified" }, { key: "anonymous", label: "Anonymous" }];
 * const total = verified + unverified + anonymous;
 * const data = [{ ts: 0, values: { primary: total } }];
 * const segments = [[verified, unverified, anonymous]]; // one row; values sum to total
 * const [state, setState] = React.useState({
 *   ...ANALYTICS_CHART_DEFAULT_STATE,
 *   view: "pie",
 *   layers: ANALYTICS_CHART_DEFAULT_STATE.layers.map(l => {
 *     if (l.kind === "primary") return { ...l, segmented: true, segments, segmentSeries: categories };
 *     if (l.kind === "compare") return { ...l, visible: false };
 *     return l;
 *   }),
 * });
 * <AnalyticsChart data={data} state={state} onChange={setState} />
 * ```
 *
 * ## Segment data contract (MUST follow when segmented: true)
 *
 * `segments` is a 2D array: `segments[dayIndex][categoryIndex] = number`.
 *
 * - Outer length MUST equal `data.length` (one row per Point).
 * - Inner length MUST equal `segmentSeries.length` (one value per category).
 * - Each row MUST sum to `data[dayIndex].values[layerId]` (the layer's total for that day).
 * - `segmentSeries` defines the category labels, in the SAME order as segment columns.
 *
 * Example: if `segmentSeries = [{ key: "us", label: "US" }, { key: "eu", label: "EU" }]`
 * and `data[0].values.primary = 420`, then `segments[0]` must be `[usValue, euValue]`
 * where `usValue + euValue === 420`. If rows don't sum to the layer total, stacked bars
 * will render incorrectly (gaps or overflow).
 *
 * ## Palette
 *
 * AnalyticsChart auto-generates segment colors (blue shades for primary, amber for
 * compare). You do NOT need to pass a palette prop — it just works. Segment keys
 * can be any string; the component sanitizes them for CSS purposes internally.
 *
 * ## Layer quick reference
 *
 * - Layer `type` options: `"area" | "line" | "bar"`
 * - Layer `kind` values: `"primary" | "compare" | "annotations"`
 * - To hide a layer: `{ ...l, visible: false }`
 * - To switch chart type: `{ ...l, type: "bar" }` (or `"line"`, `"area"`)
 * - To rename a layer: `{ ...l, id: "myMetric", label: "My Metric" }`
 *
 * ## Formatting (xFormatKind / yFormatKind on state)
 *
 * - `{ type: "numeric" }` — plain number
 * - `{ type: "short" }` — abbreviated (1.2K, 3.4M) — good default for y-axis
 * - `{ type: "currency", currency: "USD", divisor: 100 }` — for cents → dollars
 * - `{ type: "percent", source: "fraction" }` — for 0..1 → "45.2%"
 * - `{ type: "datetime", style: "short" }` — good default for x-axis timestamps
 *
 * Set these on state:
 * `{ ...ANALYTICS_CHART_DEFAULT_STATE, yFormatKind: { type: "currency", currency: "USD" } }`
 *
 * ## Scale warning
 *
 * All visible layers share ONE y-axis. If magnitudes differ wildly (e.g. revenue
 * cents vs signup count), normalize the data BEFORE building Points. If
 * normalization is impossible, use two separate `AnalyticsChart` instances stacked
 * vertically.
 */
export function AnalyticsChart({
  data: fullData,
  annotations: fullAnnotations = [],
  state,
  onChange,
  onAnnotationCreate,
  strings: stringsOverride,
  palette: paletteOverride,
  renderTooltip,
  plotMargin,
  yAxisWidth = 48,
  yDomainPadding = 0.1,
  pie,
  valueFormatter,
}: AnalyticsChartProps) {
  const resolvedPlotMargin = useMemo<Required<Margin>>(
    () => ({
      top: plotMargin?.top ?? 16,
      right: plotMargin?.right ?? 24,
      bottom: plotMargin?.bottom ?? 8,
      left: plotMargin?.left ?? 12,
    }),
    [plotMargin],
  );
  const fmtValue = valueFormatter ?? formatValue;
  const strings = useMemo(
    () => resolveAnalyticsChartStrings(stringsOverride),
    [stringsOverride],
  );
  const palette = useMemo(
    () => resolveAnalyticsChartPalette(paletteOverride),
    [paletteOverride],
  );

  const renderTooltipFn = useMemo(
    () => renderTooltip ?? ((ctx: AnalyticsChartTooltipContext) => <DefaultAnalyticsChartTooltip ctx={ctx} />),
    [renderTooltip],
  );

  const { xFormatKind, yFormatKind, layers } = state;
  const timeseries = isTimeseriesState(state) ? state : null;
  const showGrid = timeseries?.showGrid ?? false;
  const showXAxis = timeseries?.showXAxis ?? false;
  const showYAxis = timeseries?.showYAxis ?? false;
  const zoomRange = timeseries?.zoomRange ?? null;
  const pinnedIndex = timeseries?.pinnedIndex ?? null;

  const primaryLayer = findPrimaryLayer(layers);
  const compareLayer = findCompareLayer(layers);
  const annotationsLayer = findAnnotationsLayer(layers);
  const showPrimary = primaryLayer?.visible ?? false;
  const showCompare = compareLayer?.visible ?? false;
  const showAnnotationsLayer = annotationsLayer?.visible ?? false;

  const primaryStyle = primaryLayer ? resolveDataLayerStyle(primaryLayer) : FALLBACK_PRIMARY_STYLE;
  const compareStyle = compareLayer ? resolveDataLayerStyle(compareLayer) : FALLBACK_COMPARE_STYLE;
  const primaryColor = primaryStyle.color;
  const compareColor = compareStyle.color;
  const annotationColor = annotationsLayer?.color ?? FALLBACK_ANNOTATION_COLOR;
  const primaryStroke = STROKE_DASHARRAY[primaryStyle.strokeStyle];
  const compareStroke = STROKE_DASHARRAY[compareStyle.strokeStyle];
  const primaryFillOpacity = primaryStyle.fillOpacity;
  const compareFillOpacity = compareStyle.fillOpacity;

  const setTimeseriesField = useCallback(
    <K extends keyof AnalyticsChartTimeseriesState>(
      key: K,
      value: AnalyticsChartTimeseriesState[K],
    ) => {
      onChange((prev) => {
        if (prev.view !== "timeseries") return prev;
        return { ...prev, [key]: value };
      });
    },
    [onChange],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [committedRange, setCommittedRange] = useState<[number, number] | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<string | null>(null);
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [pieHoverKey, setPieHoverKey] = useState<string | null>(null);

  const activeIndex = pinnedIndex ?? hoverIndex;

  const primarySegmentSeries = useMemo<readonly AnalyticsChartSeries[]>(
    () => primaryLayer?.segmentSeries ?? EMPTY_SERIES,
    [primaryLayer?.segmentSeries],
  );
  const compareSegmentSeries = useMemo<readonly AnalyticsChartSeries[]>(
    () => compareLayer?.segmentSeries ?? EMPTY_SERIES,
    [compareLayer?.segmentSeries],
  );
  const primaryFullSegments = useMemo<readonly (readonly number[])[]>(
    () => primaryLayer?.segments ?? EMPTY_MATRIX,
    [primaryLayer?.segments],
  );
  const compareFullSegments = useMemo<readonly (readonly number[])[]>(
    () => compareLayer?.segments ?? EMPTY_MATRIX,
    [compareLayer?.segments],
  );

  const primarySegmented =
    (primaryLayer?.segmented ?? false)
    && showPrimary
    && primarySegmentSeries.length > 0
    && primaryFullSegments.length > 0;
  const compareSegmented =
    (compareLayer?.segmented ?? false)
    && showCompare
    && compareSegmentSeries.length > 0
    && compareFullSegments.length > 0;

  const visibleStart = zoomRange ? zoomRange[0] : 0;
  const visibleEnd = zoomRange ? zoomRange[1] : fullData.length - 1;

  const data = useMemo(
    () => fullData.slice(visibleStart, visibleEnd + 1),
    [fullData, visibleStart, visibleEnd],
  );
  const primarySegments = useMemo(
    () => primaryFullSegments.slice(visibleStart, visibleEnd + 1),
    [primaryFullSegments, visibleStart, visibleEnd],
  );
  const compareSegments = useMemo(
    () => compareFullSegments.slice(visibleStart, visibleEnd + 1),
    [compareFullSegments, visibleStart, visibleEnd],
  );
  const primarySegmentTotals = useMemo(
    () => primarySegments.map((row) => row.reduce((a, b) => a + b, 0)),
    [primarySegments],
  );
  const compareSegmentTotals = useMemo(
    () => compareSegments.map((row) => row.reduce((a, b) => a + b, 0)),
    [compareSegments],
  );

  const yDomainMax = useMemo(() => {
    const dataLayerIds = layers.filter(isAnalyticsChartDataLayer).map((l) => l.id);
    const layerMaxes = dataLayerIds.map((id) =>
      data.reduce((m, p) => Math.max(m, pointValue(p, id)), 0),
    );
    const primaryStackMax = primarySegmentTotals.reduce((m, v) => Math.max(m, v), 0);
    const compareStackMax = compareSegmentTotals.reduce((m, v) => Math.max(m, v), 0);
    const rawMax = Math.max(0, ...layerMaxes, primaryStackMax, compareStackMax);
    return Math.ceil(rawMax * (1 + yDomainPadding));
  }, [data, layers, primarySegmentTotals, compareSegmentTotals, yDomainPadding]);

  const segmentColors = useMemo(() => {
    return {
      primary: {
        light: buildRampColors(palette.primary, primarySegmentSeries.length, "light"),
        dark: buildRampColors(palette.primary, primarySegmentSeries.length, "dark"),
      },
      compare: {
        light: buildRampColors(palette.compare, compareSegmentSeries.length, "light"),
        dark: buildRampColors(palette.compare, compareSegmentSeries.length, "dark"),
      },
    };
  }, [primarySegmentSeries.length, compareSegmentSeries.length, palette]);

  const aggregatedPrimarySegments = useMemo(
    () =>
      primarySegmentSeries.map((_, sIdx) =>
        primarySegments.reduce((acc, row) => acc + (row[sIdx] ?? 0), 0),
      ),
    [primarySegmentSeries, primarySegments],
  );
  const aggregatedCompareSegments = useMemo(
    () =>
      compareSegmentSeries.map((_, sIdx) =>
        compareSegments.reduce((acc, row) => acc + (row[sIdx] ?? 0), 0),
      ),
    [compareSegmentSeries, compareSegments],
  );
  const aggregatedPrimaryTotal = useMemo(
    () => aggregatedPrimarySegments.reduce((a, b) => a + b, 0),
    [aggregatedPrimarySegments],
  );
  const aggregatedCompareTotal = useMemo(
    () => aggregatedCompareSegments.reduce((a, b) => a + b, 0),
    [aggregatedCompareSegments],
  );

  const annotations = useMemo(() => {
    return fullAnnotations
      .filter((a) => a.index >= visibleStart && a.index <= visibleEnd)
      .map((a) => ({ ...a, index: a.index - visibleStart }));
  }, [fullAnnotations, visibleStart, visibleEnd]);

  const brushing = brushStart != null;
  const N = data.length;

  const primaryKey = primaryLayer?.id ?? "__analytics_primary";
  const compareKey = compareLayer?.id ?? "__analytics_compare";
  // Segment keys must be valid CSS `<ident>` tokens — colons break `--color-${key}` declarations.
  const primarySolidKey = `${primaryKey}_solid`;
  const primaryDashedKey = `${primaryKey}_dashed`;
  const compareSolidKey = `${compareKey}_solid`;
  const compareDashedKey = `${compareKey}_dashed`;
  const primarySegKey = useCallback(
    (segKey: string) => `${primaryKey}_seg_${cssIdent(segKey)}`,
    [primaryKey],
  );
  const compareSegKey = useCallback(
    (segKey: string) => `${compareKey}_seg_${cssIdent(segKey)}`,
    [compareKey],
  );

  const primaryInProgressLocalIdx = computeLocalInProgressIdx(
    primaryLayer?.inProgressFromIndex,
    visibleStart,
    visibleEnd,
  );
  const compareInProgressLocalIdx = computeLocalInProgressIdx(
    compareLayer?.inProgressFromIndex,
    visibleStart,
    visibleEnd,
  );
  const primaryHasInProgress =
    primaryInProgressLocalIdx != null
    && !primarySegmented
    && (primaryStyle.type === "line" || primaryStyle.type === "area");
  const compareHasInProgress =
    compareInProgressLocalIdx != null
    && !compareSegmented
    && (compareStyle.type === "line" || compareStyle.type === "area");

  const chartData = useMemo(() => {
    return data.map((point, i) => {
      const row: Record<string, number | string | null> = {
        index: i,
        ts: point.ts,
      };
      for (const [k, v] of Object.entries(point.values)) {
        row[k] = v;
      }
      if (primaryLayer && primaryHasInProgress) {
        const k = primaryInProgressLocalIdx as number;
        const v = pointValue(point, primaryLayer.id);
        row[primarySolidKey] = i < k ? v : null;
        row[primaryDashedKey] = i >= k - 1 ? v : null;
      }
      if (compareLayer && compareHasInProgress) {
        const k = compareInProgressLocalIdx as number;
        const v = pointValue(point, compareLayer.id);
        row[compareSolidKey] = i < k ? v : null;
        row[compareDashedKey] = i >= k - 1 ? v : null;
      }
      if (primarySegmented) {
        primarySegmentSeries.forEach((s, sIdx) => {
          row[primarySegKey(s.key)] = primarySegments[i]?.[sIdx] ?? 0;
        });
      }
      if (compareSegmented) {
        compareSegmentSeries.forEach((s, sIdx) => {
          row[compareSegKey(s.key)] = compareSegments[i]?.[sIdx] ?? 0;
        });
      }
      return row;
    });
  }, [
    data,
    primaryLayer,
    compareLayer,
    primarySolidKey,
    primaryDashedKey,
    compareSolidKey,
    compareDashedKey,
    primarySegKey,
    compareSegKey,
    primarySegments,
    compareSegments,
    primarySegmentSeries,
    compareSegmentSeries,
    primarySegmented,
    compareSegmented,
    primaryHasInProgress,
    compareHasInProgress,
    primaryInProgressLocalIdx,
    compareInProgressLocalIdx,
  ]);

  const chartConfig = useMemo<DesignChartConfig>(() => {
    const primaryLabel = primaryLayer?.label ?? "";
    const compareLabel = compareLayer?.label ?? "";
    const config: DesignChartConfig = {};
    if (primaryLayer) {
      config[primaryLayer.id] = { label: primaryLabel, color: primaryColor };
      if (primaryHasInProgress) {
        config[primarySolidKey] = { label: primaryLabel, color: primaryColor };
        config[primaryDashedKey] = { label: primaryLabel, color: primaryColor };
      }
    }
    if (compareLayer) {
      config[compareLayer.id] = { label: compareLabel, color: compareColor };
      if (compareHasInProgress) {
        config[compareSolidKey] = { label: compareLabel, color: compareColor };
        config[compareDashedKey] = { label: compareLabel, color: compareColor };
      }
    }
    if (primarySegmented) {
      primarySegmentSeries.forEach((s, i) => {
        config[primarySegKey(s.key)] = {
          label: s.label,
          theme: {
            light: segmentColors.primary.light[i],
            dark: segmentColors.primary.dark[i],
          },
        };
      });
    }
    if (compareSegmented) {
      compareSegmentSeries.forEach((s, i) => {
        config[compareSegKey(s.key)] = {
          label: s.label,
          theme: {
            light: segmentColors.compare.light[i],
            dark: segmentColors.compare.dark[i],
          },
        };
      });
    }
    return config;
  }, [
    primaryLayer,
    compareLayer,
    primarySolidKey,
    primaryDashedKey,
    compareSolidKey,
    compareDashedKey,
    primarySegKey,
    compareSegKey,
    primaryColor,
    compareColor,
    primaryHasInProgress,
    compareHasInProgress,
    primarySegmented,
    compareSegmented,
    primarySegmentSeries,
    compareSegmentSeries,
    segmentColors,
  ]);

  const handleChartMouseMove = useCallback(
    (rechartsState: RechartsMouseState) => {
      const i = rechartsState.activeTooltipIndex;
      if (typeof i !== "number") return;
      setHoverIndex(i);
      if (dragAnchor != null && (brushStart != null || i !== dragAnchor)) {
        if (brushStart == null) setBrushStart(dragAnchor);
        setBrushEnd(i);
      }
    },
    [dragAnchor, brushStart],
  );
  const handleChartMouseDown = useCallback(
    (rechartsState: RechartsMouseState, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const i = rechartsState.activeTooltipIndex;
      if (typeof i !== "number") return;
      e.preventDefault();
      setDragAnchor(i);
      setAnnotationDraft(null);
    },
    [],
  );
  const handleChartMouseUp = useCallback(
    (_: RechartsMouseState, e: React.MouseEvent) => {
      e.stopPropagation();
      if (brushStart != null && brushEnd != null) {
        const lo = Math.min(brushStart, brushEnd);
        const hi = Math.max(brushStart, brushEnd);
        setBrushStart(null);
        setBrushEnd(null);
        setDragAnchor(null);
        if (hi - lo >= 1) setCommittedRange([lo, hi]);
        return;
      }
      setDragAnchor(null);
      if (pinnedIndex != null) {
        setTimeseriesField("pinnedIndex", null);
      } else if (hoverIndex != null) {
        setTimeseriesField("pinnedIndex", hoverIndex);
      }
    },
    [
      brushStart,
      brushEnd,
      hoverIndex,
      pinnedIndex,
      setTimeseriesField,
    ],
  );
  const handleChartMouseLeave = useCallback(() => {
    if (!brushing) setHoverIndex(null);
  }, [brushing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setHoverIndex((cur) => {
          const base = cur ?? pinnedIndex ?? 0;
          return e.key === "ArrowRight"
            ? Math.min(N - 1, base + 1)
            : Math.max(0, base - 1);
        });
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setHoverIndex(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setHoverIndex(N - 1);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (pinnedIndex != null) {
          setTimeseriesField("pinnedIndex", null);
        } else if (hoverIndex != null) {
          setTimeseriesField("pinnedIndex", hoverIndex);
        }
      }
    },
    [N, hoverIndex, pinnedIndex, setTimeseriesField],
  );

  useEffect(() => {
    if (pinnedIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTimeseriesField("pinnedIndex", null);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setTimeseriesField("pinnedIndex", null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [pinnedIndex, setTimeseriesField]);

  const plotInset = resolvedPlotMargin.left + resolvedPlotMargin.right;
  const indexToCss = useCallback(
    (i: number): string => {
      if (N <= 1) return `calc(${resolvedPlotMargin.left}px + (100% - ${plotInset}px) * 0.5)`;
      const t = Math.max(0, Math.min(1, i / (N - 1)));
      return `calc(${resolvedPlotMargin.left}px + (100% - ${plotInset}px) * ${t})`;
    },
    [N, resolvedPlotMargin.left, plotInset],
  );
  const tooltipXPct = activeIndex != null
    ? N <= 1
      ? 50
      : (activeIndex / (N - 1)) * 100
    : 0;
  const shouldFlip = tooltipXPct > 68;

  const activePoint = activeIndex != null ? data[activeIndex] : null;

  const chartAriaLabel = primaryLayer?.label || "Chart";

  if (state.view === "pie") {
    return (
      <AnalyticsChartPie
        wrapperRef={wrapperRef}
        primarySegmentSeries={primarySegmentSeries}
        compareSegmentSeries={compareSegmentSeries}
        aggregatedPrimarySegments={aggregatedPrimarySegments}
        aggregatedCompareSegments={aggregatedCompareSegments}
        aggregatedPrimaryTotal={aggregatedPrimaryTotal}
        aggregatedCompareTotal={aggregatedCompareTotal}
        segmentColors={segmentColors}
        showPrimary={showPrimary}
        showCompare={showCompare}
        xFormatKind={xFormatKind}
        yFormatKind={yFormatKind}
        hoverKey={pieHoverKey}
        setHoverKey={setPieHoverKey}
        zoomRange={zoomRange}
        onResetZoom={() => {
          onChange((prev) => ({ ...prev, zoomRange: null, pinnedIndex: null }));
          setCommittedRange(null);
          setAnnotationDraft(null);
          setHoverIndex(null);
        }}
        visibleStart={visibleStart}
        visibleEnd={visibleEnd}
        fullData={fullData}
        strings={strings}
        fmtValue={fmtValue}
        pie={pie}
      />
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative w-full select-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:focus-visible:ring-blue-400/40",
        brushing && "[&_.recharts-wrapper]:cursor-ew-resize",
        !brushing && "[&_.recharts-wrapper]:cursor-crosshair",
      )}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        if (hoverIndex == null) setHoverIndex(pinnedIndex ?? Math.floor(N / 2));
      }}
      tabIndex={0}
      role="img"
      aria-label={`${chartAriaLabel} over the visible ${data.length}-day range. Use arrow keys to move the cursor, Enter to pin, Escape to release. Click and drag to select a range.`}
    >
      <DesignChartContainer
        config={chartConfig}
        className="aspect-auto h-[260px] w-full sm:h-[320px]"
      >
        <ComposedChart
          data={chartData}
          margin={resolvedPlotMargin}
          onMouseMove={handleChartMouseMove}
          onMouseDown={handleChartMouseDown}
          onMouseUp={handleChartMouseUp}
          onMouseLeave={handleChartMouseLeave}
        >
          {showGrid && <CartesianGrid vertical={false} strokeDasharray="3 3" />}
          {showXAxis && (
            <XAxis
              dataKey="index"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={32}
              tickFormatter={(value: number | string) => {
                const idx = Number(value);
                if (idx < 0 || idx >= data.length) return "";
                return fmtValue(data[idx]!.ts, xFormatKind);
              }}
            />
          )}
          {showYAxis && (
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={yAxisWidth}
              domain={[0, yDomainMax]}
              allowDataOverflow={false}
              tickFormatter={(value: number | string) =>
                fmtValue(Math.round(Number(value)), yFormatKind)
              }
            />
          )}

          {showAnnotationsLayer
            && annotations.map((a) => (
              <ReferenceLine
                key={a.index}
                x={a.index}
                stroke={annotationColor}
                strokeDasharray="3 4"
                strokeOpacity={0.55}
                ifOverflow="visible"
              />
            ))}

          {committedRange && (
            <ReferenceArea
              x1={committedRange[0]}
              x2={committedRange[1]}
              fill={primaryColor}
              fillOpacity={0.07}
              stroke={primaryColor}
              strokeOpacity={0.45}
              strokeDasharray="3 3"
              ifOverflow="visible"
            />
          )}

          {brushStart != null && brushEnd != null && (
            <ReferenceArea
              x1={Math.min(brushStart, brushEnd)}
              x2={Math.max(brushStart, brushEnd)}
              fill={primaryColor}
              fillOpacity={0.15}
              stroke={primaryColor}
              strokeOpacity={0.55}
              ifOverflow="visible"
            />
          )}

          {showPrimary && primaryLayer && renderDataSeries({
            layer: primaryLayer,
            segmented: primarySegmented,
            segmentSeries: primarySegmentSeries,
            segKey: primarySegKey,
            stackId: "primary-segments",
            strokeDasharray: primaryStroke,
            segmentedStrokeDasharray: undefined,
            fillOpacity: primaryFillOpacity,
            segmentedFillOpacity: 0.78,
            strokeWidth: 2,
            segmentedStrokeWidth: 0.75,
            inProgressKeys: primaryHasInProgress
              ? { solid: primarySolidKey, dashed: primaryDashedKey }
              : null,
          })}

          {showCompare && compareLayer && renderDataSeries({
            layer: compareLayer,
            segmented: compareSegmented,
            segmentSeries: compareSegmentSeries,
            segKey: compareSegKey,
            stackId: "compare-segments",
            strokeDasharray: compareStroke,
            segmentedStrokeDasharray: compareStroke,
            fillOpacity: compareFillOpacity,
            segmentedFillOpacity: 0.6,
            baseOpacity: compareSegmented ? 0.9 : 1,
            strokeWidth: 1.5,
            segmentedStrokeWidth: 0.75,
            inProgressKeys: compareHasInProgress
              ? { solid: compareSolidKey, dashed: compareDashedKey }
              : null,
          })}
        </ComposedChart>
      </DesignChartContainer>

      {activeIndex != null && activePoint && !brushing && (
        <div
          className="pointer-events-none absolute inset-y-4 z-10 w-px border-l border-dashed border-foreground/30"
          style={{ left: indexToCss(activeIndex) }}
        />
      )}

      {brushStart != null && brushEnd != null && (() => {
        const lo = Math.min(brushStart, brushEnd);
        const hi = Math.max(brushStart, brushEnd);
        const days = hi - lo + 1;
        return (
          <div
            className="pointer-events-none absolute -top-1 z-30 -translate-x-1/2 -translate-y-full rounded-lg border border-blue-500/30 bg-background/95 px-3 py-1.5 text-[11px] shadow-lg backdrop-blur-xl dark:border-blue-400/30"
            style={{ left: indexToCss((lo + hi) / 2) }}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {strings.rangeLabel}
              </span>
              <span className="font-mono tabular-nums text-foreground">
                {fmtValue(data[lo]!.ts, xFormatKind)} – {fmtValue(data[hi]!.ts, xFormatKind)}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                · {strings.daysShort(days)}
              </span>
            </div>
          </div>
        );
      })()}

      {zoomRange && (
        <div className="absolute right-2 top-2 z-20">
          <button
            type="button"
            onClick={() => {
              onChange((prev) => ({ ...prev, zoomRange: null, pinnedIndex: null }));
              setCommittedRange(null);
              setAnnotationDraft(null);
              setHoverIndex(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-blue-600 ring-1 ring-blue-500/30 transition-colors duration-150 hover:bg-blue-500/15 hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:text-blue-300 dark:ring-blue-400/30"
          >
            <MagnifyingGlassMinusIcon weight="bold" className="size-3" aria-hidden="true" />
            <span>{strings.resetZoom}</span>
          </button>
        </div>
      )}

      {committedRange && !brushing && (() => {
        const [lo, hi] = committedRange;
        const center = (lo + hi) / 2;
        const centerPct = N <= 1 ? 50 : (center / (N - 1)) * 100;
        const snapLeft = centerPct < 22;
        const snapRight = centerPct > 78;
        const anchorStyle: CSSProperties = snapLeft
          ? { left: "8px" }
          : snapRight
            ? { right: "8px" }
            : { left: indexToCss(center), transform: "translateX(-50%)" };
        const days = hi - lo + 1;
        const draft = annotationDraft;
        return (
          <div className="absolute top-2 z-30" style={anchorStyle}>
            <div className="flex items-center gap-1 rounded-full border border-foreground/10 bg-background/95 py-1 pl-2 pr-1 shadow-[0_10px_28px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:shadow-[0_10px_28px_rgba(0,0,0,0.55)]">
              {draft == null ? (
                <>
                  <span className="flex items-center gap-1.5 whitespace-nowrap px-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                    <span className="text-foreground">
                      {fmtValue(data[lo]!.ts, xFormatKind)} – {fmtValue(data[hi]!.ts, xFormatKind)}
                    </span>
                    <span className="text-foreground/30">·</span>
                    <span>{strings.daysShort(days)}</span>
                  </span>
                  <div className="h-4 w-px bg-foreground/10" aria-hidden="true" />
                  <DesignButton
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-[11px]"
                    onClick={() => {
                      onChange((prev) => ({
                        ...prev,
                        zoomRange: [visibleStart + lo, visibleStart + hi],
                        pinnedIndex: null,
                      }));
                      setCommittedRange(null);
                      setAnnotationDraft(null);
                      setHoverIndex(null);
                    }}
                  >
                    <MagnifyingGlassPlusIcon weight="bold" className="size-3.5" aria-hidden="true" />
                    {strings.zoomIn}
                  </DesignButton>
                  <DesignButton
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-[11px]"
                    onClick={() => setAnnotationDraft("")}
                  >
                    <FlagIcon weight="bold" className="size-3.5" aria-hidden="true" />
                    {strings.annotate}
                  </DesignButton>
                  <DesignButton
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    aria-label={strings.clearSelection}
                    onClick={() => setCommittedRange(null)}
                  >
                    <XIcon weight="bold" className="size-3.5" aria-hidden="true" />
                  </DesignButton>
                </>
              ) : (
                <form
                  className="flex items-center gap-1 px-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const label = draft.trim();
                    if (label.length === 0) return;
                    const mid = Math.round((lo + hi) / 2);
                    onAnnotationCreate?.({
                      index: visibleStart + mid,
                      label,
                      description: label,
                    });
                    setCommittedRange(null);
                    setAnnotationDraft(null);
                  }}
                >
                  <FlagIcon
                    weight="bold"
                    className="size-3.5 text-amber-500 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <input
                    autoFocus
                    type="text"
                    value={draft}
                    onChange={(e) => setAnnotationDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setAnnotationDraft(null);
                      }
                    }}
                    maxLength={40}
                    placeholder={strings.annotationPlaceholder}
                    aria-label={strings.annotationLabelAria}
                    className="w-44 bg-transparent px-1 py-0.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none"
                  />
                  <DesignButton
                    type="submit"
                    size="sm"
                    variant="default"
                    className="h-7 px-2.5 text-[11px]"
                    disabled={draft.trim().length === 0}
                  >
                    {strings.save}
                  </DesignButton>
                  <DesignButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setAnnotationDraft(null)}
                  >
                    {strings.cancel}
                  </DesignButton>
                </form>
              )}
            </div>
          </div>
        );
      })()}

      {showAnnotationsLayer && (
        <div className="pointer-events-none absolute inset-x-0 top-1 h-0">
          {annotations.map((a) => {
            return (
              <div
                key={a.index}
                className="absolute -translate-x-1/2"
                style={{ left: indexToCss(a.index) }}
              >
                <button
                  type="button"
                  aria-label={a.description}
                  className="peer pointer-events-auto inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-[1px] font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300 dark:bg-amber-500/20 dark:ring-amber-500/40 transition-colors duration-150 hover:bg-amber-500/25 hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                >
                  <FlagIcon weight="fill" className="size-2.5" aria-hidden="true" />
                  {a.label}
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-normal text-background shadow-md peer-hover:block peer-focus-visible:block"
                >
                  {a.description}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {activeIndex != null && activePoint && (() => {
        const primaryView = buildTooltipLayerView({
          show: showPrimary,
          layer: primaryLayer,
          color: primaryColor,
          segmented: primarySegmented,
          segmentSeries: primarySegmentSeries,
          segmentRows: primarySegments,
          segmentTotals: primarySegmentTotals,
          segmentColorsLight: segmentColors.primary.light,
          segmentColorsDark: segmentColors.primary.dark,
          activeIndex,
          activePoint,
          fallbackLabel: "Chart",
        });
        const compareView = buildTooltipLayerView({
          show: showCompare,
          layer: compareLayer,
          color: compareColor,
          segmented: compareSegmented,
          segmentSeries: compareSegmentSeries,
          segmentRows: compareSegments,
          segmentTotals: compareSegmentTotals,
          segmentColorsLight: segmentColors.compare.light,
          segmentColorsDark: segmentColors.compare.dark,
          activeIndex,
          activePoint,
        });
        const delta: AnalyticsChartDelta | null = primaryView && compareView
          ? formatDelta(primaryView.total, compareView.total)
          : null;
        const ctx: AnalyticsChartTooltipContext = {
          activeIndex,
          point: activePoint,
          isPinned: pinnedIndex != null,
          primary: primaryView,
          compare: compareView,
          delta,
          formatValue: (v) => fmtValue(v, yFormatKind),
          formatDate: (ts) => fmtValue(ts, xFormatKind),
          strings,
        };
        return (
          <div
            className={cn(
              "pointer-events-none absolute top-10 z-20",
              "transition-[transform,opacity] duration-150",
            )}
            style={{
              left: indexToCss(activeIndex),
              transform: shouldFlip
                ? "translateX(calc(-100% - 16px))"
                : "translateX(16px)",
            }}
          >
            {renderTooltipFn(ctx)}
          </div>
        );
      })()}
    </div>
  );
}

