/** Time-series point. `values` is keyed by layer id. */
export type Point = {
  ts: number,
  values: Record<string, number>,
};

/** Missing or non-finite values become 0. */
export function pointValue(p: Point, id: string): number {
  const v = p.values[id];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Sanitize a string into a valid CSS `<ident>` token.
 *  Replaces characters not allowed in CSS identifiers (like `$`, spaces,
 *  slashes, dots) with underscores. Used to build safe `var(--color-xxx)`
 *  custom property names from arbitrary segment keys. */
export function cssIdent(raw: string): string {
  // Replace everything that isn't a letter, digit, hyphen, or underscore.
  // Prefix with `_` if the result starts with a digit (not valid as ident start).
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  return /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export type Annotation = {
  index: number,
  label: string,
  description: string,
};

/** Breakdown category definition — `{ key, label }` tuple. */
export type AnalyticsChartSeries = {
  key: string,
  label: string,
};

export type FormatKindType =
  | "numeric"
  | "short"
  | "currency"
  | "duration"
  | "datetime"
  | "percent";

export type FormatKindNumeric = {
  type: "numeric",
  /** Locale used for grouping and digit separators. Defaults to "en-US". */
  locale?: string,
  /** Fixed decimal places (0-4). Defaults to 0. */
  decimals?: number,
};
export type FormatKindShort = {
  type: "short",
  /** Decimal places after the unit suffix (1.2K vs 1.20K). Defaults to 1. */
  precision?: number,
  locale?: string,
};
export type FormatKindCurrency = {
  type: "currency",
  /** ISO 4217 code. Defaults to "USD". */
  currency?: string,
  /** Divisor applied before formatting — e.g. 100 for cents → dollars. Defaults to 1. */
  divisor?: number,
  locale?: string,
};
export type FormatKindDuration = {
  type: "duration",
  /** Source unit of the input value. Defaults to "s". */
  unit?: "ms" | "s" | "m" | "h",
  /** Show the smallest unit even when zero. Defaults to false. */
  showZero?: boolean,
};
export type FormatKindDatetime = {
  type: "datetime",
  /** Render style. Defaults to "short". */
  style?: "short" | "long" | "iso" | "relative",
  locale?: string,
};
export type FormatKindPercent = {
  type: "percent",
  /** How to interpret the input value:
   * - "fraction" → 0..1     → multiply by 100  (default)
   * - "basis"    → 0..10000 → divide by 100
   * - "whole"    → 0..100   → no scaling
   */
  source?: "fraction" | "basis" | "whole",
  /** Decimal places. Defaults to 1. */
  decimals?: number,
};

export type FormatKind =
  | FormatKindNumeric
  | FormatKindShort
  | FormatKindCurrency
  | FormatKindDuration
  | FormatKindDatetime
  | FormatKindPercent;

export type AnalyticsChartView = "timeseries" | "pie";
export type AnalyticsChartLayerType = "line" | "area" | "bar";
export type AnalyticsChartStrokeStyle = "solid" | "dashed" | "dotted";

type AnalyticsChartDataLayerCommon = {
  id: string,
  kind: "primary" | "compare",
  label: string,
  visible: boolean,
  color: string,
  segmented: boolean,
  /** Per-day per-category values. Outer index is the day (matches the
   * chart data array index); inner index is the category (matches
   * `segmentSeries`). Rows should sum to `point.values[layer.id]`. */
  segments?: readonly (readonly number[])[],
  /** Breakdown category definitions ordered to match the inner index of
   * `segments`. */
  segmentSeries?: readonly AnalyticsChartSeries[],
  /** Absolute index into the full data array at which this layer's values
   * become "in progress" (incomplete and still changing). Points from this
   * index onward render with a dashed overlay so users don't panic at a
   * half-filled bucket. Applies to line and area rendering only. */
  inProgressFromIndex?: number | null,
};
export type AnalyticsChartLineLayer = AnalyticsChartDataLayerCommon & {
  type: "line",
  strokeStyle: AnalyticsChartStrokeStyle,
};
export type AnalyticsChartAreaLayer = AnalyticsChartDataLayerCommon & {
  type: "area",
  strokeStyle: AnalyticsChartStrokeStyle,
  fillOpacity: number,
};
export type AnalyticsChartBarLayer = AnalyticsChartDataLayerCommon & {
  type: "bar",
  fillOpacity: number,
};

export type AnalyticsChartDataLayer =
  | AnalyticsChartLineLayer
  | AnalyticsChartAreaLayer
  | AnalyticsChartBarLayer;

export type AnalyticsChartAnnotationsLayer = {
  id: string,
  kind: "annotations",
  label: string,
  visible: boolean,
  color: string,
};

export type AnalyticsChartLayer =
  | AnalyticsChartDataLayer
  | AnalyticsChartAnnotationsLayer;

export type AnalyticsChartLayers = readonly AnalyticsChartLayer[];

export type AnalyticsChartTimeseriesState = {
  view: "timeseries",
  layers: AnalyticsChartLayers,
  /** Format applied to every x-axis value. Defaults to `datetime / short`. */
  xFormatKind: FormatKind,
  /** Format applied to every y-axis value. Defaults to `short`. */
  yFormatKind: FormatKind,
  showGrid: boolean,
  showXAxis: boolean,
  showYAxis: boolean,
  zoomRange: [number, number] | null,
  pinnedIndex: number | null,
};
export type AnalyticsChartPieState = {
  view: "pie",
  layers: AnalyticsChartLayers,
  xFormatKind: FormatKind,
  yFormatKind: FormatKind,
};
export type AnalyticsChartState =
  | AnalyticsChartTimeseriesState
  | AnalyticsChartPieState;

export type AnalyticsChartDelta = {
  pct: number | null,
  sign: "up" | "down" | "flat" | "na",
};

/** Grouped pie config — collapses the formerly-separate
 * `pieInnerRadius` / `pieOuterRadius` / `pieCompareInnerRadius` /
 * `pieCompareOuterRadius` / `pieContainerClassName` props into one object. */
export type AnalyticsChartPieProps = {
  innerRadius?: number,
  outerRadius?: number,
  compareInnerRadius?: number,
  compareOuterRadius?: number,
  className?: string,
};

export type AnalyticsChartSegmentRamp =
  | {
    kind: "procedural",
    /** HSL hue (0-360). */
    hue: number,
    /** HSL saturation percent (0-100). */
    sat: number,
    /** Lightness range `[start, end]` for the light theme (0-100). */
    shadeRangeLight: [number, number],
    /** Lightness range `[start, end]` for the dark theme (0-100). */
    shadeRangeDark: [number, number],
  }
  | {
    kind: "explicit",
    /** Concrete light-theme color list. Indexed by segment. */
    light: readonly string[],
    /** Concrete dark-theme color list. Indexed by segment. */
    dark: readonly string[],
  };

export type AnalyticsChartPalette = {
  /** Color ramp for the primary data layer (current period). */
  primary: AnalyticsChartSegmentRamp,
  /** Color ramp for the compare data layer (previous period). */
  compare: AnalyticsChartSegmentRamp,
};
