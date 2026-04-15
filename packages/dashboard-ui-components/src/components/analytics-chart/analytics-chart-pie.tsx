import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react";
import { cn } from "@stackframe/stack-ui";
import { type DesignChartConfig, DesignChartContainer } from "../chart-container";
import { type CSSProperties, type Ref, useMemo } from "react";
import { Cell, Pie, PieChart } from "recharts";
import { TrendPill } from "./default-analytics-chart-tooltip";
import { formatDelta } from "./format";
import type { AnalyticsChartStrings } from "./strings";
import {
  cssIdent,
  type AnalyticsChartPieProps,
  type AnalyticsChartSeries,
  type FormatKind,
  type Point,
} from "./types";

type SegmentColors = {
  primary: { light: string[], dark: string[] },
  compare: { light: string[], dark: string[] },
};

type AnalyticsChartPieBodyProps = {
  wrapperRef: Ref<HTMLDivElement>,
  primarySegmentSeries: readonly AnalyticsChartSeries[],
  compareSegmentSeries: readonly AnalyticsChartSeries[],
  aggregatedPrimarySegments: number[],
  aggregatedCompareSegments: number[],
  aggregatedPrimaryTotal: number,
  aggregatedCompareTotal: number,
  segmentColors: SegmentColors,
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
  strings: AnalyticsChartStrings,
  fmtValue: (value: number, kind: FormatKind) => string,
  pie: AnalyticsChartPieProps | undefined,
};

const DEFAULT_PIE_CLASSNAME = "aspect-square h-[220px] w-[220px] sm:h-[240px] sm:w-[240px]";

export function AnalyticsChartPie({
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
  pie,
}: AnalyticsChartPieBodyProps) {
  const innerRadius = pie?.innerRadius ?? 60;
  const outerRadius = pie?.outerRadius ?? 84;
  const compareInnerRadius = pie?.compareInnerRadius ?? 36;
  const compareOuterRadius = pie?.compareOuterRadius ?? 52;
  const containerClassName = pie?.className ?? DEFAULT_PIE_CLASSNAME;

  const canonicalSeries = primarySegmentSeries.length > 0
    ? primarySegmentSeries
    : compareSegmentSeries;
  const usePrimaryForCanonical = primarySegmentSeries.length > 0;

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

  const canonicalTotal = usePrimaryForCanonical
    ? aggregatedPrimaryTotal
    : aggregatedCompareTotal;

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
            fill: segmentColors.primary.light[sIdx],
            fillDark: segmentColors.primary.dark[sIdx],
            fillCompare: segmentColors.compare.light[sIdx],
            fillCompareDark: segmentColors.compare.dark[sIdx],
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

  const chartConfig = useMemo<DesignChartConfig>(() => {
    const config: DesignChartConfig = {};
    canonicalSeries.forEach((s, sIdx) => {
      config[cssIdent(s.key)] = {
        label: s.label,
        theme: {
          light: segmentColors.primary.light[sIdx],
          dark: segmentColors.primary.dark[sIdx],
        },
      };
      config[`compare-${cssIdent(s.key)}`] = {
        label: s.label,
        theme: {
          light: segmentColors.compare.light[sIdx],
          dark: segmentColors.compare.dark[sIdx],
        },
      };
    });
    return config;
  }, [canonicalSeries, segmentColors]);

  const activeRow = hoverKey
    ? legendRows.find((r) => r.key === hoverKey) ?? null
    : null;
  const activeDelta = activeRow
    ? formatDelta(activeRow.value, activeRow.prevValue)
    : formatDelta(aggregatedPrimaryTotal, aggregatedCompareTotal);

  const windowDays = visibleEnd - visibleStart + 1;
  const startLabel = fmtValue(fullData[visibleStart]!.ts, xFormatKind);
  const endLabel = fmtValue(fullData[visibleEnd]!.ts, xFormatKind);

  const outerData = legendRows.map((r) => ({ name: cssIdent(r.key), hoverKey: r.key, value: r.value, fill: r.fill }));
  const innerData = legendRows.map((r) => ({ name: cssIdent(r.key), hoverKey: r.key, value: r.prevValue, fill: r.fillCompare }));
  const activeIdx = hoverKey ? legendRows.findIndex((r) => r.key === hoverKey) : -1;

  return (
    <div
      ref={wrapperRef}
      className="relative w-full select-none"
      onClick={(e) => e.stopPropagation()}
    >
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

      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        <div className="flex shrink-0 flex-col items-center gap-3">
          <div className="relative">
            <DesignChartContainer config={chartConfig} className={containerClassName}>
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
                          fill={`var(--color-${d.name})`}
                          opacity={inactive ? 0.22 : 1}
                          onMouseEnter={() => setHoverKey(d.hoverKey)}
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
                          fill={`var(--color-compare-${d.name})`}
                          opacity={inactive ? 0.22 : 0.95}
                          onMouseEnter={() => setHoverKey(d.hoverKey)}
                          onMouseLeave={() => setHoverKey(null)}
                        />
                      );
                    })}
                  </Pie>
                )}
              </PieChart>
            </DesignChartContainer>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="block max-w-[68px] truncate font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {activeRow ? activeRow.label : strings.pieTotalCenter}
              </span>
              <span className="mt-0.5 block max-w-[72px] truncate font-mono text-xl font-semibold leading-none tabular-nums text-foreground">
                {fmtValue(activeRow ? activeRow.value : canonicalTotal, yFormatKind)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-center">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {startLabel} – {endLabel}
            </span>
            {showCompare && (
              <TrendPill delta={activeDelta} size="sm" label={strings.pieVsPrev} />
            )}
          </div>
        </div>

        <ul className="flex min-w-[200px] max-w-[300px] flex-col gap-1">
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
                    className="size-2.5 shrink-0 rounded-[3px] bg-[var(--c-l)] dark:bg-[var(--c-d)]"
                    style={{ "--c-l": r.fill, "--c-d": r.fillDark } as CSSProperties}
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
