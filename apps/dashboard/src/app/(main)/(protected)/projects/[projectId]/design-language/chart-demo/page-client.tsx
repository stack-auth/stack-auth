"use client";

import {
  DesignAlert,
  DesignAnalyticsCard,
  DesignAnalyticsCardHeader,
  DesignBadge,
  DesignButton,
  DesignPillToggle,
} from "@/components/design-components";
import { cn, Typography } from "@/components/ui";
import {
  type ChartConfig,
  ChartContainer,
} from "@/components/ui/chart";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  ChartBarIcon,
  ChartPieIcon,
  ChartLineIcon,
  ChartLineUpIcon,
  CursorClickIcon,
  FlagIcon,
  LightningIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MinusIcon,
  PulseIcon,
  PushPinSimpleIcon,
  SpinnerGapIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { PageLayout } from "../../page-layout";


const DAY_COUNT = 30;

/** Chart point: `values` keyed by layer id. */
type Point = {
  ts: number,
  values: Record<string, number>,
};

/** Missing or non-finite values become 0. */
function pointValue(p: Point, id: string): number {
  const v = p.values[id];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

const SERIES: Point[] = Array.from({ length: DAY_COUNT }, (_, i) => {
  const base = 420;
  const trend = i * 14;
  const wave = Math.sin(i * 0.48) * 78 + Math.cos(i * 0.21) * 34;
  const prev = base + (i * 9) + Math.sin(i * 0.52 + 1.4) * 62;
  return {
    ts: Date.UTC(2026, 2, 7 + i), // Mar 7, 2026 → ~Apr 5
    values: {
      signups: Math.max(0, Math.round(base + trend + wave)),
      previous: Math.max(0, Math.round(prev)),
    },
  };
});

type Annotation = {
  index: number,
  label: string,
  description: string,
};


type HeroBreakdownSeries = {
  key: string,
  label: string,
};

const HERO_BREAKDOWN_SERIES: HeroBreakdownSeries[] = [
  { key: "us",    label: "United States" },
  { key: "eu",    label: "European Union" },
  { key: "asia",  label: "Asia-Pacific" },
  { key: "latam", label: "Latin America" },
  { key: "other", label: "Other" },
];

const HERO_BREAKDOWN_RATIOS = [0.32, 0.26, 0.20, 0.13, 0.09];

function allocateByWeight(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sumW);
  const floors = raw.map((r) => Math.floor(r));
  const base = floors.reduce((a, b) => a + b, 0);
  const remainder = total - base;
  // Distribute the remainder one unit at a time to the segments with the
  // largest fractional parts — same algorithm Hamilton's method uses for
  // apportioning seats.
  const order = raw
    .map((r, idx) => ({ idx, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let i = 0; i < remainder; i++) {
    result[order[i % order.length]!.idx]!++;
  }
  return result;
}

const HERO_BREAKDOWN: number[][] = SERIES.map((p, i) => {
  const weights = HERO_BREAKDOWN_RATIOS.map((r, k) => {
    const wave = Math.sin((i + k * 3) * 0.32) * 0.06;
    return Math.max(0.01, r + wave);
  });
  return allocateByWeight(pointValue(p, "signups"), weights);
});

const HERO_BREAKDOWN_PREV: number[][] = SERIES.map((p, i) => {
  const weights = HERO_BREAKDOWN_RATIOS.map((r, k) => {
    const wave = Math.sin((i + k * 3) * 0.32 + 1.7) * 0.05;
    return Math.max(0.01, r + wave);
  });
  return allocateByWeight(pointValue(p, "previous"), weights);
});

export type HeroChartSegmentRamp =
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

export type HeroChartPalette = {
  /** Color ramp for the primary data layer (sign-ups / current period). */
  primary: HeroChartSegmentRamp,
  /** Color ramp for the compare data layer (previous period). */
  compare: HeroChartSegmentRamp,
};

export const HERO_CHART_DEFAULT_PALETTE: HeroChartPalette = {
  primary: {
    kind: "procedural",
    hue: 220,
    sat: 78,
    shadeRangeLight: [28, 62],
    shadeRangeDark: [52, 82],
  },
  compare: {
    kind: "procedural",
    hue: 38,
    sat: 92,
    shadeRangeLight: [28, 62],
    shadeRangeDark: [52, 82],
  },
};

function resolveHeroChartPalette(
  override: Partial<HeroChartPalette> | undefined,
): HeroChartPalette {
  if (!override) return HERO_CHART_DEFAULT_PALETTE;
  return {
    primary: override.primary ?? HERO_CHART_DEFAULT_PALETTE.primary,
    compare: override.compare ?? HERO_CHART_DEFAULT_PALETTE.compare,
  };
}

/** Expand a ramp into N colors for a given theme. */
function buildRampColors(
  ramp: HeroChartSegmentRamp,
  count: number,
  theme: "light" | "dark",
): string[] {
  if (ramp.kind === "explicit") {
    const list = theme === "light" ? ramp.light : ramp.dark;
    // If the consumer supplied an empty list we fall back to a neutral
    // grey for every segment. Otherwise, pad by clamping the index to
    // the last entry so the color list extends naturally if the consumer
    // supplied fewer colors than there are segments.
    if (list.length === 0) return Array.from({ length: count }, () => "#888");
    return Array.from(
      { length: count },
      (_, i) => list[i < list.length ? i : list.length - 1]!,
    );
  }
  const range = theme === "light" ? ramp.shadeRangeLight : ramp.shadeRangeDark;
  return Array.from({ length: count }, (_, i) => {
    const t = count <= 1 ? 0.5 : i / (count - 1);
    const l = range[0] + t * (range[1] - range[0]);
    return `hsl(${ramp.hue} ${ramp.sat}% ${l.toFixed(1)}%)`;
  });
}

const ANNOTATIONS: Annotation[] = [
  { index: 8,  label: "v4.2", description: "Release v4.2 — new SSO provider" },
  { index: 17, label: "Fix",  description: "Hotfix deployed — rate-limit regression" },
  { index: 24, label: "Exp",  description: "A/B test launched — signup copy" },
];


type FormatKindType =
  | "numeric"
  | "short"
  | "currency"
  | "duration"
  | "datetime"
  | "percent";

type FormatKindNumeric = {
  type: "numeric",
  /** Locale used for grouping and digit separators. Defaults to "en-US". */
  locale?: string,
  /** Fixed decimal places (0-4). Defaults to 0. */
  decimals?: number,
};
type FormatKindShort = {
  type: "short",
  /** Decimal places after the unit suffix (1.2k vs 1.20k). Defaults to 1. */
  precision?: number,
};
type FormatKindCurrency = {
  type: "currency",
  /** ISO 4217 code. Defaults to "USD". */
  currency?: string,
  /** Divisor applied before formatting — e.g. 100 for cents → dollars. Defaults to 1. */
  divisor?: number,
  locale?: string,
};
type FormatKindDuration = {
  type: "duration",
  /** Source unit of the input value. Defaults to "s". */
  unit?: "ms" | "s" | "m" | "h",
  /** Show the smallest unit even when zero. Defaults to false. */
  showZero?: boolean,
};
type FormatKindDatetime = {
  type: "datetime",
  /** Render style. Defaults to "short". */
  style?: "short" | "long" | "iso" | "relative",
  locale?: string,
};
type FormatKindPercent = {
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

type FormatKind =
  | FormatKindNumeric
  | FormatKindShort
  | FormatKindCurrency
  | FormatKindDuration
  | FormatKindDatetime
  | FormatKindPercent;

const FORMAT_KIND_TYPES: FormatKindType[] = [
  "numeric",
  "short",
  "currency",
  "duration",
  "datetime",
  "percent",
];

const DEFAULT_FORMAT_KIND: { [K in FormatKindType]: Extract<FormatKind, { type: K }> } = {
  numeric: { type: "numeric",  locale: "en-US", decimals: 0 },
  short: { type: "short",    precision: 1 },
  currency: { type: "currency", currency: "USD", divisor: 100, locale: "en-US" },
  duration: { type: "duration", unit: "s", showZero: false },
  datetime: { type: "datetime", style: "short", locale: "en-US" },
  percent: { type: "percent",  source: "fraction", decimals: 1 },
};

function formatValue(value: number, kind: FormatKind): string {
  switch (kind.type) {
    case "numeric": {
      const decimals = kind.decimals ?? 0;
      return value.toLocaleString(kind.locale ?? "en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    case "short": {
      const p = kind.precision ?? 1;
      const abs = Math.abs(value);
      if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(p)}B`;
      if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(p)}M`;
      if (abs >= 1_000) return `${(value / 1_000).toFixed(p)}k`;
      return `${value.toFixed(p === 0 ? 0 : 0)}`;
    }
    case "currency": {
      const divisor = kind.divisor ?? 1;
      return new Intl.NumberFormat(kind.locale ?? "en-US", {
        style: "currency",
        currency: kind.currency ?? "USD",
      }).format(value / divisor);
    }
    case "duration": {
      const unit = kind.unit ?? "s";
      // Normalize the input value to seconds before splitting into h/m/s.
      const seconds = unit === "ms" ? value / 1000
        : unit === "m" ? value * 60
          : unit === "h" ? value * 3600
            : value;
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const ms = unit === "ms" && seconds < 1 ? Math.round(value) : 0;
      if (h > 0) return `${h}h ${m}m ${s}s`;
      if (m > 0) return `${m}m ${s}s`;
      if (unit === "ms" && seconds < 1) return `${ms}ms`;
      if (s > 0 || kind.showZero) return `${s}s`;
      return "0s";
    }
    case "datetime": {
      const d = new Date(value);
      const style = kind.style ?? "short";
      const locale = kind.locale ?? "en-US";
      if (style === "iso") return d.toISOString();
      if (style === "relative") {
        const diff = Date.now() - value;
        const past = diff > 0;
        const abs = Math.abs(diff);
        const days = Math.floor(abs / 86_400_000);
        const hours = Math.floor(abs / 3_600_000);
        const mins = Math.floor(abs / 60_000);
        const suffix = past ? "ago" : "from now";
        if (days >= 1) return `${days}d ${suffix}`;
        if (hours >= 1) return `${hours}h ${suffix}`;
        if (mins >= 1) return `${mins}m ${suffix}`;
        return "just now";
      }
      if (style === "long") return d.toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    }
    case "percent": {
      const source = kind.source ?? "fraction";
      const decimals = kind.decimals ?? 1;
      const pct = source === "basis" ? value / 100
        : source === "whole" ? value
          : value * 100;
      return `${pct.toFixed(decimals)}%`;
    }
  }
}

function formatDelta(current: number, previous: number): {
  pct: number | null,
  sign: "up" | "down" | "flat" | "na",
} {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { pct: null, sign: "na" };
  if (previous === 0) return current === 0 ? { pct: 0, sign: "flat" } : { pct: null, sign: "na" };
  const pct = Number((((current - previous) / previous) * 100).toFixed(1));
  const sign = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return { pct, sign };
}

function formatDate(ts: number, opts?: { short?: boolean }): string {
  const d = new Date(ts);
  if (opts?.short) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}


function SectionHeading({
  index,
  label,
  caption,
  right,
}: {
  index: string,
  label: string,
  caption: ReactNode,
  right?: ReactNode,
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 tabular-nums">
          {index}
        </span>
        <div className="min-w-0">
          <Typography type="h3" className="text-xs font-semibold uppercase tracking-wider">
            {label}
          </Typography>
          <Typography variant="secondary" className="text-[11px] mt-0.5 truncate">
            {caption}
          </Typography>
        </div>
      </div>
      {right != null && <div className="shrink-0">{right}</div>}
    </div>
  );
}


function TrendPill({
  delta,
  label,
  size = "sm",
}: {
  delta: { pct: number | null, sign: "up" | "down" | "flat" | "na" },
  label?: string,
  size?: "sm" | "md",
}) {
  const { pct, sign } = delta;
  const tone =
    sign === "up" ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
      : sign === "down" ? "text-rose-600 dark:text-rose-400 bg-rose-500/10"
        : sign === "flat" ? "text-muted-foreground bg-foreground/[0.06]"
          : "text-muted-foreground bg-foreground/[0.06]";
  const Icon = sign === "up" ? ArrowUpIcon : sign === "down" ? ArrowDownIcon : MinusIcon;
  const text = pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full font-mono tabular-nums font-medium",
      size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-[1px] text-[10px]",
      tone,
    )}>
      <Icon weight="bold" className={size === "md" ? "size-3" : "size-2.5"} aria-hidden="true" />
      {text}
      {label && <span className="ml-0.5 text-muted-foreground font-normal">{label}</span>}
    </span>
  );
}

type HeroCanvasView = "timeseries" | "pie";
type HeroCanvasLayerType = "line" | "area" | "bar";
type HeroCanvasStrokeStyle = "solid" | "dashed" | "dotted";

type HeroCanvasLayerKind = "primary" | "compare" | "annotations";

type HeroCanvasDataLayerCommon = {
  id: string,
  kind: "primary" | "compare",
  label: string,
  visible: boolean,
  color: string,
  segmented: boolean,
  /** Per-day per-category values. Outer index is the day (matches the
   * `data` array index); inner index is the category (matches
   * `segmentSeries`). Rows should sum to `point.values[layer.id]`. */
  segments?: readonly (readonly number[])[],
  /** Breakdown category definitions — `{ key, label }` tuples. Ordered to
   * match the inner index of `segments`. */
  segmentSeries?: readonly HeroBreakdownSeries[],
  /** Absolute index into `data` at which this layer's values become
   * "in progress" (incomplete and still changing). Points from this
   * index onward render with a dashed overlay so users don't panic at a
   * half-filled bucket. Applies to line and area rendering only. */
  inProgressFromIndex?: number | null,
};
type HeroCanvasLineLayer = HeroCanvasDataLayerCommon & {
  type: "line",
  strokeStyle: HeroCanvasStrokeStyle,
};
type HeroCanvasAreaLayer = HeroCanvasDataLayerCommon & {
  type: "area",
  strokeStyle: HeroCanvasStrokeStyle,
  fillOpacity: number,
};
type HeroCanvasBarLayer = HeroCanvasDataLayerCommon & {
  type: "bar",
  fillOpacity: number,
};

type HeroCanvasDataLayer =
  | HeroCanvasLineLayer
  | HeroCanvasAreaLayer
  | HeroCanvasBarLayer;

type HeroCanvasAnnotationsLayer = {
  id: string,
  kind: "annotations",
  label: string,
  visible: boolean,
  color: string,
};

type HeroCanvasLayer =
  | HeroCanvasDataLayer
  | HeroCanvasAnnotationsLayer;

type HeroCanvasLayers = readonly HeroCanvasLayer[];

const HERO_CANVAS_DEFAULT_LAYERS: HeroCanvasLayers = [
  {
    id: "signups",
    kind: "primary",
    label: "Sign-ups",
    visible: true,
    color: "#2563eb",
    segmented: false,
    type: "area",
    strokeStyle: "solid",
    fillOpacity: 0.22,
    segments: HERO_BREAKDOWN,
    segmentSeries: HERO_BREAKDOWN_SERIES,
    // Last day of the demo window is "today" — render its tail dashed.
    inProgressFromIndex: DAY_COUNT - 1,
  },
  {
    id: "previous",
    kind: "compare",
    label: "Previous period",
    visible: true,
    color: "#f59e0b",
    segmented: false,
    type: "line",
    strokeStyle: "dashed",
    segments: HERO_BREAKDOWN_PREV,
    segmentSeries: HERO_BREAKDOWN_SERIES,
    // Previous period is fully committed — no in-progress tail.
    inProgressFromIndex: null,
  },
  { id: "annotations", kind: "annotations", label: "Annotations", visible: true, color: "#f59e0b" },
];

const STROKE_DASHARRAY: Record<HeroCanvasStrokeStyle, string | undefined> = {
  solid: undefined,
  dashed: "5 4",
  dotted: "1 4",
};

const EMPTY_SERIES: readonly HeroBreakdownSeries[] = [];
const EMPTY_MATRIX: readonly (readonly number[])[] = [];

type HeroCanvasTimeseriesState = {
  view: "timeseries",
  layers: HeroCanvasLayers,
  /** Format applied to every x-axis value (ticks, tooltip header, brush
   * popup, action bar, pie window range). Defaults to `datetime / short`
   * so the x-axis renders as a date. Set to any `FormatKind` to render
   * x-values as numbers, durations, etc. */
  xFormatKind: FormatKind,
  /** Format applied to every y-axis value (ticks, tooltip rows, per-layer
   * totals, pie center, pie legend). Defaults to `short` so 1234 → "1k". */
  yFormatKind: FormatKind,
  showGrid: boolean,
  showXAxis: boolean,
  showYAxis: boolean,
  zoomRange: [number, number] | null,
  pinnedIndex: number | null,
};
type HeroCanvasPieState = {
  view: "pie",
  layers: HeroCanvasLayers,
  xFormatKind: FormatKind,
  yFormatKind: FormatKind,
};
type HeroCanvasState = HeroCanvasTimeseriesState | HeroCanvasPieState;

const HERO_CANVAS_DEFAULT_STATE: HeroCanvasState = {
  view: "timeseries",
  layers: HERO_CANVAS_DEFAULT_LAYERS,
  xFormatKind: DEFAULT_FORMAT_KIND.datetime,
  yFormatKind: DEFAULT_FORMAT_KIND.short,
  showGrid: true,
  showXAxis: true,
  showYAxis: true,
  zoomRange: null,
  pinnedIndex: null,
};

function findLayerByKind<K extends "primary">(
  layers: HeroCanvasLayers,
  kind: K,
): HeroCanvasDataLayer | undefined;
function findLayerByKind<K extends "compare">(
  layers: HeroCanvasLayers,
  kind: K,
): HeroCanvasDataLayer | undefined;
function findLayerByKind<K extends "annotations">(
  layers: HeroCanvasLayers,
  kind: K,
): HeroCanvasAnnotationsLayer | undefined;
function findLayerByKind(
  layers: HeroCanvasLayers,
  kind: HeroCanvasLayerKind,
): HeroCanvasLayer | undefined {
  return layers.find((l) => l.kind === kind);
}

function findLayerById(
  layers: HeroCanvasLayers,
  id: string,
): HeroCanvasLayer | undefined {
  return layers.find((l) => l.id === id);
}

/** Type guard for the data-layer variants (primary / compare). Useful in
 * `.map` callbacks where TypeScript's union narrowing can't peel off the
 * data-layer branch on its own — because the data layer is itself a
 * discriminated union, TS doesn't see `kind === "primary"` as eliminating
 * it from the parent union. This predicate makes the split explicit. */
function isHeroCanvasDataLayer(l: HeroCanvasLayer): l is HeroCanvasDataLayer {
  return l.kind === "primary" || l.kind === "compare";
}

/** Replace a single layer (looked up by id) with a new layer object. */
function setLayerById(
  layers: HeroCanvasLayers,
  id: string,
  next: HeroCanvasLayer,
): HeroCanvasLayers {
  return layers.map((l) => (l.id === id ? next : l));
}

/** Shallow-patch fields on a layer by id. Unlike the old typed variant,
 * the patch type is deliberately loose — callers are trusted to supply
 * only fields the layer's `kind`/`type` actually owns. Runtime validation
 * (see `validateHeroCanvasLayers`) catches bad shapes at the prop boundary
 * instead of at every patch site. */
function patchLayerById(
  layers: HeroCanvasLayers,
  id: string,
  patch: Record<string, unknown>,
): HeroCanvasLayers {
  return layers.map((l) => (l.id === id ? ({ ...l, ...patch } as HeroCanvasLayer) : l));
}

type HeroCanvasResolvedDataLayerStyle = {
  color: string,
  type: HeroCanvasLayerType,
  strokeStyle: HeroCanvasStrokeStyle,
  fillOpacity: number,
};
function resolveDataLayerStyle(
  layer: HeroCanvasDataLayer,
): HeroCanvasResolvedDataLayerStyle {
  return {
    color: layer.color,
    type: layer.type,
    // Bars have no stroke pattern — defaults to solid for the underline.
    strokeStyle: layer.type === "bar" ? "solid" : layer.strokeStyle,
    // Lines have no fill — defaults to 0 so gradient overlays sit flat.
    fillOpacity: layer.type === "line" ? 0 : layer.fillOpacity,
  };
}


const strokeStyleSchema = z.enum(["solid", "dashed", "dotted"]);

const heroBreakdownSeriesSchema = z.object({
  key: z.string(),
  label: z.string(),
});

const dataLayerCommonFields = {
  id: z.string(),
  kind: z.enum(["primary", "compare"]),
  label: z.string(),
  visible: z.boolean(),
  color: z.string(),
  segmented: z.boolean(),
  segments: z.array(z.array(z.number())).optional(),
  segmentSeries: z.array(heroBreakdownSeriesSchema).optional(),
  inProgressFromIndex: z.number().int().nullable().optional(),
};

const heroCanvasDataLayerSchema = z.discriminatedUnion("type", [
  z.object({
    ...dataLayerCommonFields,
    type: z.literal("line"),
    strokeStyle: strokeStyleSchema,
  }),
  z.object({
    ...dataLayerCommonFields,
    type: z.literal("area"),
    strokeStyle: strokeStyleSchema,
    fillOpacity: z.number(),
  }),
  z.object({
    ...dataLayerCommonFields,
    type: z.literal("bar"),
    fillOpacity: z.number(),
  }),
]);

const heroCanvasAnnotationsLayerSchema = z.object({
  id: z.string(),
  kind: z.literal("annotations"),
  label: z.string(),
  visible: z.boolean(),
  color: z.string(),
});

const heroCanvasLayerSchema = z.union([
  heroCanvasDataLayerSchema,
  heroCanvasAnnotationsLayerSchema,
]);

const heroCanvasLayersSchema = z.array(heroCanvasLayerSchema);

export type HeroCanvasValidationWarning = {
  code: "shape" | "count" | "duplicate-id",
  message: string,
};

/** Validate a layer array against the HeroCanvas shape + semantic
 * constraints. Returns the validated array. Behavior on failure is
 * governed by `ignoreInvalidConfig`:
 *
 *  - `false` (default): any error throws immediately.
 *  - `true`: warnings are logged via `onWarning` (default: `console.warn`)
 *    and the function returns either the (shape-valid) input layers or
 *    `HERO_CANVAS_DEFAULT_LAYERS` if the shape is broken beyond repair.
 */
function validateHeroCanvasLayers(
  input: unknown,
  opts?: {
    ignoreInvalidConfig?: boolean,
    onWarning?: (warning: HeroCanvasValidationWarning) => void,
  },
): HeroCanvasLayers {
  const ignore = opts?.ignoreInvalidConfig ?? false;
  const warn = opts?.onWarning ?? ((w) => console.warn(`[HeroChart] ${w.code}: ${w.message}`));

  // Shape validation — a hard failure here means we can't even read the
  // data, so fall back to defaults in ignore mode.
  const parsed = heroCanvasLayersSchema.safeParse(input);
  if (!parsed.success) {
    const message = `invalid layer shape — ${parsed.error.issues.map((i) => i.message).join("; ")}`;
    if (!ignore) throw new Error(`[HeroChart] ${message}`);
    warn({ code: "shape", message });
    return HERO_CANVAS_DEFAULT_LAYERS;
  }
  const layers = parsed.data;

  // Semantic validation — counts + uniqueness. These are non-fatal in
  // ignore mode (the array still renders, just with a warning).
  const errors: HeroCanvasValidationWarning[] = [];
  const primaries = layers.filter((l) => l.kind === "primary");
  const compares = layers.filter((l) => l.kind === "compare");
  const annotationList = layers.filter((l) => l.kind === "annotations");
  if (primaries.length !== 1) {
    errors.push({
      code: "count",
      message: `expected exactly 1 layer with kind="primary", got ${primaries.length}`,
    });
  }
  if (compares.length > 1) {
    errors.push({
      code: "count",
      message: `expected ≤1 layer with kind="compare", got ${compares.length}`,
    });
  }
  if (annotationList.length > 1) {
    errors.push({
      code: "count",
      message: `expected ≤1 layer with kind="annotations", got ${annotationList.length}`,
    });
  }
  const ids = layers.map((l) => l.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    errors.push({
      code: "duplicate-id",
      message: `duplicate layer ids: ${[...new Set(dupes)].join(", ")}`,
    });
  }

  if (errors.length > 0) {
    if (!ignore) {
      throw new Error(`[HeroChart] ${errors.map((e) => e.message).join("; ")}`);
    }
    errors.forEach(warn);
  }
  return layers;
}

/** Type guard for the `timeseries` state variant. Used at the top of
 * HeroChart / HeroCanvas so the rest of the function body can freely
 * read `state.showGrid` etc. when true. */
function isTimeseriesState(
  state: HeroCanvasState,
): state is HeroCanvasTimeseriesState {
  return state.view === "timeseries";
}

function useControllableState<T>(config: {
  prop: T | undefined,
  defaultProp: T,
  onChange?: (value: T) => void,
}): [T, (next: T | ((prev: T) => T)) => void] {
  const { prop, defaultProp, onChange } = config;
  const [uncontrolled, setUncontrolled] = useState<T>(defaultProp);
  const isControlled = prop !== undefined;
  const value = isControlled ? prop : uncontrolled;

  // Refs keep the setter identity stable across renders without losing
  // access to the freshest `value` / `onChange`. This matters because
  // mouse handlers capture `setValue` and we don't want stale closures.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: T) => T)(valueRef.current)
          : next;
      if (Object.is(resolved, valueRef.current)) return;
      if (!isControlled) setUncontrolled(resolved);
      onChangeRef.current?.(resolved);
    },
    [isControlled],
  );
  return [value, setValue];
}

export type HeroChartStrings = {
  /** Reset-zoom badge in the top-right corner when `state.zoomRange` is set. */
  resetZoom: string,
  /** Header label above the timestamps in the live range-brush popup. */
  rangeLabel: string,
  /** Formatted day-count suffix used by the brush + action-bar. */
  daysShort: (days: number) => string,
  /** "Zoom in" button inside the committed-range action bar. */
  zoomIn: string,
  /** "Annotate" button inside the committed-range action bar. */
  annotate: string,
  /** Placeholder for the annotation label input. */
  annotationPlaceholder: string,
  /** `aria-label` for the annotation label input. */
  annotationLabelAria: string,
  /** Save button in the annotation form. */
  save: string,
  /** Cancel button in the annotation form. */
  cancel: string,
  /** `aria-label` for the X button that clears the committed range. */
  clearSelection: string,
  /** Pinned badge shown in the tooltip header when the tooltip is pinned. */
  pinnedBadge: string,
  /** "Δ vs prev" row label in the tooltip (both segmented and flat modes). */
  deltaVsPrev: string,
  /** Suffix appended to a layer's label in the per-layer totals section
   * (e.g. "Sign-ups" → "Sign-ups total"). */
  layerTotalSuffix: string,
  /** Hint row shown in the tooltip while it is floating (not pinned). */
  hintClickToPin: string,
  /** Hint row shown in the tooltip while it is pinned. */
  hintClickAnywhereUnpin: string,
  /** Center-stat heading shown in the pie when no segment is hovered. */
  pieTotalCenter: string,
  /** Label on the TrendPill in the pie center. */
  pieVsPrev: string,
  /** `aria-label` for the PieChart SVG. */
  pieAriaLabel: (ctx: { segmentCount: number, windowDays: number }) => string,
  /** Percentage-of-total caption shown under an active pie slice. */
  piePercentOfTotal: (pct: number) => string,
};

export const HERO_CHART_DEFAULT_STRINGS: HeroChartStrings = {
  resetZoom: "Reset zoom",
  rangeLabel: "Range",
  daysShort: (days) => `${days}d`,
  zoomIn: "Zoom in",
  annotate: "Annotate",
  annotationPlaceholder: "Label this range…",
  annotationLabelAria: "Annotation label",
  save: "Save",
  cancel: "Cancel",
  clearSelection: "Clear selection",
  pinnedBadge: "Pinned",
  deltaVsPrev: "Δ vs prev",
  layerTotalSuffix: " total",
  hintClickToPin: "Click to pin this point",
  hintClickAnywhereUnpin: "Click anywhere · Esc\u00A0to unpin",
  pieTotalCenter: "Total",
  pieVsPrev: "vs prev",
  pieAriaLabel: ({ segmentCount, windowDays }) =>
    `${segmentCount} segment share-of-total over the visible ${windowDays}-day range`,
  piePercentOfTotal: (pct) => `${(pct * 100).toFixed(1)}% of total`,
};

/** Merge a Partial<HeroChartStrings> over the defaults. Deliberately shallow
 * because every field is a primitive / flat function — no nested objects. */
function resolveHeroChartStrings(
  override: Partial<HeroChartStrings> | undefined,
): HeroChartStrings {
  if (!override) return HERO_CHART_DEFAULT_STRINGS;
  return { ...HERO_CHART_DEFAULT_STRINGS, ...override };
}


export type HeroChartDelta = {
  pct: number | null,
  sign: "up" | "down" | "flat" | "na",
};

export type HeroChartTooltipSegmentRow = {
  key: string,
  label: string,
  value: number,
  /** Light-theme color for the dot / swatch. */
  color: string,
  /** Dark-theme color for the dot / swatch. */
  colorDark: string,
};

export type HeroChartTooltipLayerView = {
  /** Stable layer id (`"signups"`, `"previous"`). */
  id: string,
  /** Consumer-provided layer label. */
  label: string,
  /** The resolved layer color (light theme). */
  color: string,
  /** Flat total for this layer at the hovered index. Always populated
   * regardless of segmentation, so consumers can render the same number
   * in either mode. */
  total: number,
  /** True iff this layer is rendered as a stacked break-down (i.e. the
   * tooltip should show per-segment rows instead of a single total). */
  segmented: boolean,
  /** Per-segment rows — empty when `segmented === false`. Order matches
   * `segmentSeries`. */
  segments: HeroChartTooltipSegmentRow[],
};

export type HeroChartTooltipContext = {
  /** Index into the visible window. */
  activeIndex: number,
  /** Raw point at `activeIndex` — convenient for `.ts` access. */
  point: Point,
  /** True when the tooltip is pinned (via click) and stable under hover. */
  isPinned: boolean,
  /** Primary layer view or null when the primary layer is hidden. */
  primary: HeroChartTooltipLayerView | null,
  /** Compare layer view or null when the compare layer is hidden. */
  compare: HeroChartTooltipLayerView | null,
  /** Flat-mode delta between primary and compare totals. Null when either
   * side is hidden. Consumers should feed this into their trend pill. */
  delta: HeroChartDelta | null,
  /** Pre-bound value formatter for y-axis values (applied with
   * `state.yFormatKind`). */
  formatValue: (v: number) => string,
  /** Pre-bound formatter for x-axis values (applied with
   * `state.xFormatKind`). Use for the tooltip header or any x-value the
   * consumer wants to render. */
  formatDate: (ts: number) => string,
  /** Resolved strings — already merged with `HERO_CHART_DEFAULT_STRINGS`. */
  strings: HeroChartStrings,
};

/** Props for the default tooltip renderer. Exposed so consumers can
 * compose on top of it (e.g. wrap with an outer title). */
export type DefaultHeroChartTooltipProps = {
  ctx: HeroChartTooltipContext,
};

export function DefaultHeroChartTooltip({ ctx }: DefaultHeroChartTooltipProps) {
  const { point, isPinned, primary, compare, delta, formatValue: fv, formatDate: fd, strings } = ctx;
  const anySegmented = (primary?.segmented ?? false) || (compare?.segmented ?? false);
  return (
    <div className="rounded-xl border border-foreground/10 bg-background/95 px-3 py-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:shadow-[0_10px_28px_rgba(0,0,0,0.55)] min-w-[180px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {fd(point.ts)}
        </span>
        {isPinned && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-300">
            <PushPinSimpleIcon weight="fill" className="size-2.5" aria-hidden="true" />
            {strings.pinnedBadge}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {/* Primary — either a single total row or a per-segment breakdown. */}
        {primary && !primary.segmented && (
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: primary.color }} />
            <span className="text-[11px] text-muted-foreground">{primary.label}</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {fv(primary.total)}
            </span>
          </div>
        )}
        {primary && primary.segmented && primary.segments.map((s) => (
          <div key={`p-${s.key}`} className="flex items-center gap-2.5">
            <span className="block size-2 rounded-full dark:hidden" style={{ backgroundColor: s.color }} />
            <span className="hidden size-2 rounded-full dark:block" style={{ backgroundColor: s.colorDark }} />
            <span className="text-[11px] text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-mono text-xs tabular-nums text-foreground">
              {fv(s.value)}
            </span>
          </div>
        ))}
        {/* Compare — independent breakdown / total row. */}
        {compare && !compare.segmented && (
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: compare.color }} />
            <span className="text-[11px] text-muted-foreground">{compare.label}</span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {fv(compare.total)}
            </span>
          </div>
        )}
        {compare && compare.segmented && compare.segments.map((s) => (
          <div key={`c-${s.key}`} className="flex items-center gap-2.5">
            <span className="block size-2 rounded-full dark:hidden" style={{ backgroundColor: s.color }} />
            <span className="hidden size-2 rounded-full dark:block" style={{ backgroundColor: s.colorDark }} />
            <span className="text-[11px] text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {fv(s.value)}
            </span>
          </div>
        ))}
      </div>
      {/* Per-layer totals — shown only when that layer is segmented, so the
          user can see the sum of the stacked bars at a glance. */}
      {anySegmented && (
        <div className="mt-2 flex flex-col gap-1 border-t border-foreground/[0.07] pt-2">
          {primary?.segmented && (
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {primary.label}{strings.layerTotalSuffix}
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                {fv(primary.total)}
              </span>
            </div>
          )}
          {compare?.segmented && (
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {compare.label}{strings.layerTotalSuffix}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {fv(compare.total)}
              </span>
            </div>
          )}
          {primary?.segmented && compare?.segmented && delta && (
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {strings.deltaVsPrev}
              </span>
              <TrendPill delta={delta} size="sm" />
            </div>
          )}
        </div>
      )}
      {!anySegmented && delta && primary && compare && (
        <div className="mt-2 flex items-center justify-between border-t border-foreground/[0.07] pt-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {strings.deltaVsPrev}
          </span>
          <TrendPill delta={delta} size="sm" />
        </div>
      )}
      {!isPinned ? (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <CursorClickIcon weight="bold" className="size-2.5" aria-hidden="true" />
          <span>{strings.hintClickToPin}</span>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <CursorClickIcon weight="bold" className="size-2.5" aria-hidden="true" />
          <span>{strings.hintClickAnywhereUnpin}</span>
        </div>
      )}
    </div>
  );
}

type HeroChartProps = {
  // Data — passed in by the consumer; the chart never mutates it.
  //
  // Segment data lives on the layer itself (`layer.segments` +
  // `layer.segmentSeries`), so each data layer carries its own breakdown
  // vocabulary. There are no sibling segment props here anymore — if a
  // consumer wants to segment the compare layer by device type while the
  // primary layer is segmented by region, that's two independent setups
  // on two layer objects.
  data: Point[],
  annotations: Annotation[],
  seriesLabel: string,
  // Fully-controlled state object + dispatch. The chart reads every config
  // and persistent-interaction slice from `state` and mutates it through
  // `onChange` (which accepts both values and updater functions, exactly
  // like React's `useState` setter).
  state: HeroCanvasState,
  onChange: React.Dispatch<React.SetStateAction<HeroCanvasState>>,
  // Fired whenever the user submits the in-chart annotation form. The
  // consumer is expected to append to its own annotations array.
  onAnnotationCreate?: (annotation: Annotation) => void,
  /** Override any user-visible copy. Deep-merges over
   * `HERO_CHART_DEFAULT_STRINGS`. */
  strings?: Partial<HeroChartStrings>,
  /** Override the segment color ramps. Each ramp is either procedural
   * (hue + sat + lightness range) or explicit (concrete color lists per
   * theme). Unspecified ramps fall back to the blue / amber defaults. */
  palette?: Partial<HeroChartPalette>,
  /** Render slot for the tooltip body. Receives a prepared context with
   * the active point, primary / compare layer views, pre-bound formatters,
   * and resolved strings. Defaults to `DefaultHeroChartTooltip` — consumers
   * can wrap it instead of reimplementing from scratch. */
   renderTooltip?: (ctx: HeroChartTooltipContext) => ReactNode,
  /** When `true`, runtime validation errors on `state.layers` become
   * warnings and the chart falls back to defaults / soldiers on instead
   * of throwing. Defaults to `false` (throw on invalid config). */
  ignoreInvalidConfig?: boolean,
  // Each piece of ephemeral interaction state is exposed as an optional
  // controlled prop + change callback. Passing `undefined` leaves the
  // chart to manage the state itself; the callback still fires so the
  // consumer can observe transitions without owning them. Passing a
  // non-`undefined` value switches that piece of state into fully
  // controlled mode (consumer owns it, chart only emits changes).
  /** Current hovered index (index into the visible data window). */
  hoverIndex?: number | null,
  /** Fires whenever the hovered index changes. */
  onHoverIndexChange?: (index: number | null) => void,
  /** The user-committed brush range (after a drag completes). */
  committedRange?: [number, number] | null,
  /** Fires whenever the committed range changes (including cleared). */
  onCommittedRangeChange?: (range: [number, number] | null) => void,
  /** Live brush preview during an active drag. `null` when no drag in
   * progress. Observation-only — the chart always owns the drag itself. */
  onBrushChange?: (brush: { start: number, end: number } | null) => void,
  /** Current annotation-form draft string, or `null` when the form is
   * closed. Controllable so consumers can open/pre-fill the form. */
  annotationDraft?: string | null,
  /** Fires whenever the annotation draft changes. */
  onAnnotationDraftChange?: (draft: string | null) => void,
  /** Recharts plot margins. Also drives overlay positioning math for
   * the crosshair, tooltip anchor, brush popup, and flag markers so
   * they line up with the actual plot area. Defaults to
   * `{ top: 16, right: 24, bottom: 8, left: 12 }`. */
  plotMargin?: { top?: number, right?: number, bottom?: number, left?: number },
  /** Y-axis reserved width in pixels. Defaults to 48. */
  yAxisWidth?: number,
  /** Fractional headroom added to the y-axis top (e.g. 0.1 = 10%).
   * Defaults to 0.1. Pass 0 to let the chart top touch the plot edge. */
  yDomainPadding?: number,
  /** Primary pie ring inner radius (pixels). Defaults to 60. */
  pieInnerRadius?: number,
  /** Primary pie ring outer radius (pixels). Defaults to 84. */
  pieOuterRadius?: number,
  /** Compare pie ring inner radius (pixels). Defaults to 36. */
  pieCompareInnerRadius?: number,
  /** Compare pie ring outer radius (pixels). Defaults to 52. */
  pieCompareOuterRadius?: number,
  /** Tailwind class list applied to the `<ChartContainer>` that wraps
   * the pie chart. Defaults to an aspect-square 220–240px box. */
  pieContainerClassName?: string,
  /** Custom number formatter. Receives the raw value and the kind to
   * format with — the same function is invoked for both x-axis values
   * (where kind = `state.xFormatKind`) and y-axis values (where kind =
   * `state.yFormatKind`). Defaults to the built-in `formatValue`, which
   * handles every variant of `FormatKind` including `datetime`. */
  valueFormatter?: (value: number, kind: FormatKind) => string,
};


function HeroChart({
  data: fullData,
  annotations: fullAnnotations,
  seriesLabel,
  state,
  onChange,
  onAnnotationCreate,
  strings: stringsOverride,
  palette: paletteOverride,
  renderTooltip,
  ignoreInvalidConfig = false,
  hoverIndex: controlledHoverIndex,
  onHoverIndexChange,
  committedRange: controlledCommittedRange,
  onCommittedRangeChange,
  onBrushChange,
  annotationDraft: controlledAnnotationDraft,
  onAnnotationDraftChange,
  plotMargin,
  yAxisWidth = 48,
  yDomainPadding = 0.1,
  pieInnerRadius = 60,
  pieOuterRadius = 84,
  pieCompareInnerRadius = 36,
  pieCompareOuterRadius = 52,
  pieContainerClassName = "aspect-square h-[220px] w-[220px] sm:h-[240px] sm:w-[240px]",
  valueFormatter,
}: HeroChartProps) {
  // Resolved plot margins + formatter.
  const resolvedPlotMargin = useMemo(
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
    () => resolveHeroChartStrings(stringsOverride),
    [stringsOverride],
  );
  const palette = useMemo(
    () => resolveHeroChartPalette(paletteOverride),
    [paletteOverride],
  );
  // Validate the layer array at the prop boundary. In strict mode (the
  // default) this throws on bad shape / count violations — the chart
  // fails loudly in dev. Consumers who explicitly opt in to
  // `ignoreInvalidConfig` get `console.warn` instead plus a graceful
  // fallback to the defaults on fatal shape errors.
  const validatedLayers = useMemo(
    () => validateHeroCanvasLayers(state.layers, { ignoreInvalidConfig }),
    [state.layers, ignoreInvalidConfig],
  );
  const renderTooltipFn = renderTooltip ?? ((ctx) => <DefaultHeroChartTooltip ctx={ctx} />);
  // Common fields live on both state variants; pie-incompatible fields
  // are sourced from a narrowed helper so the rest of the function body
  // can treat them as simple values without chasing discriminators.
  const { xFormatKind, yFormatKind } = state;
  // `layers` is sourced from `validatedLayers` rather than `state.layers`
  // directly, so every downstream lookup sees the sanitized version. In
  // strict mode the two are identical; in `ignoreInvalidConfig` mode the
  // validator may have swapped a broken shape for the default layers.
  const layers = validatedLayers;
  const timeseries = isTimeseriesState(state) ? state : null;
  const showGrid = timeseries?.showGrid ?? false;
  const showXAxis = timeseries?.showXAxis ?? false;
  const showYAxis = timeseries?.showYAxis ?? false;
  const zoomRange = timeseries?.zoomRange ?? null;
  const pinnedIndex = timeseries?.pinnedIndex ?? null;

  // Kind-based layer lookups. Each may be `undefined` — the renderer
  // falls back gracefully below, and the zod validation step at the prop
  // boundary will have already complained if a required kind is missing.
  const primaryLayer = findLayerByKind(layers, "primary");
  const compareLayer = findLayerByKind(layers, "compare");
  const annotationsLayer = findLayerByKind(layers, "annotations");
  const showPrimary = primaryLayer?.visible ?? false;
  const showCompare = compareLayer?.visible ?? false;
  const showAnnotationsLayer = annotationsLayer?.visible ?? false;

  // Resolved style objects — one uniform shape per data layer regardless
  // of variant. Variant-specific fields (strokeStyle on line/area,
  // fillOpacity on area/bar) are filled in with sensible defaults for the
  // fields the variant doesn't track. When a layer is absent we stub with
  // neutral defaults so the renderer doesn't have to `?.` every access.
  const primaryStyle: HeroCanvasResolvedDataLayerStyle = primaryLayer
    ? resolveDataLayerStyle(primaryLayer)
    : { color: "#2563eb", type: "area", strokeStyle: "solid", fillOpacity: 0 };
  const previousStyleResolved: HeroCanvasResolvedDataLayerStyle = compareLayer
    ? resolveDataLayerStyle(compareLayer)
    : { color: "#f59e0b", type: "line", strokeStyle: "dashed", fillOpacity: 0 };
  const primaryType = primaryStyle.type;
  const previousType = previousStyleResolved.type;
  const primaryColor = primaryStyle.color;
  const previousColor = previousStyleResolved.color;
  const annotationColor = annotationsLayer?.color ?? "#f59e0b";
  const primaryStroke = STROKE_DASHARRAY[primaryStyle.strokeStyle];
  const previousStroke = STROKE_DASHARRAY[previousStyleResolved.strokeStyle];
  const primaryFillOpacity = primaryStyle.fillOpacity;
  const previousFillOpacity = previousStyleResolved.fillOpacity;

  // Pie and timeseries states have different shapes; we forward the patch
  // into whichever variant is active so `state.view === "pie"` can't
  // accidentally receive a `showGrid` update.
  const setTimeseriesField = useCallback(
    <K extends keyof HeroCanvasTimeseriesState>(
      key: K,
      value: HeroCanvasTimeseriesState[K],
    ) => {
      onChange((prev) => {
        if (prev.view !== "timeseries") return prev;
        return { ...prev, [key]: value };
      });
    },
    [onChange],
  );

  // Hover, committed range, and annotation draft are all optionally
  // controlled — consumers can leave them alone (chart manages them
  // internally + callbacks fire on change) or pass a controlled value to
  // drive them from outside. Drag anchor and live brush preview remain
  // strictly internal because they only matter while a drag is in
  // progress; an `onBrushChange` callback still lets observers mirror
  // the live state if they want to.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useControllableState<number | null>({
    prop: controlledHoverIndex,
    defaultProp: null,
    onChange: onHoverIndexChange,
  });
  const [committedRange, setCommittedRange] = useControllableState<[number, number] | null>({
    prop: controlledCommittedRange,
    defaultProp: null,
    onChange: onCommittedRangeChange,
  });
  const [annotationDraft, setAnnotationDraft] = useControllableState<string | null>({
    prop: controlledAnnotationDraft,
    defaultProp: null,
    onChange: onAnnotationDraftChange,
  });
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [brushStart, setBrushStartInternal] = useState<number | null>(null);
  const [brushEnd, setBrushEndInternal] = useState<number | null>(null);
  // Wrap the brush setters so the observer callback fires on every
  // transition (including the one that clears the live brush). Keeps
  // the call sites unchanged but forwards state into `onBrushChange`.
  const onBrushChangeRef = useRef(onBrushChange);
  useEffect(() => {
    onBrushChangeRef.current = onBrushChange;
  }, [onBrushChange]);
  const setBrushStart = useCallback((next: number | null) => {
    setBrushStartInternal(next);
    if (next === null) {
      onBrushChangeRef.current?.(null);
    }
  }, []);
  const setBrushEnd = useCallback((next: number | null) => {
    setBrushEndInternal((prevEnd) => {
      if (next !== null) {
        // Read the latest `brushStart` via the state setter closure —
        // simplest way to emit `{ start, end }` without a second ref.
        setBrushStartInternal((currentStart) => {
          if (currentStart !== null) {
            onBrushChangeRef.current?.({ start: currentStart, end: next });
          }
          return currentStart;
        });
      } else if (prevEnd !== null) {
        onBrushChangeRef.current?.(null);
      }
      return next;
    });
  }, []);
  const activeIndex = pinnedIndex ?? hoverIndex;

  // Segments are now carried on the data layers themselves. Each layer
  // has its own `segmentSeries` (vocabulary) and `segments` (day × cat
  // values). We extract them here with stable empty-array fallbacks
  // (via useMemo) so the downstream hooks keyed off these don't churn
  // their caches when the layer has no segment data.
  const primarySegmentSeries = useMemo<readonly HeroBreakdownSeries[]>(
    () => primaryLayer?.segmentSeries ?? EMPTY_SERIES,
    [primaryLayer?.segmentSeries],
  );
  const compareSegmentSeries = useMemo<readonly HeroBreakdownSeries[]>(
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

  // Each layer's `segmented` flag is the on/off switch, but segment data
  // must also be present for the stacked rendering to actually happen.
  // `primarySegmented` / `compareSegmented` are the authoritative gates
  // used by chartData, chartConfig, the render blocks, and the tooltip.
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
  const anySegmented = primarySegmented || compareSegmented;

  const visibleStart = zoomRange ? zoomRange[0] : 0;
  const visibleEnd = zoomRange ? zoomRange[1] : fullData.length - 1;

  const data = useMemo(
    () => fullData.slice(visibleStart, visibleEnd + 1),
    [fullData, visibleStart, visibleEnd],
  );
  // Sliced per-layer segment matrices — exactly mirror the `data` window
  // so segment row `i` lines up with `data[i]`.
  const primarySegments = useMemo(
    () => primaryFullSegments.slice(visibleStart, visibleEnd + 1),
    [primaryFullSegments, visibleStart, visibleEnd],
  );
  const compareSegments = useMemo(
    () => compareFullSegments.slice(visibleStart, visibleEnd + 1),
    [compareFullSegments, visibleStart, visibleEnd],
  );
  // Per-day totals across every segment, per layer. Used by the tooltip
  // totals row and by `yDomainMax` to anchor the axis.
  const primarySegmentTotals = useMemo(
    () => primarySegments.map((row) => row.reduce((a, b) => a + b, 0)),
    [primarySegments],
  );
  const compareSegmentTotals = useMemo(
    () => compareSegments.map((row) => row.reduce((a, b) => a + b, 0)),
    [compareSegments],
  );

  // Explicit y-axis domain max. Covers every data-layer's flat values
  // (so toggling segmentation doesn't bounce the axis) AND each layer's
  // segmented stack totals (so a slight sum-rounding drift doesn't clip
  // the top bar). Padded by `yDomainPadding` (default 0.1 = 10% headroom).
  const yDomainMax = useMemo(() => {
    const dataLayerIds = layers.filter(isHeroCanvasDataLayer).map((l) => l.id);
    const layerMaxes = dataLayerIds.map((id) =>
      data.reduce((m, p) => Math.max(m, pointValue(p, id)), 0),
    );
    const primaryStackMax = primarySegmentTotals.reduce((m, v) => Math.max(m, v), 0);
    const compareStackMax = compareSegmentTotals.reduce((m, v) => Math.max(m, v), 0);
    const rawMax = Math.max(0, ...layerMaxes, primaryStackMax, compareStackMax);
    return Math.ceil(rawMax * (1 + yDomainPadding));
  }, [data, layers, primarySegmentTotals, compareSegmentTotals, yDomainPadding]);

  // Per-layer color ramps, sized independently so primary and compare can
  // segment by different vocabularies (e.g. primary by region, compare by
  // device type). Each ramp expands from the resolved palette.
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

  // visible window). Computed per layer because the two layers may have
  // different segment vocabularies. The pie renders an outer ring from
  // the primary layer and an inner ring from the compare layer.
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
  // Pie hover key — ephemeral hover state for the slice-isolation flow.
  const [pieHoverKey, setPieHoverKey] = useState<string | null>(null);

  // Annotations are now fully prop-driven. The chart filters them to the
  // visible window and re-bases their indices to local coordinates.
  const annotations = useMemo(() => {
    return fullAnnotations
      .filter((a) => a.index >= visibleStart && a.index <= visibleEnd)
      .map((a) => ({ ...a, index: a.index - visibleStart }));
  }, [fullAnnotations, visibleStart, visibleEnd]);

  const brushing = brushStart != null;
  const N = data.length;

  // Recharts identifies each Bar/Line/Area via a string dataKey which
  // must match a field on every chart row. We key those fields by
  // layer.id so consumers can rename `"signups"` → anything without
  // touching the renderer. Synthetic keys for the in-progress overlay
  // get a `__hero_solid` / `__hero_dashed` suffix per layer so they
  // don't collide with the layer's own id. Segment sub-keys keep their
  // own prefix.
  const primaryKey = primaryLayer?.id ?? "__hero_primary";
  const compareKey = compareLayer?.id ?? "__hero_compare";
  const primarySolidKey = `${primaryKey}__hero_solid`;
  const primaryDashedKey = `${primaryKey}__hero_dashed`;
  const compareSolidKey = `${compareKey}__hero_solid`;
  const compareDashedKey = `${compareKey}__hero_dashed`;
  const primarySegKey = useCallback(
    (segKey: string) => `${primaryKey}__hero_seg_${segKey}`,
    [primaryKey],
  );
  const compareSegKey = useCallback(
    (segKey: string) => `${compareKey}__hero_seg_${segKey}`,
    [compareKey],
  );

  // Each data layer can carry an `inProgressFromIndex` (absolute index
  // into `fullData`) marking where its values become incomplete. The
  // renderer translates that to a local index inside the visible window
  // and clamps it: `null` when the marker sits beyond the window, `0`
  // when it sits before. Combined with the layer's type/segmentation,
  // this gates the solid/dashed line pair below.
  const computeLocalInProgressIdx = (absIdx: number | null | undefined): number | null => {
    if (absIdx == null) return null;
    const local = absIdx - visibleStart;
    if (local >= visibleEnd - visibleStart + 1) return null; // beyond window
    if (local < 0) return 0; // before window — whole window is dashed
    return local;
  };
  const primaryInProgressLocalIdx = computeLocalInProgressIdx(primaryLayer?.inProgressFromIndex);
  const compareInProgressLocalIdx = computeLocalInProgressIdx(compareLayer?.inProgressFromIndex);
  // The solid/dashed split only makes sense for line + area in flat
  // mode. Segmented stacks and bars ignore the marker entirely.
  const primaryHasInProgress =
    primaryInProgressLocalIdx != null
    && !primarySegmented
    && (primaryType === "line" || primaryType === "area");
  const compareHasInProgress =
    compareInProgressLocalIdx != null
    && !compareSegmented
    && (previousType === "line" || previousType === "area");

  // Recharts wants one row per index with every dataKey as a sibling field.
  // We project the visible window into that shape, copy every consumer-
  // provided `point.values[*]` verbatim, and add synthetic keys for the
  // in-progress dashing overlay (one solid/dashed pair per layer that
  // has `inProgressFromIndex` set) and the per-segment stacked columns.
  const chartData = useMemo(() => {
    return data.map((point, i) => {
      const row: Record<string, number | string | null> = {
        index: i,
        ts: point.ts,
      };
      // Copy every layer value verbatim. Consumers can drop extra layer
      // ids in `point.values` and the chart will just include them — the
      // renderer only iterates the ones referenced by layers.
      for (const [k, v] of Object.entries(point.values)) {
        row[k] = v;
      }
      // Solid/dashed split for primary — solid covers `[0..K-1]`, dashed
      // covers `[K-1..end]`. They overlap at `K-1` so the lines join.
      // `primaryHasInProgress` already implies `primaryInProgressLocalIdx`
      // is non-null, so a non-null assertion here is safe.
      if (primaryLayer && primaryHasInProgress) {
        const primaryVal = pointValue(point, primaryLayer.id);
        const k = primaryInProgressLocalIdx as number;
        row[primarySolidKey] = i < k ? primaryVal : null;
        row[primaryDashedKey] = i >= k - 1 ? primaryVal : null;
      }
      // Same treatment for compare.
      if (compareLayer && compareHasInProgress) {
        const compareVal = pointValue(point, compareLayer.id);
        const k = compareInProgressLocalIdx as number;
        row[compareSolidKey] = i < k ? compareVal : null;
        row[compareDashedKey] = i >= k - 1 ? compareVal : null;
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

  // Each dataKey gets a label + color so the shadcn `ChartContainer` injects
  // matching `--color-${key}` CSS variables we reference from `<Bar>` /
  // `<Line>` / `<Area>` fills below. Tooltips and legends pick up the same
  // mapping for free. Keys mirror the ones we emit in chartData above.
  const chartConfig = useMemo<ChartConfig>(() => {
    const primaryLabel = primaryLayer?.label ?? seriesLabel;
    const compareLabel = compareLayer?.label ?? "";
    const config: ChartConfig = {};
    if (primaryLayer) {
      config[primaryLayer.id] = { label: primaryLabel, color: primaryColor };
      if (primaryHasInProgress) {
        config[primarySolidKey] = { label: primaryLabel, color: primaryColor };
        config[primaryDashedKey] = { label: primaryLabel, color: primaryColor };
      }
    }
    if (compareLayer) {
      config[compareLayer.id] = { label: compareLabel, color: previousColor };
      if (compareHasInProgress) {
        config[compareSolidKey] = { label: compareLabel, color: previousColor };
        config[compareDashedKey] = { label: compareLabel, color: previousColor };
      }
    }
    if (primarySegmented) {
      primarySegmentSeries.forEach((s, i) => {
        config[primarySegKey(s.key)] = {
          label: s.label,
          color: segmentColors.primary.light[i],
        };
      });
    }
    if (compareSegmented) {
      compareSegmentSeries.forEach((s, i) => {
        config[compareSegKey(s.key)] = {
          label: s.label,
          color: segmentColors.compare.light[i],
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
    seriesLabel,
    primaryColor,
    previousColor,
    primaryHasInProgress,
    compareHasInProgress,
    primarySegmented,
    compareSegmented,
    primarySegmentSeries,
    compareSegmentSeries,
    segmentColors,
  ]);

  // Recharts ComposedChart's mouse callbacks pass a state object with
  // `activeTooltipIndex` — that's the data index the cursor is currently
  // hovering. We mirror it into our own hover/brush/pin state so the rest
  // of the chart's interaction logic stays the same as before.
  type RechartsMouseState = {
    activeTooltipIndex?: number,
    isTooltipActive?: boolean,
  };
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
    [dragAnchor, brushStart, setHoverIndex, setBrushStart, setBrushEnd],
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
    [setAnnotationDraft],
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
      setBrushStart,
      setBrushEnd,
      setCommittedRange,
    ],
  );
  const handleChartMouseLeave = useCallback(() => {
    if (!brushing) setHoverIndex(null);
  }, [brushing, setHoverIndex]);

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
    [N, hoverIndex, pinnedIndex, setTimeseriesField, setHoverIndex],
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

  // Recharts handles the actual chart layout; for our absolute-positioned
  // overlays (tooltip, brush popup, action bar, annotation flags) we
  // compute the screen position from the data index and the chart's
  // known left/right margins. Returns a CSS `calc()` string that aligns
  // the overlay with the corresponding data point. Uses the resolved
  // `plotMargin` so a consumer overriding the margin automatically gets
  // matching overlay alignment.
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
  // Delta between the primary and compare layer values at the hovered
  // point — drives the outer trend pill and is included in the tooltip
  // context. Null when either layer is missing or hidden.
  const activeDelta = activePoint && primaryLayer && compareLayer
    ? formatDelta(
      pointValue(activePoint, primaryLayer.id),
      pointValue(activePoint, compareLayer.id),
    )
    : null;

  // Routes to PieBody when state.view is "pie". Aggregates the visible
  // window by segment and renders a hover-to-isolate pie, optionally
  // paired with an inner ring showing the previous-period totals when the
  // previous layer is visible.
  if (state.view === "pie") {
    return (
      <PieBody
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
        innerRadius={pieInnerRadius}
        outerRadius={pieOuterRadius}
        compareInnerRadius={pieCompareInnerRadius}
        compareOuterRadius={pieCompareOuterRadius}
        containerClassName={pieContainerClassName}
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
        // Stop propagation so outside-click listener doesn't instantly unpin
        e.stopPropagation();
      }}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        if (hoverIndex == null) setHoverIndex(pinnedIndex ?? Math.floor(N / 2));
      }}
      tabIndex={0}
      role="img"
      aria-label={`${seriesLabel} over the visible ${data.length}-day range. Use arrow keys to move the cursor, Enter to pin, Escape to release. Click and drag to select a range.`}
    >
      <ChartContainer
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

          {/* annotations as reference lines (vertical dashed) */}
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

          {/* committed range — stays after the drag is released */}
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

          {/* live brush preview */}
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

          {/* Stacks the signups layer by segment using whichever chart
              type the layer is configured for. Each stack gets its own
              stackId so it stays independent from the previous-layer
              segmented stack below. */}
          {primarySegmented
            && primaryType === "bar"
            && primarySegmentSeries.map((s, sIdx) => {
              // Recharts stacks bars in DOM order — the last declared bar
              // sits on top of the stack, so only it gets rounded top
              // corners. Matches the `radius={2}` on the flat-mode bar.
              const isTop = sIdx === primarySegmentSeries.length - 1;
              const key = primarySegKey(s.key);
              return (
                <Bar
                  key={s.key}
                  dataKey={key}
                  stackId="primary-segments"
                  fill={`var(--color-${key})`}
                  radius={isTop ? [2, 2, 0, 0] : 0}
                  isAnimationActive={false}
                />
              );
            })}
          {primarySegmented
            && primaryType === "area"
            && primarySegmentSeries.map((s) => {
              const key = primarySegKey(s.key);
              return (
                <Area
                  key={s.key}
                  dataKey={key}
                  stackId="primary-segments"
                  type="linear"
                  fill={`var(--color-${key})`}
                  fillOpacity={0.78}
                  stroke={`var(--color-${key})`}
                  strokeWidth={0.75}
                  isAnimationActive={false}
                />
              );
            })}
          {primarySegmented
            && primaryType === "line"
            && primarySegmentSeries.map((s) => {
              const key = primarySegKey(s.key);
              return (
                <Line
                  key={s.key}
                  dataKey={key}
                  type="linear"
                  stroke={`var(--color-${key})`}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              );
            })}

          {showPrimary && primaryLayer && !primarySegmented && primaryType === "bar" && (
            <Bar
              dataKey={primaryLayer.id}
              fill={`var(--color-${primaryLayer.id})`}
              radius={2}
              isAnimationActive={false}
            />
          )}
          {showPrimary && primaryLayer && !primarySegmented && primaryType === "area" && (
            <Area
              dataKey={primaryLayer.id}
              type="linear"
              fill={`var(--color-${primaryLayer.id})`}
              fillOpacity={primaryFillOpacity}
              stroke="none"
              isAnimationActive={false}
            />
          )}
          {showPrimary
            && primaryLayer
            && !primarySegmented
            && (primaryType === "line" || primaryType === "area")
            && (primaryHasInProgress
              ? (
                <>
                  <Line
                    dataKey={primarySolidKey}
                    type="linear"
                    stroke={`var(--color-${primaryLayer.id})`}
                    strokeWidth={2}
                    strokeDasharray={primaryStroke}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    dataKey={primaryDashedKey}
                    type="linear"
                    stroke={`var(--color-${primaryLayer.id})`}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    opacity={0.85}
                  />
                </>
              )
              : (
                <Line
                  dataKey={primaryLayer.id}
                  type="linear"
                  stroke={`var(--color-${primaryLayer.id})`}
                  strokeWidth={2}
                  strokeDasharray={primaryStroke}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}

          {/* Mirrors the primary-segmented block above but uses the
              compare palette (amber shades) and its own stackId so it
              doesn't stack on top of the primary segments. */}
          {compareSegmented
            && previousType === "bar"
            && compareSegmentSeries.map((s, sIdx) => {
              const isTop = sIdx === compareSegmentSeries.length - 1;
              const key = compareSegKey(s.key);
              return (
                <Bar
                  key={`prev-${s.key}`}
                  dataKey={key}
                  stackId="compare-segments"
                  fill={`var(--color-${key})`}
                  radius={isTop ? [2, 2, 0, 0] : 0}
                  isAnimationActive={false}
                  opacity={0.9}
                />
              );
            })}
          {compareSegmented
            && previousType === "area"
            && compareSegmentSeries.map((s) => {
              const key = compareSegKey(s.key);
              return (
                <Area
                  key={`prev-${s.key}`}
                  dataKey={key}
                  stackId="compare-segments"
                  type="linear"
                  fill={`var(--color-${key})`}
                  fillOpacity={0.6}
                  stroke={`var(--color-${key})`}
                  strokeWidth={0.75}
                  strokeDasharray={previousStroke}
                  isAnimationActive={false}
                />
              );
            })}
          {compareSegmented
            && previousType === "line"
            && compareSegmentSeries.map((s) => {
              const key = compareSegKey(s.key);
              return (
                <Line
                  key={`prev-${s.key}`}
                  dataKey={key}
                  type="linear"
                  stroke={`var(--color-${key})`}
                  strokeWidth={1.5}
                  strokeDasharray={previousStroke}
                  dot={false}
                  isAnimationActive={false}
                />
              );
            })}

          {showCompare && compareLayer && !compareSegmented && previousType === "bar" && (
            <Bar
              dataKey={compareLayer.id}
              fill={`var(--color-${compareLayer.id})`}
              radius={2}
              isAnimationActive={false}
            />
          )}
          {showCompare
            && compareLayer
            && !compareSegmented
            && previousType === "area"
            && (compareHasInProgress
              ? (
                <>
                  <Area
                    dataKey={compareSolidKey}
                    type="linear"
                    fill={`var(--color-${compareLayer.id})`}
                    fillOpacity={previousFillOpacity}
                    stroke={`var(--color-${compareLayer.id})`}
                    strokeWidth={1.5}
                    strokeDasharray={previousStroke}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Area
                    dataKey={compareDashedKey}
                    type="linear"
                    fill={`var(--color-${compareLayer.id})`}
                    fillOpacity={previousFillOpacity * 0.6}
                    stroke={`var(--color-${compareLayer.id})`}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    isAnimationActive={false}
                    connectNulls
                    opacity={0.85}
                  />
                </>
              )
              : (
                <Area
                  dataKey={compareLayer.id}
                  type="linear"
                  fill={`var(--color-${compareLayer.id})`}
                  fillOpacity={previousFillOpacity}
                  stroke={`var(--color-${compareLayer.id})`}
                  strokeWidth={1.5}
                  strokeDasharray={previousStroke}
                  isAnimationActive={false}
                />
              ))}
          {showCompare
            && compareLayer
            && !compareSegmented
            && previousType === "line"
            && (compareHasInProgress
              ? (
                <>
                  <Line
                    dataKey={compareSolidKey}
                    type="linear"
                    stroke={`var(--color-${compareLayer.id})`}
                    strokeWidth={1.5}
                    strokeDasharray={previousStroke}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    dataKey={compareDashedKey}
                    type="linear"
                    stroke={`var(--color-${compareLayer.id})`}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    opacity={0.85}
                  />
                </>
              )
              : (
                <Line
                  dataKey={compareLayer.id}
                  type="linear"
                  stroke={`var(--color-${compareLayer.id})`}
                  strokeWidth={1.5}
                  strokeDasharray={previousStroke}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
        </ComposedChart>
      </ChartContainer>

      {/* Crosshair line + active dots — rendered as an absolute overlay so
          we don't have to reach into Recharts' coordinate system. The
          horizontal position is derived from the active index relative to
          the visible window. */}
      {activeIndex != null && activePoint && !brushing && (
        <div
          className="pointer-events-none absolute inset-y-0 z-10"
          style={{
            left: `calc(12px + (100% - 36px) * ${tooltipXPct / 100})`,
            width: 0,
          }}
        >
          <div className="absolute inset-y-4 left-0 w-px border-l border-dashed border-foreground/30" />
        </div>
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
        // Centered percentage within the visible window — used only to
        // pick an edge to snap to when the range is too close to clip.
        const centerPct = N <= 1 ? 50 : (center / (N - 1)) * 100;
        const snapLeft = centerPct < 22;
        const snapRight = centerPct > 78;
        // Keep the bar inside the chart box; snap to an edge when the range
        // is too close to it to be centered without overflow.
        const anchorStyle: React.CSSProperties = snapLeft
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
                      label: label.length > 5 ? label.slice(0, 5) : label,
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
                    // eslint-disable-next-line jsx-a11y/no-autofocus
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

      {/* Positioning lives on this wrapper; the body is rendered through
          the `renderTooltip` slot (defaults to `DefaultHeroChartTooltip`).
          Context is built once per render so custom renderers don't have
          to recompute segmented totals / delta / etc. themselves. */}
      {activeIndex != null && activePoint && (() => {
        // Build primary layer view.
        const primaryView: HeroChartTooltipLayerView | null = (showPrimary && primaryLayer)
          ? {
            id: primaryLayer.id,
            label: primaryLayer.label || seriesLabel,
            color: primaryColor,
            total: primarySegmented
              ? (primarySegmentTotals[activeIndex] ?? 0)
              : pointValue(activePoint, primaryLayer.id),
            segmented: primarySegmented,
            segments: primarySegmented
              ? primarySegmentSeries.map((s, sIdx) => ({
                key: s.key,
                label: s.label,
                value: primarySegments[activeIndex]?.[sIdx] ?? 0,
                color: segmentColors.primary.light[sIdx] ?? primaryColor,
                colorDark: segmentColors.primary.dark[sIdx] ?? primaryColor,
              }))
              : [],
          }
          : null;
        // Build compare layer view.
        const compareView: HeroChartTooltipLayerView | null = (showCompare && compareLayer)
          ? {
            id: compareLayer.id,
            label: compareLayer.label,
            color: previousColor,
            total: compareSegmented
              ? (compareSegmentTotals[activeIndex] ?? 0)
              : pointValue(activePoint, compareLayer.id),
            segmented: compareSegmented,
            segments: compareSegmented
              ? compareSegmentSeries.map((s, sIdx) => ({
                key: s.key,
                label: s.label,
                value: compareSegments[activeIndex]?.[sIdx] ?? 0,
                color: segmentColors.compare.light[sIdx] ?? previousColor,
                colorDark: segmentColors.compare.dark[sIdx] ?? previousColor,
              }))
              : [],
          }
          : null;
        // Delta is between the final rendered totals — works regardless of
        // segmented-vs-flat mode on either side.
        const delta: HeroChartDelta | null = primaryView && compareView
          ? formatDelta(primaryView.total, compareView.total)
          : null;
        const ctx: HeroChartTooltipContext = {
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


type PieBodyProps = {
  wrapperRef: React.RefObject<HTMLDivElement>,
  /** Primary layer breakdown vocabulary. */
  primarySegmentSeries: readonly HeroBreakdownSeries[],
  /** Compare layer breakdown vocabulary — may differ from primary's. */
  compareSegmentSeries: readonly HeroBreakdownSeries[],
  /** Per-segment totals for the primary layer over the visible window.
   * Indexed to match `primarySegmentSeries`. */
  aggregatedPrimarySegments: number[],
  /** Per-segment totals for the compare layer over the visible window.
   * Indexed to match `compareSegmentSeries`. */
  aggregatedCompareSegments: number[],
  aggregatedPrimaryTotal: number,
  aggregatedCompareTotal: number,
  segmentColors: {
    primary: { light: string[], dark: string[] },
    compare: { light: string[], dark: string[] },
  },
  showPrimary: boolean,
  showCompare: boolean,
  xFormatKind: FormatKind,
  yFormatKind: FormatKind,
  hoverKey: string | null,
  setHoverKey: (k: string | null) => void,
  zoomRange: [number, number] | null,
  onResetZoom: () => void,
  visibleStart: number,
  visibleEnd: number,
  fullData: Point[],
  strings: HeroChartStrings,
  fmtValue: (value: number, kind: FormatKind) => string,
  innerRadius: number,
  outerRadius: number,
  compareInnerRadius: number,
  compareOuterRadius: number,
  containerClassName: string,
};

function PieBody({
  wrapperRef,
  primarySegmentSeries,
  compareSegmentSeries,
  aggregatedPrimarySegments,
  aggregatedCompareSegments,
  aggregatedPrimaryTotal,
  aggregatedCompareTotal,
  segmentColors,
  showPrimary,
  showCompare,
  xFormatKind,
  yFormatKind,
  hoverKey,
  setHoverKey,
  zoomRange,
  onResetZoom,
  visibleStart,
  visibleEnd,
  fullData,
  strings,
  fmtValue,
  innerRadius,
  outerRadius,
  compareInnerRadius,
  compareOuterRadius,
  containerClassName,
}: PieBodyProps) {
  // The legend uses the primary layer's vocabulary when the primary layer
  // is segmented; if not, it falls back to the compare layer's. This
  // means the legend always reflects "the layer driving the chart". If
  // both primary and compare have the SAME segment keys (the common
  // case), the compare value for a given key is pulled by key lookup;
  // if they differ, the compare ring still renders independently but
  // its slices may not perfectly align with the legend rows.
  const canonicalSeries = primarySegmentSeries.length > 0
    ? primarySegmentSeries
    : compareSegmentSeries;
  const usePrimaryForCanonical = primarySegmentSeries.length > 0;

  // Key → value lookup tables so the legend can show cross-layer values
  // even when the two series use the same keys.
  const compareValueByKey = useMemo(() => {
    const m = new Map<string, number>();
    compareSegmentSeries.forEach((s, sIdx) => {
      m.set(s.key, aggregatedCompareSegments[sIdx] ?? 0);
    });
    return m;
  }, [compareSegmentSeries, aggregatedCompareSegments]);
  const primaryValueByKey = useMemo(() => {
    const m = new Map<string, number>();
    primarySegmentSeries.forEach((s, sIdx) => {
      m.set(s.key, aggregatedPrimarySegments[sIdx] ?? 0);
    });
    return m;
  }, [primarySegmentSeries, aggregatedPrimarySegments]);

  // Canonical total — matches whichever series is driving the legend.
  const canonicalTotal = usePrimaryForCanonical
    ? aggregatedPrimaryTotal
    : aggregatedCompareTotal;

  // Sorted-by-value listing for the legend column. Each row carries its
  // own canonical value (for the sort + primary ring) and a cross-layer
  // value (for the compare ring + delta pill).
  const legendRows = useMemo(
    () =>
      canonicalSeries
        .map((s, sIdx) => {
          const value = usePrimaryForCanonical
            ? (aggregatedPrimarySegments[sIdx] ?? 0)
            : (aggregatedCompareSegments[sIdx] ?? 0);
          const prevValue = usePrimaryForCanonical
            ? (compareValueByKey.get(s.key) ?? 0)
            : (primaryValueByKey.get(s.key) ?? 0);
          return {
            key: s.key,
            label: s.label,
            sIdx,
            value,
            prevValue,
            pct: canonicalTotal > 0 ? value / canonicalTotal : 0,
            fill: segmentColors.primary.light[sIdx] ?? "#888",
            fillDark: segmentColors.primary.dark[sIdx] ?? "#888",
            fillCompare: segmentColors.compare.light[sIdx] ?? "#888",
            fillCompareDark: segmentColors.compare.dark[sIdx] ?? "#888",
          };
        })
        .sort((a, b) => b.value - a.value),
    [
      canonicalSeries,
      usePrimaryForCanonical,
      aggregatedPrimarySegments,
      aggregatedCompareSegments,
      compareValueByKey,
      primaryValueByKey,
      canonicalTotal,
      segmentColors,
    ],
  );

  // ChartConfig keyed by segment id so the shadcn ChartContainer injects
  // matching --color-${id} CSS variables for tooltips and legend rows.
  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    canonicalSeries.forEach((s, sIdx) => {
      config[s.key] = {
        label: s.label,
        color: segmentColors.primary.light[sIdx],
      };
    });
    return config;
  }, [canonicalSeries, segmentColors]);

  // The currently isolated row (if any) — drives the center stat + dim state.
  const activeRow = hoverKey
    ? legendRows.find((r) => r.key === hoverKey) ?? null
    : null;
  const activeDelta = activeRow
    ? formatDelta(activeRow.value, activeRow.prevValue)
    : formatDelta(aggregatedPrimaryTotal, aggregatedCompareTotal);

  const windowDays = visibleEnd - visibleStart + 1;
  const startLabel = fmtValue(fullData[visibleStart]!.ts, xFormatKind);
  const endLabel = fmtValue(fullData[visibleEnd]!.ts, xFormatKind);

  // Pie data uses the same row order as the legend so the slice ↔ legend
  // mapping is stable and we can drive `activeIndex` from the hovered key.
  const outerData = legendRows.map((r) => ({ name: r.key, value: r.value, fill: r.fill }));
  const innerData = legendRows.map((r) => ({ name: r.key, value: r.prevValue, fill: r.fillCompare }));
  const activeIdx = hoverKey ? legendRows.findIndex((r) => r.key === hoverKey) : -1;

  return (
    <div
      ref={wrapperRef}
      className="relative w-full select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Reset-zoom badge — same affordance as the time-series body so the
          pie always reflects the visible window the user has chosen. */}
      {zoomRange && (
        <div className="absolute right-2 top-2 z-20">
          <button
            type="button"
            onClick={onResetZoom}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-blue-600 ring-1 ring-blue-500/30 transition-colors duration-150 hover:bg-blue-500/15 hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 dark:text-blue-300 dark:ring-blue-400/30"
          >
            <MagnifyingGlassMinusIcon weight="bold" className="size-3" aria-hidden="true" />
            <span>{strings.resetZoom}</span>
          </button>
        </div>
      )}

      <div className="flex min-h-[260px] flex-col items-center gap-6 sm:min-h-[320px] sm:flex-row sm:items-center sm:justify-center sm:gap-10">
        {/* The pie SVG and its absolutely-positioned center stat live
            inside `.relative`. The date-range + trend-pill caption sits
            OUTSIDE the ring so the center stat only has to fit the
            label + big value + (optional) percent — no more clipping
            when the compare ring shrinks the available inner area. */}
        <div className="flex shrink-0 flex-col items-center gap-3">
          <div className="relative">
            <ChartContainer
              config={chartConfig}
              className={containerClassName}
            >
              <PieChart
                role="img"
                aria-label={strings.pieAriaLabel({
                  segmentCount: canonicalSeries.length,
                  windowDays,
                })}
              >
                {showPrimary && (
                  <Pie
                    data={outerData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={innerRadius}
                    outerRadius={outerRadius}
                    paddingAngle={1}
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={false}
                    stroke="none"
                  >
                    {outerData.map((d, i) => {
                      const inactive = activeIdx >= 0 && activeIdx !== i;
                      return (
                        <Cell
                          key={`outer-${d.name}`}
                          fill={d.fill}
                          opacity={inactive ? 0.22 : 1}
                          onMouseEnter={() => setHoverKey(d.name as string)}
                          onMouseLeave={() => setHoverKey(null)}
                        />
                      );
                    })}
                  </Pie>
                )}
                {showCompare && (
                  <Pie
                    data={innerData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={compareInnerRadius}
                    outerRadius={compareOuterRadius}
                    paddingAngle={1}
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={false}
                    stroke="none"
                  >
                    {innerData.map((d, i) => {
                      const inactive = activeIdx >= 0 && activeIdx !== i;
                      return (
                        <Cell
                          key={`inner-${d.name}`}
                          fill={d.fill}
                          opacity={inactive ? 0.22 : 0.95}
                          onMouseEnter={() => setHoverKey(d.name as string)}
                          onMouseLeave={() => setHoverKey(null)}
                        />
                      );
                    })}
                  </Pie>
                )}
              </PieChart>
            </ChartContainer>

            {/* Center stat — strictly label + big value. Nothing else.
              The compare ring (compareInnerRadius=36) leaves only ~72px
              of clean vertical space in the center; any third row bleeds
              into the ring. Per-segment % is already in the legend and
              the date range + trend pill live in the caption row below. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="block max-w-[68px] truncate font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {activeRow ? activeRow.label : strings.pieTotalCenter}
              </span>
              <span className="mt-0.5 block max-w-[72px] truncate font-mono text-xl font-semibold leading-none tabular-nums text-foreground">
                {fmtValue(
                  activeRow ? activeRow.value : canonicalTotal,
                  yFormatKind,
                )}
              </span>
            </div>
          </div>

          {/* Caption row below the pie — date range + (optional) trend
            pill. Lives outside the ring so the center stat never has
            to compete for space. */}
          <div className="flex items-center gap-2 text-center">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {startLabel} – {endLabel}
            </span>
            {showCompare && (
              <TrendPill delta={activeDelta} size="sm" label={strings.pieVsPrev} />
            )}
          </div>
        </div>

        {/* Column widths use `min-w-*` rather than `w-*` so long values
            (large numbers, 4-digit percentages like "+123.4%") can grow
            past their baseline allotment instead of clipping. The label
            column is flex-grow + truncate so it's the only one that
            gives ground when space gets tight. */}
        <ul className="flex w-full max-w-[380px] flex-col gap-1">
          {legendRows.map((r) => {
            const isActive = hoverKey === r.key;
            const dimmed = hoverKey != null && !isActive;
            const rowDelta = formatDelta(r.value, r.prevValue);
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onMouseEnter={() => setHoverKey(r.key)}
                  onMouseLeave={() => setHoverKey(null)}
                  onFocus={() => setHoverKey(r.key)}
                  onBlur={() => setHoverKey(null)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-[background-color,opacity] duration-150 hover:bg-foreground/[0.04] hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20",
                    isActive && "bg-foreground/[0.05]",
                    dimmed && "opacity-50",
                  )}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-[3px] dark:hidden"
                    style={{ backgroundColor: segmentColors.primary.light[r.sIdx] }}
                  />
                  <span
                    className="hidden size-2.5 shrink-0 rounded-[3px] dark:block"
                    style={{ backgroundColor: segmentColors.primary.dark[r.sIdx] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                    {r.label}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {(r.pct * 100).toFixed(1)}%
                  </span>
                  <span className="shrink-0 min-w-[48px] text-right font-mono text-[11px] font-semibold tabular-nums text-foreground">
                    {fmtValue(r.value, yFormatKind)}
                  </span>
                  {showCompare && (
                    <span className="shrink-0">
                      <TrendPill delta={rowDelta} size="sm" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// HeroChart — gives you the DesignAnalyticsCard surface, an optional
// title/subtitle row, and forwards the controlled `state` / `onChange`
// pair through to the chart. Everything else is configured via props.
// HeroCanvas does NOT render any inline configuration UI of its own.
// There used to be a `controls` prop that opted into header pills
// (display type / segments / compare / format), legend dots, axis icon
// toggles, and a help-text row — those are gone. The chart's behaviour
// is fully driven by `state` and the prop surface; consumers who want a
// pill bar, legend, or axis toggles render their own UI and dispatch
// into `onChange` themselves. Keeps the chart focused on the data
// presentation and stops two parallel UIs (the chart's pills + the
// consumer's pills) from drifting out of sync.

type HeroCanvasProps = {
  /** Time-series points — each point carries `values` keyed by layer id. */
  data: Point[],
  /** Annotations are fully prop-driven. The consumer owns the array. */
  annotations?: Annotation[],
  /** Label used when the primary layer doesn't supply one of its own. */
  seriesLabel?: string,
  /** Optional title / subtitle shown above the chart. Pure visual
   * chrome — no interactive controls. Pass `null` to omit entirely. */
  title?: ReactNode,
  subtitle?: ReactNode,
  /** Fully-controlled state. The component owns nothing. */
  state: HeroCanvasState,
  onChange: React.Dispatch<React.SetStateAction<HeroCanvasState>>,
  /** Fired when the user submits the in-chart annotation form.
      Consumer is expected to append to its own annotations array. */
  onAnnotationCreate?: (annotation: Annotation) => void,
  gradient?: "blue" | "cyan" | "green" | "orange" | "purple",
  /** Override any user-visible copy inside the chart body (tooltip hints,
   * Reset zoom, Annotate/Save/Cancel, pie center, …). Deep-merges over
   * `HERO_CHART_DEFAULT_STRINGS`. */
  strings?: Partial<HeroChartStrings>,
  /** Override the segment color ramps. Deep-merges over
   * `HERO_CHART_DEFAULT_PALETTE`. */
  palette?: Partial<HeroChartPalette>,
  /** Render slot for the tooltip body. Receives a prepared context with
   * the active point, primary / compare views, pre-bound formatters,
   * and resolved strings. Defaults to `DefaultHeroChartTooltip`. */
  renderTooltip?: (ctx: HeroChartTooltipContext) => ReactNode,
  /** When `true`, runtime validation errors on `state.layers` become
   * warnings instead of throwing. Forwarded to the inner HeroChart. */
  ignoreInvalidConfig?: boolean,
  hoverIndex?: number | null,
  onHoverIndexChange?: (index: number | null) => void,
  committedRange?: [number, number] | null,
  onCommittedRangeChange?: (range: [number, number] | null) => void,
  onBrushChange?: (brush: { start: number, end: number } | null) => void,
  annotationDraft?: string | null,
  onAnnotationDraftChange?: (draft: string | null) => void,
  plotMargin?: { top?: number, right?: number, bottom?: number, left?: number },
  yAxisWidth?: number,
  yDomainPadding?: number,
  pieInnerRadius?: number,
  pieOuterRadius?: number,
  pieCompareInnerRadius?: number,
  pieCompareOuterRadius?: number,
  pieContainerClassName?: string,
  valueFormatter?: (value: number, kind: FormatKind) => string,
};

function HeroCanvas({
  data,
  annotations = [],
  seriesLabel = "Sign-ups",
  title = "Sign-ups",
  subtitle = "30-day window",
  state,
  onChange,
  onAnnotationCreate,
  gradient = "blue",
  strings,
  palette,
  renderTooltip,
  ignoreInvalidConfig = false,
  hoverIndex,
  onHoverIndexChange,
  committedRange,
  onCommittedRangeChange,
  onBrushChange,
  annotationDraft,
  onAnnotationDraftChange,
  plotMargin,
  yAxisWidth,
  yDomainPadding,
  pieInnerRadius,
  pieOuterRadius,
  pieCompareInnerRadius,
  pieCompareOuterRadius,
  pieContainerClassName,
  valueFormatter,
}: HeroCanvasProps) {
  const showTitleRow = title != null || subtitle != null;
  return (
    <DesignAnalyticsCard
      gradient={gradient}
      chart={{
        type: "none",
        tooltipType: "none",
        highlightMode: "none",
      }}
    >
      {showTitleRow && (
        <div className="flex items-center gap-3 border-b border-foreground/[0.05] px-5 py-3.5">
          {title != null && (
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </span>
          )}
          {subtitle != null && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {subtitle}
            </span>
          )}
        </div>
      )}
      <div className="px-5 py-4">
        <HeroChart
          data={data}
          annotations={annotations}
          seriesLabel={seriesLabel}
          state={state}
          onChange={onChange}
          onAnnotationCreate={onAnnotationCreate}
          strings={strings}
          palette={palette}
          renderTooltip={renderTooltip}
          ignoreInvalidConfig={ignoreInvalidConfig}
          hoverIndex={hoverIndex}
          onHoverIndexChange={onHoverIndexChange}
          committedRange={committedRange}
          onCommittedRangeChange={onCommittedRangeChange}
          onBrushChange={onBrushChange}
          annotationDraft={annotationDraft}
          onAnnotationDraftChange={onAnnotationDraftChange}
          plotMargin={plotMargin}
          yAxisWidth={yAxisWidth}
          yDomainPadding={yDomainPadding}
          pieInnerRadius={pieInnerRadius}
          pieOuterRadius={pieOuterRadius}
          pieCompareInnerRadius={pieCompareInnerRadius}
          pieCompareOuterRadius={pieCompareOuterRadius}
          pieContainerClassName={pieContainerClassName}
          valueFormatter={valueFormatter}
        />
      </div>
    </DesignAnalyticsCard>
  );
}

// Generates the JSX a consumer would write for the current state shape.
// Long data props are abbreviated to 1-2 representative items + a count
// comment so the snippet shows the actual data shape without dumping
// thirty rows.

function formatFormatKindLiteral(kind: FormatKind, indent: string): string {
  const fields: string[] = [`type: "${kind.type}"`];
  // Emit the option fields explicitly so the consumer sees the full shape
  // they'd write. Using the literal value (not stringified) so booleans /
  // numbers stay as-is.
  for (const [key, value] of Object.entries(kind)) {
    if (key === "type" || value === undefined) continue;
    if (typeof value === "string") fields.push(`${key}: "${value}"`);
    else fields.push(`${key}: ${value}`);
  }
  return `${indent}{ ${fields.join(", ")} }`;
}

// Emit the layer literal — dispatched on `kind`, each variant only
// prints the fields it actually owns. Segment matrices are elided to a
// `[…N×M]` summary so the usage snippet stays readable — the full values
// would swamp the panel.
function formatLayerLiteral(l: HeroCanvasLayer): string {
  const fields: string[] = [
    `id: "${l.id}"`,
    `kind: "${l.kind}"`,
    `label: "${l.label}"`,
    `visible: ${l.visible}`,
  ];
  if (l.kind === "primary" || l.kind === "compare") {
    fields.push(
      `color: "${l.color}"`,
      `segmented: ${l.segmented}`,
      `type: "${l.type}"`,
    );
    if (l.type === "line" || l.type === "area") {
      fields.push(`strokeStyle: "${l.strokeStyle}"`);
    }
    if (l.type === "area" || l.type === "bar") {
      fields.push(`fillOpacity: ${l.fillOpacity}`);
    }
    if (l.segments && l.segments.length > 0) {
      const rows = l.segments.length;
      const cols = l.segments[0]?.length ?? 0;
      fields.push(`segments: /* ${rows}×${cols} */`);
    }
    if (l.segmentSeries && l.segmentSeries.length > 0) {
      const keys = l.segmentSeries.map((s) => `"${s.key}"`).join(", ");
      fields.push(`segmentSeries: [${keys}]`);
    }
    if (l.inProgressFromIndex != null) {
      fields.push(`inProgressFromIndex: ${l.inProgressFromIndex}`);
    }
  } else {
    // Annotations layer — only kind left after the data-layer branch.
    fields.push(`color: "${l.color}"`);
  }
  return `{ ${fields.join(", ")} }`;
}

function formatStateLiteral(state: HeroCanvasState, indent: string): string {
  const inner = `${indent}  `;
  const layersBlock = state.layers
    .map((l) => `${inner}  ${formatLayerLiteral(l)},`)
    .join("\n");
  const lines = [
    `${indent}{`,
    `${inner}view: "${state.view}",`,
    `${inner}layers: [`,
    layersBlock,
    `${inner}],`,
    `${inner}xFormatKind: ${formatFormatKindLiteral(state.xFormatKind, "")},`,
    `${inner}yFormatKind: ${formatFormatKindLiteral(state.yFormatKind, "")},`,
  ];
  // Timeseries-only fields are emitted only when the state variant has
  // them, so the generated snippet always type-checks against the union.
  if (state.view === "timeseries") {
    lines.push(
      `${inner}showGrid: ${state.showGrid},`,
      `${inner}showXAxis: ${state.showXAxis},`,
      `${inner}showYAxis: ${state.showYAxis},`,
      `${inner}zoomRange: ${state.zoomRange ? `[${state.zoomRange[0]}, ${state.zoomRange[1]}]` : "null"},`,
      `${inner}pinnedIndex: ${state.pinnedIndex ?? "null"},`,
    );
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

// JSON-ish but human-readable. Strings get double quotes, numbers stay raw,
// nested objects are emitted on one line so the data preview stays compact.
function formatLiteralValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(formatLiteralValue).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatLiteralValue(v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return String(value);
}

// Render an array prop as a `data={[\n  item1,\n  item2,\n  // …N more\n]}`
// block. The number of inline items is bounded so the snippet stays
// readable for any input length.
function formatDataProp(propName: string, items: unknown[], showCount = 2): string {
  if (items.length === 0) return `  ${propName}={[]}`;
  const previewItems = items.slice(0, showCount);
  const remaining = items.length - previewItems.length;
  const lines = [`  ${propName}={[`];
  for (const item of previewItems) {
    lines.push(`    ${formatLiteralValue(item)},`);
  }
  if (remaining > 0) {
    lines.push(`    // …${remaining} more`);
  }
  lines.push("  ]}");
  return lines.join("\n");
}

type HeroCanvasUsageData = {
  data: Point[],
  annotations: Annotation[],
};

function generateHeroCanvasUsage(
  state: HeroCanvasState,
  exampleData: HeroCanvasUsageData,
): string {
  const lines: string[] = [
    "<HeroCanvas",
    formatDataProp("data", exampleData.data, 2),
    formatDataProp("annotations", exampleData.annotations, 2),
    `  seriesLabel="Sign-ups"`,
  ];

  // The full state object — single source of truth for the controlled API.
  lines.push(`  state={${formatStateLiteral(state, "  ").trimStart()}}`);
  lines.push(`  onChange={setState}`);
  lines.push(`  onAnnotationCreate={(annotation) =>`);
  lines.push(`    setAnnotations((prev) => [...prev, annotation])`);
  lines.push(`  }`);

  lines.push("/>");
  return lines.join("\n");
}

function HeroCanvasUsageViewer({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    runAsynchronouslyWithAlert(async () => {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <DesignAnalyticsCard
      gradient="cyan"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="Usage"
        right={
          <DesignButton
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={handleCopy}
          >
            <CursorClickIcon weight="bold" className="size-3" aria-hidden="true" />
            {copied ? "Copied" : "Copy"}
          </DesignButton>
        }
      />
      <div className="px-5 py-4">
        <pre className="overflow-x-auto rounded-lg bg-foreground/[0.04] p-4 font-mono text-[11px] leading-[1.55] text-foreground ring-1 ring-foreground/[0.06]">
          <code>{code}</code>
        </pre>
      </div>
    </DesignAnalyticsCard>
  );
}

// panel (for live editing) and the formatter demo (so the same widget renders
// the editing UI for whatever variant is selected).

function FormatKindOptions({
  kind,
  onChange,
}: {
  kind: FormatKind,
  onChange: (next: FormatKind) => void,
}) {
  const optionLabel = (text: string) => (
    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
      {text}
    </span>
  );
  switch (kind.type) {
    case "numeric": {
      const decimals = kind.decimals ?? 0;
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("decimals")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "0", label: "0" },
                { id: "1", label: "1" },
                { id: "2", label: "2" },
                { id: "3", label: "3" },
              ]}
              selected={String(decimals)}
              onSelect={(id) => onChange({ ...kind, decimals: Number(id) })}
            />
          </label>
        </div>
      );
    }
    case "short": {
      const precision = kind.precision ?? 1;
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("precision")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "0", label: "0" },
                { id: "1", label: "1" },
                { id: "2", label: "2" },
              ]}
              selected={String(precision)}
              onSelect={(id) => onChange({ ...kind, precision: Number(id) })}
            />
          </label>
        </div>
      );
    }
    case "currency": {
      const currency = kind.currency ?? "USD";
      const divisor = kind.divisor ?? 1;
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("currency")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "USD", label: "USD" },
                { id: "EUR", label: "EUR" },
                { id: "GBP", label: "GBP" },
                { id: "JPY", label: "JPY" },
              ]}
              selected={currency}
              onSelect={(id) => onChange({ ...kind, currency: id })}
            />
          </label>
          <label className="flex items-center gap-1.5">
            {optionLabel("divisor")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "1",   label: "1"   },
                { id: "100", label: "100" },
              ]}
              selected={String(divisor)}
              onSelect={(id) => onChange({ ...kind, divisor: Number(id) })}
            />
          </label>
        </div>
      );
    }
    case "duration": {
      const unit = kind.unit ?? "s";
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("unit")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "ms", label: "ms" },
                { id: "s",  label: "s"  },
                { id: "m",  label: "m"  },
                { id: "h",  label: "h"  },
              ]}
              selected={unit}
              onSelect={(id) => onChange({ ...kind, unit: id as "ms" | "s" | "m" | "h" })}
            />
          </label>
        </div>
      );
    }
    case "datetime": {
      const style = kind.style ?? "short";
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("style")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "short",    label: "Short"    },
                { id: "long",     label: "Long"     },
                { id: "iso",      label: "ISO"      },
                { id: "relative", label: "Relative" },
              ]}
              selected={style}
              onSelect={(id) =>
                onChange({ ...kind, style: id as FormatKindDatetime["style"] })
              }
            />
          </label>
        </div>
      );
    }
    case "percent": {
      const source = kind.source ?? "fraction";
      const decimals = kind.decimals ?? 1;
      return (
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            {optionLabel("source")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "fraction", label: "0..1"     },
                { id: "basis",    label: "0..10000" },
                { id: "whole",    label: "0..100"   },
              ]}
              selected={source}
              onSelect={(id) =>
                onChange({ ...kind, source: id as FormatKindPercent["source"] })
              }
            />
          </label>
          <label className="flex items-center gap-1.5">
            {optionLabel("decimals")}
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "0", label: "0" },
                { id: "1", label: "1" },
                { id: "2", label: "2" },
              ]}
              selected={String(decimals)}
              onSelect={(id) => onChange({ ...kind, decimals: Number(id) })}
            />
          </label>
        </div>
      );
    }
  }
}

// every state slice the component reads from props — view, per-layer
// visibility + type, segments, format, axes, zoom, pin. Edits flow through
// the same `setState` setter the component uses, so the live preview, the
// usage code and the events panel all observe the exact same state.

function HeroCanvasStatePanel({
  state,
  onChange,
  onReset,
  dataLength,
}: {
  state: HeroCanvasState,
  onChange: React.Dispatch<React.SetStateAction<HeroCanvasState>>,
  onReset: () => void,
  /** Used by the in-progress toggle to default the marker index to the
   * last bucket when flipping it on. */
  dataLength: number,
}) {
  const setTimeseriesField = <K extends keyof HeroCanvasTimeseriesState>(
    key: K,
    value: HeroCanvasTimeseriesState[K],
  ) => {
    onChange((prev) => {
      if (prev.view !== "timeseries") return prev;
      return { ...prev, [key]: value };
    });
  };
  const setView = (next: HeroCanvasView) => {
    onChange((prev) => {
      if (next === prev.view) return prev;
      if (next === "pie") {
        // Moving into pie drops every timeseries-only field. Layer
        // segmentation flags are preserved so switching back to
        // timeseries restores whatever the user had configured.
        return {
          view: "pie",
          layers: prev.layers,
          xFormatKind: prev.xFormatKind,
          yFormatKind: prev.yFormatKind,
        };
      }
      // Moving out of pie rebuilds a fresh timeseries state with sensible
      // axis defaults.
      return {
        view: "timeseries",
        layers: prev.layers,
        xFormatKind: prev.xFormatKind,
        yFormatKind: prev.yFormatKind,
        showGrid: true,
        showXAxis: true,
        showYAxis: true,
        zoomRange: null,
        pinnedIndex: null,
      };
    });
  };
  const setXFormatKind = (next: FormatKind) => {
    onChange((prev) => ({ ...prev, xFormatKind: next }));
  };
  const setYFormatKind = (next: FormatKind) => {
    onChange((prev) => ({ ...prev, yFormatKind: next }));
  };
  const setDataLayerSegmented = (id: string, segmented: boolean) => {
    onChange((prev) => ({
      ...prev,
      layers: patchLayerById(prev.layers, id, { segmented }),
    }));
  };
  const setDataLayerInProgress = (id: string, inProgressFromIndex: number | null) => {
    onChange((prev) => ({
      ...prev,
      layers: patchLayerById(prev.layers, id, { inProgressFromIndex }),
    }));
  };

  // Data-layer mutations. The helpers below look the layer up by id
  // (arbitrary string) and rebuild it into whichever variant the user
  // picked — line has no fillOpacity, bar has no strokeStyle, etc.
  const replaceLayerById = (id: string, next: HeroCanvasLayer) => {
    onChange((prev) => ({
      ...prev,
      layers: setLayerById(prev.layers, id, next),
    }));
  };
  const rebuildDataLayer = (
    current: HeroCanvasDataLayer,
    nextType: HeroCanvasLayerType,
  ): HeroCanvasDataLayer => {
    const prevStroke: HeroCanvasStrokeStyle =
      "strokeStyle" in current ? current.strokeStyle : "solid";
    const prevFill: number =
      "fillOpacity" in current ? current.fillOpacity : 0.22;
    // Everything on Common carries through unchanged — only the
    // type-variant fields (strokeStyle / fillOpacity) get rewritten.
    // In particular `segments`, `segmentSeries`, `inProgressFromIndex`
    // and the `segmented` flag all stay put so flipping bar → line
    // doesn't silently drop a configured stack or the in-progress tail.
    const base = {
      id: current.id,
      kind: current.kind,
      label: current.label,
      visible: current.visible,
      color: current.color,
      segmented: current.segmented,
      segments: current.segments,
      segmentSeries: current.segmentSeries,
      inProgressFromIndex: current.inProgressFromIndex,
    };
    if (nextType === "line") return { ...base, type: "line", strokeStyle: prevStroke };
    if (nextType === "bar")  return { ...base, type: "bar",  fillOpacity: prevFill };
    return { ...base, type: "area", strokeStyle: prevStroke, fillOpacity: prevFill };
  };
  const setDataLayerType = (id: string, nextType: HeroCanvasLayerType) => {
    const current = findLayerById(state.layers, id);
    if (!current || (current.kind !== "primary" && current.kind !== "compare")) return;
    replaceLayerById(id, rebuildDataLayer(current, nextType));
  };
  const setDataLayerStrokeStyle = (id: string, style: HeroCanvasStrokeStyle) => {
    const current = findLayerById(state.layers, id);
    if (!current || (current.kind !== "primary" && current.kind !== "compare")) return;
    if (current.type === "bar") return; // Bars have no stroke pattern.
    replaceLayerById(id, { ...current, strokeStyle: style });
  };
  const setDataLayerFillOpacity = (id: string, fillOpacity: number) => {
    const current = findLayerById(state.layers, id);
    if (!current || (current.kind !== "primary" && current.kind !== "compare")) return;
    if (current.type === "line") return; // Lines have no fill.
    replaceLayerById(id, { ...current, fillOpacity });
  };
  const setLayerVisible = (id: string, visible: boolean) => {
    onChange((prev) => ({
      ...prev,
      layers: patchLayerById(prev.layers, id, { visible }),
    }));
  };
  const setLayerLabel = (id: string, label: string) => {
    onChange((prev) => ({
      ...prev,
      layers: patchLayerById(prev.layers, id, { label }),
    }));
  };
  const setLayerColor = (id: string, color: string) => {
    onChange((prev) => ({
      ...prev,
      layers: patchLayerById(prev.layers, id, { color }),
    }));
  };

  const renderBoolField = (
    label: string,
    key: keyof HeroCanvasTimeseriesState,
    value: boolean,
  ) => (
    <div className="flex items-center justify-between gap-3 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2">
      <div className="min-w-0">
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
          {String(key)}
        </div>
      </div>
      <DesignPillToggle
        size="sm"
        gradient="default"
        options={[
          { id: "off", label: "Off" },
          { id: "on",  label: "On"  },
        ]}
        selected={value ? "on" : "off"}
        onSelect={(id) => setTimeseriesField(key, (id === "on") as never)}
      />
    </div>
  );

  const renderDataLayerRow = (layer: HeroCanvasDataLayer) => {
    const supportsStroke = layer.type === "line" || layer.type === "area";
    const supportsFill = layer.type === "area" || layer.type === "bar";
    const currentStroke = "strokeStyle" in layer ? layer.strokeStyle : undefined;
    const currentFill = "fillOpacity" in layer ? layer.fillOpacity : undefined;
    return (
      <div
        key={layer.id}
        className="flex flex-col gap-2 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2"
      >
        {/* Top row: label · type · visibility */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[12px] font-medium text-foreground">{layer.label}</span>
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
              layers.{layer.id}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "line", label: "Line", icon: ChartLineIcon },
                { id: "area", label: "Area", icon: ChartLineUpIcon },
                { id: "bar",  label: "Bar",  icon: ChartBarIcon },
              ]}
              selected={layer.type}
              onSelect={(id) => setDataLayerType(layer.id, id as HeroCanvasLayerType)}
            />
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "off", label: "Hide" },
                { id: "on",  label: "Show" },
              ]}
              selected={layer.visible ? "on" : "off"}
              onSelect={(id) => setLayerVisible(layer.id, id === "on")}
            />
          </div>
        </div>
        {/* Bottom row: color · stroke style · fill opacity · segmented */}
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.05] pt-2">
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              color
            </span>
            <input
              type="color"
              value={layer.color}
              onChange={(e) => setLayerColor(layer.id, e.target.value)}
              aria-label={`${layer.label} color`}
              className="size-6 cursor-pointer rounded border border-foreground/10 bg-transparent p-0"
            />
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {layer.color}
            </span>
          </label>
          {supportsStroke && currentStroke !== undefined && (
            <label className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                stroke
              </span>
              <DesignPillToggle
                size="sm"
                gradient="default"
                options={[
                  { id: "solid",  label: "Solid"  },
                  { id: "dashed", label: "Dashed" },
                  { id: "dotted", label: "Dotted" },
                ]}
                selected={currentStroke}
                onSelect={(id) => setDataLayerStrokeStyle(layer.id, id as HeroCanvasStrokeStyle)}
              />
            </label>
          )}
          {supportsFill && currentFill !== undefined && (
            <label className="flex items-center gap-1.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                fill
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={currentFill}
                onChange={(e) => setDataLayerFillOpacity(layer.id, Number(e.target.value))}
                aria-label={`${layer.label} fill opacity`}
                className="h-1 w-20 cursor-pointer accent-foreground/60"
              />
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {currentFill.toFixed(2)}
              </span>
            </label>
          )}
          {/* Per-layer segmentation toggle. Independent of the other
              data layer, so you can run a stacked signups chart against
              a flat previous line or vice versa. Ignored in pie view. */}
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              segmented
            </span>
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "off", label: "Off" },
                { id: "on",  label: "On"  },
              ]}
              selected={layer.segmented ? "on" : "off"}
              onSelect={(id) => setDataLayerSegmented(layer.id, id === "on")}
            />
          </label>
          {/* Per-layer in-progress toggle. When on, the layer's tail
              renders dashed to signal "this period isn't done yet".
              Toggling on sets the marker to the last index of the
              data array (`data.length - 1`); off resets to null. */}
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              in&#8209;progress
            </span>
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "off", label: "Off" },
                { id: "on",  label: "On"  },
              ]}
              selected={layer.inProgressFromIndex != null ? "on" : "off"}
              onSelect={(id) => setDataLayerInProgress(layer.id, id === "on" ? dataLength - 1 : null)}
            />
          </label>
        </div>
      </div>
    );
  };

  // Simpler layer rows for the marker layer (no type picker).
  const renderSimpleLayerRow = (layer: HeroCanvasAnnotationsLayer) => {
    return (
      <div
        key={layer.id}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2"
      >
        <div className="min-w-0">
          <span className="text-[12px] font-medium text-foreground">{layer.label}</span>
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            layers.{layer.id}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <input
              type="color"
              value={layer.color}
              onChange={(e) => setLayerColor(layer.id, e.target.value)}
              aria-label={`${layer.label} color`}
              className="size-6 cursor-pointer rounded border border-foreground/10 bg-transparent p-0"
            />
          </label>
          <DesignPillToggle
            size="sm"
            gradient="default"
            options={[
              { id: "off", label: "Hide" },
              { id: "on",  label: "Show" },
            ]}
            selected={layer.visible ? "on" : "off"}
            onSelect={(id) => setLayerVisible(layer.id, id === "on")}
          />
        </div>
      </div>
    );
  };
  return (
    <DesignAnalyticsCard
      gradient="green"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="State · mix and match"
        right={
          <DesignButton
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={onReset}
          >
            <ArrowsClockwiseIcon weight="bold" className="size-3" aria-hidden="true" />
            Reset
          </DesignButton>
        }
      />
      <div className="px-5 py-4">
        <p className="mb-3 text-[12px] text-muted-foreground">
          The four legend items are the source of truth. Each layer has its
          own visibility and (where it makes sense) its own chart type.
          Set Sign-ups to <span className="font-mono text-[11px] text-foreground">bar</span>
          {" "}while leaving Previous period as <span className="font-mono text-[11px] text-foreground">line</span>
          {" "}and you get bars with a dashed line overlay — no special &ldquo;mixed&rdquo;
          mode needed. Segmentation is per-layer too: toggle
          {" "}<span className="font-mono text-[11px] text-foreground">signups.segmented</span>
          {" "}and <span className="font-mono text-[11px] text-foreground">previous.segmented</span>
          {" "}independently to stack either series by region. Pie is a separate
          {" "}<span className="font-mono text-[11px] text-foreground">view</span>;
          compare is derived from <span className="font-mono text-[11px] text-foreground">layers.previous.visible</span>.
        </p>
        <div className="flex flex-col gap-3">
          {/* View */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2">
            <div className="min-w-0">
              <span className="text-[12px] font-medium text-foreground">View</span>
              <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                view
              </div>
            </div>
            <DesignPillToggle
              size="sm"
              gradient="default"
              options={[
                { id: "timeseries", label: "Timeseries", icon: ChartLineUpIcon },
                { id: "pie",        label: "Pie",        icon: ChartPieIcon },
              ]}
              selected={state.view}
              onSelect={(id) => setView(id as HeroCanvasView)}
            />
          </div>
          {/* Layers — each one is rendered through its variant-specific
              row. Iteration order follows the `layers` array so consumers
              can reorder the rows by reordering their state. */}
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Layers · source of truth
            </span>
            {state.layers.map((layer) => {
              if (isHeroCanvasDataLayer(layer)) {
                return renderDataLayerRow(layer);
              }
              return renderSimpleLayerRow(layer);
            })}
          </div>
          {/* X-axis format — type picker + per-type sub-options */}
          <div className="flex flex-col gap-2 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[12px] font-medium text-foreground">X-axis format</span>
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  xFormatKind.type
                </div>
              </div>
              <DesignPillToggle
                size="sm"
                gradient="default"
                options={[
                  { id: "numeric",  label: "Numeric"  },
                  { id: "short",    label: "Short"    },
                  { id: "currency", label: "Currency" },
                  { id: "duration", label: "Duration" },
                  { id: "datetime", label: "Date"     },
                  { id: "percent",  label: "Percent"  },
                ]}
                selected={state.xFormatKind.type}
                onSelect={(id) =>
                  setXFormatKind(DEFAULT_FORMAT_KIND[id as FormatKindType])
                }
              />
            </div>
            <FormatKindOptions
              kind={state.xFormatKind}
              onChange={(next) => setXFormatKind(next)}
            />
          </div>
          {/* Y-axis format — type picker + per-type sub-options */}
          <div className="flex flex-col gap-2 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[12px] font-medium text-foreground">Y-axis format</span>
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  yFormatKind.type
                </div>
              </div>
              <DesignPillToggle
                size="sm"
                gradient="default"
                options={[
                  { id: "numeric",  label: "Numeric"  },
                  { id: "short",    label: "Short"    },
                  { id: "currency", label: "Currency" },
                  { id: "duration", label: "Duration" },
                  { id: "datetime", label: "Date"     },
                  { id: "percent",  label: "Percent"  },
                ]}
                selected={state.yFormatKind.type}
                onSelect={(id) =>
                  setYFormatKind(DEFAULT_FORMAT_KIND[id as FormatKindType])
                }
              />
            </div>
            <FormatKindOptions
              kind={state.yFormatKind}
              onChange={(next) => setYFormatKind(next)}
            />
          </div>
          {/* Segmentation is now per-layer — see the `segmented` toggle
              inside each data layer row above. No global flag here. */}
          {/* Timeseries-only boolean toggles — completely hidden in pie view. */}
          {state.view === "timeseries" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {renderBoolField("Grid lines", "showGrid", state.showGrid)}
              {renderBoolField("X-axis labels", "showXAxis", state.showXAxis)}
              {renderBoolField("Y-axis labels", "showYAxis", state.showYAxis)}
            </div>
          )}
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

// exposes and surfaces the most recent invocations as a live log. Lets the
// reader literally watch the API fire as they interact with the preview.

type HeroCanvasLabEvent = {
  id: number,
  ts: number,
  name: string,
  payload: string,
};

function HeroCanvasEventsPanel({
  events,
  onClear,
}: {
  events: HeroCanvasLabEvent[],
  onClear: () => void,
}) {
  return (
    <DesignAnalyticsCard
      gradient="orange"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="Callback events"
        right={
          <DesignButton
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={onClear}
            disabled={events.length === 0}
          >
            <XIcon weight="bold" className="size-3" aria-hidden="true" />
            Clear
          </DesignButton>
        }
      />
      <div className="px-5 py-4">
        {events.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            Interact with the preview — change a control, brush a range,
            create an annotation, pin a point — and the corresponding
            <span className="text-foreground"> on*Change </span>
            callback fires here.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-foreground/[0.05] rounded-lg bg-foreground/[0.02] ring-1 ring-foreground/[0.05]">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline gap-3 px-3 py-1.5 first:rounded-t-lg last:rounded-b-lg"
              >
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70 shrink-0 w-[68px]">
                  {new Date(e.ts).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="font-mono text-[11px] font-semibold text-foreground shrink-0">
                  {e.name}
                </span>
                <span className="ml-auto truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {e.payload}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </DesignAnalyticsCard>
  );
}


function KpiBlock({
  label,
  current,
  previous,
  formatKind,
  gradient,
  periodLabel = "30d",
  previousPeriodLabel = "prev 30d",
}: {
  label: string,
  current: number,
  previous: number,
  formatKind: FormatKind,
  gradient: "blue" | "cyan" | "green" | "orange" | "purple",
  periodLabel?: string,
  previousPeriodLabel?: string,
}) {
  const delta = formatDelta(current, previous);
  return (
    <DesignAnalyticsCard
      gradient={gradient}
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      {/* Databuddy pattern: the stat itself is a hover target that reveals a
          richer period-comparison card. The trigger is also the card content,
          so there's no extra chrome in the default state. */}
      <div className="group relative flex h-full flex-col justify-between px-5 py-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold tabular-nums leading-none text-foreground">
            {formatValue(current, formatKind)}
          </span>
          <TrendPill delta={delta} size="md" />
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono tabular-nums">
            {formatValue(previous, formatKind)}
          </span>
          <span>previous period</span>
        </div>
        {/* Hover-only comparison card (non-interactive tooltip, kept pure-CSS) */}
        <div
          role="tooltip"
          className="pointer-events-none absolute left-4 right-4 top-full z-20 mt-1.5 rounded-xl border border-foreground/10 bg-background/95 p-3 opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.18)] backdrop-blur-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:shadow-[0_12px_28px_rgba(0,0,0,0.55)]"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Current · {periodLabel}
              </span>
              <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                {formatValue(current, formatKind)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {previousPeriodLabel}
              </span>
              <span className="font-mono text-base tabular-nums text-muted-foreground">
                {formatValue(previous, formatKind)}
              </span>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-foreground/[0.06] pt-2">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Change
            </span>
            <TrendPill delta={delta} size="sm" />
          </div>
        </div>
      </div>
    </DesignAnalyticsCard>
  );
}

// variant's default options so the demo stays compact; the state panel
// (above) is where consumers play with sub-options live.

function FormatterPanel() {
  // Each row supplies its own input value because the variants interpret
  // numbers differently (currency wants cents, duration wants seconds /
  // milliseconds, percent wants a fraction, datetime wants a timestamp).
  const rows: { sample: number, kind: FormatKind, hint: string }[] = [
    { sample: 48_271,  kind: { type: "numeric",  decimals: 0 },                hint: "Locale grouping (en-US)" },
    { sample: 48_271,  kind: { type: "numeric",  decimals: 2 },                hint: "Locale grouping · 2 decimals" },
    { sample: 4_827_104, kind: { type: "short",  precision: 1 },               hint: "Compact (k / M / B)" },
    { sample: 482_701, kind: { type: "currency", currency: "USD", divisor: 100 }, hint: "USD · cents → dollars" },
    { sample: 482_701, kind: { type: "currency", currency: "EUR", divisor: 100 }, hint: "EUR · cents → euros" },
    { sample: 4_271,   kind: { type: "duration", unit: "s" },                  hint: "1h 11m 11s (seconds)" },
    { sample: 1_240,   kind: { type: "duration", unit: "ms" },                 hint: "1s 240ms (milliseconds)" },
    { sample: Date.UTC(2026, 2, 17), kind: { type: "datetime", style: "short" },    hint: "Short date" },
    { sample: Date.UTC(2026, 2, 17), kind: { type: "datetime", style: "long" },     hint: "Long date+time" },
    { sample: Date.UTC(2026, 2, 17), kind: { type: "datetime", style: "iso" },      hint: "ISO-8601" },
    { sample: Date.now() - 7_200_000, kind: { type: "datetime", style: "relative" }, hint: "Relative" },
    { sample: 0.482,   kind: { type: "percent",  source: "fraction", decimals: 1 }, hint: "Fraction → percent" },
    { sample: 4_827,   kind: { type: "percent",  source: "basis",    decimals: 2 }, hint: "Basis points → percent" },
  ];
  return (
    <DesignAnalyticsCard
      gradient="purple"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader label="Pluggable value rendering" />
      <div className="px-5 py-4">
        <ul className="divide-y divide-foreground/[0.05] rounded-lg bg-foreground/[0.02] ring-1 ring-foreground/[0.05]">
          {rows.map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-4 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {r.kind.type}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {r.hint}
                </span>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                {formatValue(r.sample, r.kind)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </DesignAnalyticsCard>
  );
}


type PanelState = "data" | "loading" | "empty" | "error";

function ThreeStatePanel() {
  const [state, setState] = useState<PanelState>("data");
  const data = useMemo(
    () => Array.from({ length: 24 }, (_, i) => 30 + Math.sin(i * 0.5) * 18 + i * 3),
    [],
  );

  return (
    <DesignAnalyticsCard
      gradient="orange"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="State shim"
        right={
          <DesignPillToggle
            size="sm"
            gradient="default"
            options={[
              { id: "data",    label: "Data" },
              { id: "loading", label: "Loading" },
              { id: "empty",   label: "Empty" },
              { id: "error",   label: "Error" },
            ]}
            selected={state}
            onSelect={(id) => setState(id as PanelState)}
          />
        }
      />
      <div
        className="relative flex h-[200px] items-center justify-center px-5 py-4"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {state === "data" && <MiniSparkline values={data} />}
        {state === "loading" && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <SpinnerGapIcon
              weight="bold"
              className="size-7 animate-spin text-blue-600 motion-reduce:animate-none dark:text-blue-400"
              aria-hidden="true"
            />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xs font-medium text-foreground">Computing…</span>
              <span className="font-mono text-[10px] uppercase tracking-wider">
                Querying 14 days · 4 breakdowns
              </span>
            </div>
          </div>
        )}
        {state === "empty" && (
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-foreground/[0.06]">
              <ChartLineIcon weight="bold" className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs font-medium text-foreground">No matching events</span>
              <span className="text-[11px] text-muted-foreground">
                Widen the date range or remove breakdown filters to see more.
              </span>
            </div>
          </div>
        )}
        {state === "error" && (
          <div className="w-full">
            <DesignAlert
              variant="error"
              title="Query failed"
              description={
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] tabular-nums">
                    HOGQL:42 · aggregation timeout after 12.4s
                  </span>
                  <DesignButton
                    variant="outline"
                    size="sm"
                    onClick={() => setState("loading")}
                  >
                    <ArrowsClockwiseIcon weight="bold" className="size-3" aria-hidden="true" />
                    Retry
                  </DesignButton>
                </div>
              }
            />
          </div>
        )}
      </div>
    </DesignAnalyticsCard>
  );
}

function MiniSparkline({ values }: { values: number[] }) {
  const W = 520, H = 160, P = 16;
  const iw = W - P * 2;
  const ih = H - P * 2;
  const max = Math.max(...values) * 1.1;
  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(P + (i / (values.length - 1)) * iw).toFixed(1)},${(P + ih - (v / max) * ih).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${(P + iw).toFixed(1)},${(P + ih).toFixed(1)} L${P},${(P + ih).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-full text-blue-600 dark:text-blue-400">
      <defs>
        <linearGradient id="mini-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#mini-spark)" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}


type TableRow = {
  key: string,
  label: string,
  light: string,
  dark: string,
  current: number,
  previous: number,
  trend: number[],
};

const TABLE_ROWS: TableRow[] = [
  { key: "gh",      label: "google.com",      light: "#2563eb", dark: "#60a5fa", current: 14_820, previous: 12_310, trend: [8, 10, 12, 14, 13, 15, 18, 21, 23, 27, 30, 34] },
  { key: "tw",      label: "twitter.com",     light: "#059669", dark: "#34d399", current: 7_430, previous: 9_120, trend: [28, 26, 24, 23, 20, 18, 17, 15, 14, 13, 12, 11] },
  { key: "prod",    label: "producthunt.com", light: "#d97706", dark: "#fbbf24", current: 5_290, previous: 2_480, trend: [3, 4, 5, 8, 11, 14, 17, 19, 22, 26, 30, 32] },
  { key: "hn",      label: "news.ycombinator.com", light: "#7c3aed", dark: "#a78bfa", current: 4_120, previous: 3_980, trend: [12, 13, 14, 14, 13, 15, 14, 13, 14, 15, 14, 14] },
  { key: "direct",  label: "(direct)",        light: "#94a3b8", dark: "#64748b", current: 3_610, previous: 3_420, trend: [20, 21, 21, 22, 22, 23, 22, 23, 23, 24, 24, 24] },
];

type SortKey = "current" | "previous" | "delta" | "label";
type SortDir = "asc" | "desc";

function InsightsTablePanel() {
  const [sortKey, setSortKey] = useState<SortKey>("current");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const rows = [...TABLE_ROWS];
    rows.sort((a, b) => {
      const av = sortKey === "label" ? a.label
        : sortKey === "current" ? a.current
          : sortKey === "previous" ? a.previous
            : formatDelta(a.current, a.previous).pct ?? 0;
      const bv = sortKey === "label" ? b.label
        : sortKey === "current" ? b.current
          : sortKey === "previous" ? b.previous
            : formatDelta(b.current, b.previous).pct ?? 0;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "label" ? "asc" : "desc");
    }
  };

  const headCell = (key: SortKey, label: string, align: "left" | "right" = "right") => {
    const sortState = sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";
    return (
      <th
        scope="col"
        aria-sort={sortState}
        className={cn("px-3 py-2", align === "right" ? "text-right" : "text-left")}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={cn(
            "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors duration-150 hover:text-foreground hover:transition-none focus-visible:outline-none focus-visible:underline",
            sortKey === key && "text-foreground",
          )}
        >
          {label}
          {sortKey === key && (
            sortDir === "asc"
              ? <ArrowUpIcon weight="bold" className="size-2.5" aria-hidden="true" />
              : <ArrowDownIcon weight="bold" className="size-2.5" aria-hidden="true" />
          )}
        </button>
      </th>
    );
  };

  return (
    <DesignAnalyticsCard
      gradient="slate"
      chart={{ type: "none", tooltipType: "none", highlightMode: "none" }}
    >
      <DesignAnalyticsCardHeader
        label="Top referrers"
        right={
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Click a header to sort
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-foreground/[0.05]">
              {headCell("label", "Source", "left")}
              <th scope="col" className="px-3 py-2 text-left">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Trend
                </span>
              </th>
              {headCell("current", "Current")}
              {headCell("previous", "Previous")}
              {headCell("delta", "Δ")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const delta = formatDelta(r.current, r.previous);
              return (
                <tr
                  key={r.key}
                  className="border-b border-foreground/[0.04] last:border-0 transition-colors duration-150 hover:bg-foreground/[0.03] hover:transition-none"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="size-2 rounded-full shrink-0 dark:hidden" style={{ backgroundColor: r.light }} />
                      <span className="hidden size-2 rounded-full shrink-0 dark:block" style={{ backgroundColor: r.dark }} />
                      <span className="text-[12px] font-medium text-foreground">{r.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 w-[110px]">
                    <RowSparkline values={r.trend} light={r.light} dark={r.dark} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[12px] font-semibold tabular-nums text-foreground">
                    {r.current.toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {r.previous.toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <TrendPill delta={delta} size="sm" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DesignAnalyticsCard>
  );
}

function RowSparkline({ values, light, dark }: { values: number[], light: string, dark: string }) {
  const W = 90, H = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = W / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1]!;
  const first = values[0]!;
  const up = last >= first;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-[22px] w-[90px]" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={light}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={cn("dark:hidden", !up && "opacity-80")}
      />
      <polyline
        points={points}
        fill="none"
        stroke={dark}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={cn("hidden dark:block", !up && "opacity-80")}
      />
    </svg>
  );
}


export default function PageClient() {
  const [pulse, setPulse] = useState(0);

  // Simulated "live" heartbeat so the LIVE badge visibly breathes
  useEffect(() => {
    const id = window.setInterval(() => setPulse((p) => p + 1), 2400);
    return () => window.clearInterval(id);
  }, []);

  const latest = SERIES[SERIES.length - 1]!;
  const firstPrev = pointValue(SERIES[0]!, "previous");
  const sumCurrent = SERIES.reduce((a, p) => a + pointValue(p, "signups"), 0);
  const sumPrev = SERIES.reduce((a, p) => a + pointValue(p, "previous"), 0);

  // The HeroCanvas component is fully controlled — PageClient owns the
  // entire state object. Mix-and-match presets are just initial values for
  // this state; changing them at runtime takes effect immediately because
  // the component reads everything from props on every render.
  const [labState, setLabState] = useState<HeroCanvasState>(HERO_CANVAS_DEFAULT_STATE);
  const resetLabState = () => setLabState(HERO_CANVAS_DEFAULT_STATE);

  // Annotations are also a prop. The consumer (PageClient) owns the array
  // and appends to it whenever HeroCanvas fires onAnnotationCreate.
  const [labAnnotations, setLabAnnotations] = useState<Annotation[]>(ANNOTATIONS);

  const heroCanvasUsage = useMemo(
    () =>
      generateHeroCanvasUsage(labState, {
        data: SERIES,
        annotations: labAnnotations,
      }),
    [labState, labAnnotations],
  );

  // Lab playground: live event log subscribed to onChange diffs and the
  // discrete onAnnotationCreate callback. Capped at the most recent 16
  // entries so the panel stays compact.
  const [labEvents, setLabEvents] = useState<HeroCanvasLabEvent[]>([]);
  const labEventIdRef = useRef(0);
  const logLabEvent = useCallback((name: string, payload: unknown) => {
    setLabEvents((prev) => {
      labEventIdRef.current += 1;
      const next: HeroCanvasLabEvent = {
        id: labEventIdRef.current,
        ts: Date.now(),
        name,
        payload:
          payload === null
            ? "null"
            : typeof payload === "object"
              ? JSON.stringify(payload)
              : String(payload),
      };
      return [next, ...prev].slice(0, 16);
    });
  }, []);
  const clearLabEvents = useCallback(() => setLabEvents([]), []);

  // Wrap setLabState so every changed field becomes a discrete event in
  // the log. The events panel renders one row per state slice that
  // actually changed, mirroring how a granular per-callback API would
  // look without forcing the component to expose 13 separate props.
  const handleLabStateChange = useCallback<React.Dispatch<React.SetStateAction<HeroCanvasState>>>(
    (action) => {
      setLabState((prev) => {
        const next =
          typeof action === "function"
            ? (action as (p: HeroCanvasState) => HeroCanvasState)(prev)
            : action;
        for (const key of Object.keys(next) as (keyof HeroCanvasState)[]) {
          if (!Object.is(next[key], prev[key])) {
            logLabEvent(`onChange:${key}`, next[key]);
          }
        }
        return next;
      });
    },
    [logLabEvent],
  );
  const handleLabAnnotationCreate = useCallback(
    (annotation: Annotation) => {
      setLabAnnotations((prev) => [...prev, annotation]);
      logLabEvent("onAnnotationCreate", annotation);
    },
    [logLabEvent],
  );

  return (
    <PageLayout
      title="Chart interaction lab"
      description={
        <span>
          Ported patterns from PostHog&apos;s insight surface — pinnable tooltips,
          crosshair, period compare, annotations, formatter pluggability, series
          visibility, three-state shims and instant display-type switching.
          All shells use <span className="font-mono text-[11px] text-foreground">DesignAnalyticsCard</span>.
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <DesignBadge
            label="Lab · internal"
            color="purple"
            icon={LightningIcon}
            size="sm"
          />
          <DesignBadge
            key={pulse}
            label="Live"
            color="cyan"
            icon={PulseIcon}
            size="sm"
          />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <section>
          <SectionHeading
            index="01"
            label="Hero canvas"
            caption="Layer-based · fully controlled · mix-and-match per-layer types · live callbacks"
          />
          <div className="flex flex-col gap-4">
            {/* Lab playground — state panel / live preview / usage / events */}
            <HeroCanvasStatePanel
              state={labState}
              onChange={handleLabStateChange}
              onReset={resetLabState}
              dataLength={SERIES.length}
            />
            <HeroCanvas
              data={SERIES}
              annotations={labAnnotations}
              seriesLabel="Sign-ups"
              state={labState}
              onChange={handleLabStateChange}
              onAnnotationCreate={handleLabAnnotationCreate}
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <HeroCanvasUsageViewer code={heroCanvasUsage} />
              <HeroCanvasEventsPanel events={labEvents} onClear={clearLabEvents} />
            </div>
          </div>
        </section>

        <section>
          <SectionHeading
            index="02"
            label="KPI deltas"
            caption="Big number + previous-period comparison with trend icons"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiBlock
              label="Sign-ups · 30d"
              current={sumCurrent}
              previous={sumPrev}
              formatKind={DEFAULT_FORMAT_KIND.short}
              gradient="blue"
            />
            <KpiBlock
              label="Daily peak"
              current={Math.max(...SERIES.map((p) => pointValue(p, "signups")))}
              previous={Math.max(...SERIES.map((p) => pointValue(p, "previous")))}
              formatKind={DEFAULT_FORMAT_KIND.numeric}
              gradient="cyan"
            />
            <KpiBlock
              label="Δ vs launch"
              current={pointValue(latest, "signups")}
              previous={firstPrev}
              formatKind={DEFAULT_FORMAT_KIND.numeric}
              gradient="green"
            />
          </div>
        </section>

        <section>
          <SectionHeading
            index="03"
            label="Value formatters"
            caption="One number, five pluggable renderers"
          />
          <FormatterPanel />
        </section>

        <section>
          <SectionHeading
            index="04"
            label="State shim"
            caption="Data · loading · empty · error — one shell, four states"
          />
          <ThreeStatePanel />
        </section>

        <section>
          <SectionHeading
            index="05"
            label="Insights table"
            caption="Sortable rows with trend sparklines and delta pills"
          />
          <InsightsTablePanel />
        </section>
      </div>
    </PageLayout>
  );
}
