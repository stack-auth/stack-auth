"use client";

import { DesignButton } from "@/components/design-components";
import { cn } from "@/components/ui";
import {
  type ChartConfig,
  ChartContainer,
} from "@/components/ui/chart";
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
import { pointValue } from "./types";
import type { AnalyticsChartStrings } from "./strings";

/** Mirrors Recharts' internal `Margin` shape (not exported from their typings). */
export type Margin = {
  top?: number,
  right?: number,
  bottom?: number,
  left?: number,
};

export type AnalyticsChartProps = {
  /** Time-series points — each point carries `values` keyed by layer id. */
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
    (segKey: string) => `${primaryKey}_seg_${segKey}`,
    [primaryKey],
  );
  const compareSegKey = useCallback(
    (segKey: string) => `${compareKey}_seg_${segKey}`,
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

  const chartConfig = useMemo<ChartConfig>(() => {
    const primaryLabel = primaryLayer?.label ?? "";
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
      </ChartContainer>

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

