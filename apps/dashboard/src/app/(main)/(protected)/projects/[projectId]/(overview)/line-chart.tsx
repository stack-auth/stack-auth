import { useRouter } from "@/components/router";
import {
  cn,
  Typography
} from "@/components/ui";
import { Calendar } from "@/components/ui/calendar";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  DesignAnalyticsCard,
  type DesignAnalyticsChartConfig,
  DesignCardTint,
  DesignCategoryTabs,
  DesignChartLegend,
  DesignPillToggle,
  useInfiniteListWindow,
} from "@/components/design-components";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { UserAvatar } from '@stackframe/stack';
import { fromNow, isWeekend } from '@stackframe/stack-shared/dist/utils/dates';
import { useId, useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, TooltipProps, XAxis, YAxis } from "recharts";

export type CustomDateRange = {
  from: Date,
  to: Date,
};

export type TimeRange = '7d' | '30d' | 'all' | 'custom';

export type LineChartDisplayConfig = {
  name: string,
  description?: string,
  chart: ChartConfig,
}

export type DataPoint = {
  date: string,
  activity: number,
}

type UserListItem = {
  id: string,
  profile_image_url?: string | null,
  display_name?: string | null,
  primary_email?: string | null,
  last_active_at_millis?: number | null,
  signed_up_at_millis: number,
}

const tooltipSurfaceClass = "rounded-xl bg-white dark:bg-background shadow-[0_10px_24px_rgba(15,23,42,0.14)] dark:shadow-lg ring-1 ring-slate-900/10 dark:ring-foreground/[0.12]";

const CustomTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload as DataPoint;
  const date = parseChartDate(data.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : data.date;

  return (
    <div className={`${tooltipSurfaceClass} px-3.5 py-2.5`} style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">
          {formattedDate}
        </span>
        <div className="flex items-center gap-2.5">
          <span
            className="h-2 w-2 rounded-full ring-2 ring-white/20"
            style={{ backgroundColor: "var(--color-activity)" }}
          />
          <span className="text-[11px] text-muted-foreground">
            Activity
          </span>
          <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
            {typeof data.activity === "number"
              ? data.activity.toLocaleString()
              : data.activity}
          </span>
        </div>
      </div>
    </div>
  );
};

// Helper function to filter datapoints by time range
function getDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeToLocalDay(date: Date): Date {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);
  return normalizedDate;
}

function parseChartDate(dateValue: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month, day] = dateValue.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unsupported chart date format: ${dateValue}`);
  }
  return parsed;
}

function formatDateRangeLabel(range: CustomDateRange | null): string {
  if (range == null) {
    return "Pick date range";
  }

  const fromLabel = range.from.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const toLabel = range.to.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return `${fromLabel} - ${toLabel}`;
}

function filterPointsByTimeRange<T extends { date: string }>(
  datapoints: T[],
  timeRange: TimeRange,
  customDateRange: CustomDateRange | null = null,
): T[] {
  if (timeRange === '7d') {
    return datapoints.slice(-7);
  }
  if (timeRange === '30d') {
    return datapoints.slice(-30);
  }
  if (timeRange === 'custom') {
    if (customDateRange == null) {
      return datapoints;
    }

    const fromKey = getDateKey(customDateRange.from);
    const toKey = getDateKey(customDateRange.to);

    return datapoints.filter((point) => point.date >= fromKey && point.date <= toKey);
  }
  return datapoints;
}

export function filterDatapointsByTimeRange(
  datapoints: DataPoint[],
  timeRange: TimeRange,
  customDateRange: CustomDateRange | null = null,
): DataPoint[] {
  return filterPointsByTimeRange(datapoints, timeRange, customDateRange);
}

export function filterStackedDatapointsByTimeRange<T extends { date: string }>(
  datapoints: T[],
  timeRange: TimeRange,
  customDateRange: CustomDateRange | null = null,
): T[] {
  return filterPointsByTimeRange(datapoints, timeRange, customDateRange);
}

function getHoveredDataIndex(activeTooltipIndex: unknown, dataLength: number): number | null {
  const parsedIndex = typeof activeTooltipIndex === "number"
    ? activeTooltipIndex
    : typeof activeTooltipIndex === "string"
      ? Number(activeTooltipIndex)
      : NaN;

  if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= dataLength) {
    return null;
  }

  return parsedIndex;
}

function updateHoveredIndexFromChartState(
  state: unknown,
  dataLength: number,
  setHoveredIndex: (index: number | null) => void,
) {
  if (typeof state !== "object" || state === null || !("activeTooltipIndex" in state)) {
    setHoveredIndex(null);
    return;
  }

  setHoveredIndex(getHoveredDataIndex(state.activeTooltipIndex, dataLength));
}

function getActiveCoordinateX(state: unknown): number | null {
  if (typeof state !== "object" || state === null || !("activeCoordinate" in state)) {
    return null;
  }

  const activeCoordinate = state.activeCoordinate;
  if (
    typeof activeCoordinate !== "object" ||
    activeCoordinate === null ||
    !("x" in activeCoordinate) ||
    typeof activeCoordinate.x !== "number" ||
    !Number.isFinite(activeCoordinate.x)
  ) {
    return null;
  }

  return activeCoordinate.x;
}

function getDimmedOpacity(
  baseOpacity: number,
  index: number,
  hoveredIndex: number | null,
  dimFactor = 0.22,
) {
  if (hoveredIndex == null) {
    return baseOpacity;
  }

  return hoveredIndex === index ? baseOpacity : Math.max(baseOpacity * dimFactor, 0.08);
}

// Shared BarChart component to reduce duplication
export function ActivityBarChart({
  datapoints,
  config,
  height,
  compact = false,
}: {
  datapoints: DataPoint[],
  config: LineChartDisplayConfig,
  height?: number,
  compact?: boolean,
}) {
  const id = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <ChartContainer
      config={config.chart}
      className="w-full aspect-auto flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
      maxHeight={height}
    >
      <BarChart
        id={id}
        accessibilityLayer
        data={datapoints}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
        onMouseMove={(state) => updateHoveredIndexFromChartState(state, datapoints.length, setHoveredIndex)}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <CartesianGrid
          horizontal
          vertical={false}
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          opacity={0.3}
        />
        <ChartTooltip
          content={<CustomTooltip />}
          cursor={{
            fill: "var(--color-activity)",
            opacity: 0.35,
            radius: 4,
          }}
          offset={20}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
        />
        <Bar
          dataKey="activity"
          fill="var(--color-activity)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          {datapoints.map((entry, index) => {
            const isWeekendDay = isWeekend(parseChartDate(entry.date));
            const baseOpacity = isWeekendDay ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`cell-${index}`}
                fill="var(--color-activity)"
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1.25 : 0}
              />
            );
          })}
        </Bar>
        <YAxis
          tickLine={false}
          axisLine={false}
          width={compact ? 35 : 50}
          tick={{
            fill: "hsl(var(--muted-foreground))",
            fontSize: compact ? 9 : 11,
          }}
        />
        <XAxis
          dataKey="date"
          tickLine={false}
          tickMargin={compact ? 4 : 8}
          axisLine={false}
          interval={datapoints.length <= 7 ? 0 : "equidistantPreserveStart"}
          tick={{
            fill: "hsl(var(--muted-foreground))",
            fontSize: compact ? 8 : 10,
          }}
          tickFormatter={(value) => {
            const date = parseChartDate(value);
            if (!isNaN(date.getTime())) {
              const month = date.toLocaleDateString("en-US", {
                month: "short",
              });
              const day = date.getDate();
              return `${month} ${day}`;
            }
            return value;
          }}
        />
      </BarChart>
    </ChartContainer>
  );
}

// ── Stacked bar chart (for DAU/DAT new · reactivated · retained splits) ──────

export type StackedDataPoint = {
  date: string,
  new: number,
  reactivated: number,
  retained: number,
};

const stackedChartConfig: ChartConfig = {
  retained: { label: "Retained",    color: "hsl(221, 42%, 55%)" },
  reactivated: { label: "Reactivated", color: "hsl(36,  55%, 58%)" },
  new: { label: "New",         color: "hsl(152, 38%, 52%)" },
};

const StackedTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (!active || !payload?.length) return null;

  const row = payload[0].payload as StackedDataPoint & { avg7d?: number };
  const date = parseChartDate(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : row.date;

  const segments: Array<{ key: keyof typeof stackedChartConfig, value: number }> = [
    { key: 'retained', value: row.retained },
    { key: 'reactivated', value: row.reactivated },
    { key: 'new', value: row.new },
  ];
  const nonZeroSegments = segments.filter((segment) => segment.value > 0);
  const total = row.retained + row.reactivated + row.new;

  return (
    <div className={`${tooltipSurfaceClass} px-3.5 py-2.5`} style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-6">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wide">
            {formattedDate}
          </span>
          <span className="text-[11px] font-semibold tabular-nums text-foreground">{total} total</span>
        </div>
        {nonZeroSegments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 rounded-full ring-2 ring-white/20"
              style={{ backgroundColor: `var(--color-${seg.key})` }}
            />
            <span className="text-[11px] text-muted-foreground">
              {stackedChartConfig[seg.key].label}
            </span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {seg.value.toLocaleString()}
            </span>
          </div>
        ))}
        {row.avg7d != null && (
          <div className="border-t border-foreground/[0.06] pt-2">
            <div className="flex items-center justify-between gap-6">
              <span className="text-[11px] text-muted-foreground">7-day avg</span>
              <span className="font-mono text-[11px] font-medium tabular-nums text-foreground">
                {Math.round(row.avg7d).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Trailing moving average that ignores zero-value days.
// This keeps trend direction intuitive while avoiding "floating" artifacts.
function rollingAvg(values: number[], windowSize: number): (number | null)[] {
  return values.map((val, i) => {
    if (val === 0) return null;
    const start = Math.max(0, i - windowSize + 1);
    const slice = values.slice(start, i + 1).filter(v => v > 0);
    if (slice.length === 0) return null;
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

function sevenDayAvg(values: number[], index: number): number {
  const start = Math.max(0, index - 6);
  const slice = values.slice(start, index + 1);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

export function StackedBarChartDisplay({
  datapoints,
  height,
  compact = false,
}: {
  datapoints: StackedDataPoint[],
  height?: number,
  compact?: boolean,
}) {
  const id = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const windowSize = Math.max(4, Math.round(datapoints.length / 2.5));
  const totals = datapoints.map(p => p.new + p.retained + p.reactivated);
  const avgValues = rollingAvg(totals, windowSize);
  const sevenDayAvgs = totals.map((_, i) => sevenDayAvg(totals, i));
  const chartData = datapoints.map((p, i) => {
    const total = totals[i];
    const rawAvg = avgValues[i];
    const movingAvg = total > 0 && rawAvg != null
      ? Math.min(total * 0.9, Math.max(total * 0.35, rawAvg))
      : null;
    const isHighlightedAvg = hoveredIndex != null && i <= hoveredIndex && i >= hoveredIndex - 6;
    return {
      ...p,
      movingAvg,
      avg7d: sevenDayAvgs[i],
      highlightedAvg: isHighlightedAvg ? movingAvg : null,
    };
  });

  const movingAvgConfig: ChartConfig = {
    ...stackedChartConfig,
    movingAvg: { label: "Moving avg", color: "hsl(var(--foreground))" },
  };

  return (
    <ChartContainer
      config={movingAvgConfig}
      className="w-full flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
      maxHeight={height}
    >
      <ComposedChart
        id={id}
        accessibilityLayer
        data={chartData}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
        onMouseMove={(state) => updateHoveredIndexFromChartState(state, chartData.length, setHoveredIndex)}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <CartesianGrid
          horizontal
          vertical={false}
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          opacity={0.3}
        />
        <ChartTooltip
          content={<StackedTooltip />}
          cursor={{ fill: "hsl(var(--muted-foreground))", opacity: hoveredIndex == null ? 0.08 : 0.12, radius: 4 }}
          offset={20}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
        />
        <Bar dataKey="retained" stackId="split" fill="var(--color-retained)" radius={[0, 0, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(parseChartDate(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`ret-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <Bar dataKey="reactivated" stackId="split" fill="var(--color-reactivated)" radius={[0, 0, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(parseChartDate(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`react-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <Bar dataKey="new" stackId="split" fill="var(--color-new)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(parseChartDate(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`new-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <Line
          dataKey="movingAvg"
          type="natural"
          stroke="hsl(var(--foreground))"
          strokeWidth={5}
          strokeOpacity={hoveredIndex == null ? 0.14 : 0.05}
          strokeDasharray="2.5 3.5"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          connectNulls={false}
          legendType="none"
        />
        <Line
          dataKey="movingAvg"
          type="natural"
          stroke="hsl(var(--foreground))"
          strokeWidth={2.1}
          strokeOpacity={hoveredIndex == null ? 0.85 : 0.28}
          strokeDasharray="2.5 3.5"
          dot={false}
          activeDot={{ r: 3.5, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
          isAnimationActive={false}
          connectNulls={false}
          legendType="none"
        />
        {hoveredIndex != null && (
          <Line
            dataKey="highlightedAvg"
            type="natural"
            stroke="hsl(var(--foreground))"
            strokeWidth={3}
            strokeOpacity={1}
            strokeDasharray="2.5 3.5"
            dot={false}
            activeDot={{ r: 3.5, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />
        )}
        <YAxis
          tickLine={false}
          axisLine={false}
          width={compact ? 35 : 50}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: compact ? 9 : 11 }}
        />
        <XAxis
          dataKey="date"
          tickLine={false}
          tickMargin={compact ? 4 : 8}
          axisLine={false}
          interval={datapoints.length <= 7 ? 0 : "equidistantPreserveStart"}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: compact ? 8 : 10 }}
          tickFormatter={(value) => {
            const date = parseChartDate(value);
            if (!isNaN(date.getTime())) {
              return `${date.toLocaleDateString("en-US", { month: "short" })} ${date.getDate()}`;
            }
            return value;
          }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

// ── Combined bar+line analytics chart ─────────────────────────────────────────

export type ComposedDataPoint = {
  date: string,
  new_cents: number,
  refund_cents: number,
  visitors: number,
  dau: number,
  _showVisitors?: boolean,
  _showRevenue?: boolean,
};

export type VisitorsHoverDataPoint = {
  date: string,
  page_views: number,
  movingAvg?: number | null,
  avg7d?: number,
  highlightedAvg?: number | null,
  top_countries?: Array<{ country_code: string, count: number }>,
};

export type RevenueHoverDataPoint = {
  date: string,
  new_cents: number,
  refund_cents: number,
  movingAvg?: number | null,
  avg7d?: number,
  highlightedAvg?: number | null,
};

type HighlightDotProps = {
  cx?: number,
  cy?: number,
  fill?: string,
};

const composedChartConfig: ChartConfig = {
  dau: {
    label: "Daily Active Users",
    theme: { light: "hsl(152, 38%, 52%)", dark: "hsl(152, 38%, 62%)" },
  },
  visitors: {
    label: "Unique Visitors",
    theme: { light: "hsl(210, 84%, 64%)", dark: "hsl(210, 84%, 72%)" },
  },
  revenue: {
    label: "Revenue",
    theme: { light: "hsl(268, 82%, 66%)", dark: "hsl(268, 82%, 74%)" },
  },
};

function ComposedTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload as ComposedDataPoint | undefined;
  if (!row) return null;

  const date = parseChartDate(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
    : row.date;

  const visitorsEnabled = row._showVisitors !== false;
  const revenueEnabled = row._showRevenue !== false;
  const revenueDollars = (row.new_cents / 100);
  const revenuePerVisitor = visitorsEnabled && revenueEnabled && row.visitors > 0 ? (revenueDollars / row.visitors) : null;

  return (
    <div className={`${tooltipSurfaceClass} px-4 py-3 min-w-[180px]`} style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">
          {formattedDate}
        </span>

        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--color-dau)" }} />
            <span className="text-xs text-muted-foreground">Daily active users</span>
          </div>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {row.dau.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--color-visitors)" }} />
            <span className="text-xs text-muted-foreground">Unique visitors</span>
          </div>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {visitorsEnabled ? row.visitors.toLocaleString() : "—"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--color-revenue)" }} />
            <span className="text-xs text-muted-foreground">Revenue</span>
          </div>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {revenueEnabled ? `$${revenueDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
          </span>
        </div>

        <div className="border-t border-foreground/[0.06] pt-2">
          <div className="flex items-center justify-between gap-6">
            <span className="text-[11px] text-muted-foreground">Revenue/visitor</span>
            <span className="font-mono text-[11px] font-medium tabular-nums text-foreground">
              {revenuePerVisitor != null ? `$${revenuePerVisitor.toFixed(2)}` : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HighlightedLineDot({ cx, cy, fill }: HighlightDotProps) {
  if (cx == null || cy == null || fill == null) {
    return null;
  }

  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={16} fill={fill} opacity={0.12} />
      <circle cx={cx} cy={cy} r={10} fill={fill} opacity={0.18} />
      <circle cx={cx} cy={cy} r={6.5} fill="hsl(var(--background))" opacity={0.96} />
      <circle cx={cx} cy={cy} r={4} fill={fill} stroke="hsl(var(--background))" strokeWidth={1.5} />
    </g>
  );
}

export function ComposedAnalyticsChart({
  datapoints,
  showVisitors = true,
  showRevenue = true,
  height,
  compact = false,
}: {
  datapoints: ComposedDataPoint[],
  showVisitors?: boolean,
  showRevenue?: boolean,
  height?: number,
  compact?: boolean,
}) {
  const id = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredX, setHoveredX] = useState<number | null>(null);
  const taggedDatapoints = useMemo(
    () => datapoints.map(d => ({ ...d, _showVisitors: showVisitors, _showRevenue: showRevenue })),
    [datapoints, showVisitors, showRevenue],
  );
  const maxVisitors = Math.max(...datapoints.map(d => Math.max(showVisitors ? d.visitors : 0, d.dau)), 1);
  const maxRevenueCents = Math.max(...datapoints.map(d => showRevenue ? d.new_cents : 0), 1);
  const visitorTicks = niceAxisTicks(Math.ceil(maxVisitors * 1.1), 5);
  const revenueTicks = niceAxisTicks(Math.ceil(maxRevenueCents * 1.15), 5);
  const visitorsMax = visitorTicks[visitorTicks.length - 1] ?? maxVisitors;
  const revenueMax = revenueTicks[revenueTicks.length - 1] ?? maxRevenueCents;

  return (
    <ChartContainer
      config={composedChartConfig}
      className="w-full flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
      maxHeight={height}
    >
      <ComposedChart
        id={id}
        data={taggedDatapoints}
        margin={{ top: 10, right: 4, left: 4, bottom: 0 }}
        onMouseMove={(state) => {
          updateHoveredIndexFromChartState(state, datapoints.length, setHoveredIndex);
          setHoveredX(getActiveCoordinateX(state));
        }}
        onMouseLeave={() => {
          setHoveredIndex(null);
          setHoveredX(null);
        }}
      >
        <defs>
          <linearGradient id={`visitors-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-visitors)" stopOpacity={0.32} />
            <stop offset="70%" stopColor="var(--color-visitors)" stopOpacity={0.08} />
            <stop offset="100%" stopColor="var(--color-visitors)" stopOpacity={0.02} />
          </linearGradient>
          {hoveredX != null && (
            <>
              <clipPath id={`visitors-highlight-clip-${id}`}>
                <rect x={hoveredX - 56} y={-1000} width={112} height={3000} />
              </clipPath>
              <clipPath id={`dau-highlight-clip-${id}`}>
                <rect x={hoveredX - 56} y={-1000} width={112} height={3000} />
              </clipPath>
              <clipPath id={`revenue-highlight-clip-${id}`}>
                <rect x={hoveredX - 56} y={-1000} width={112} height={3000} />
              </clipPath>
            </>
          )}
        </defs>
        <CartesianGrid
          horizontal
          vertical={false}
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          opacity={0.24}
        />
        <ChartTooltip
          content={<ComposedTooltip />}
          cursor={{ stroke: "hsl(var(--foreground))", strokeOpacity: hoveredIndex == null ? 0.32 : 0.62, strokeWidth: hoveredIndex == null ? 1 : 1.5 }}
          offset={20}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
        />
        <Area
          type="monotone"
          dataKey="visitors"
          yAxisId="visitors"
          stroke="var(--color-visitors)"
          strokeWidth={2}
          fill={`url(#visitors-fill-${id})`}
          fillOpacity={showVisitors ? (hoveredIndex == null ? 1 : 0.12) : 0}
          strokeOpacity={showVisitors ? (hoveredIndex == null ? 1 : 0.22) : 0}
          dot={false}
          activeDot={showVisitors ? <HighlightedLineDot fill="var(--color-visitors)" /> : false}
          isAnimationActive={false}
        />
        {showVisitors && hoveredIndex != null && hoveredX != null && (
          <Line
            type="monotone"
            dataKey="visitors"
            yAxisId="visitors"
            stroke="var(--color-visitors)"
            strokeWidth={4}
            strokeOpacity={1}
            dot={false}
            activeDot={<HighlightedLineDot fill="var(--color-visitors)" />}
            isAnimationActive={false}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ clipPath: `url(#visitors-highlight-clip-${id})` }}
            legendType="none"
          />
        )}
        <Line
          type="monotone"
          dataKey="dau"
          yAxisId="visitors"
          stroke="var(--color-dau)"
          strokeWidth={2}
          strokeOpacity={hoveredIndex == null ? 0.95 : 0.24}
          dot={false}
          activeDot={<HighlightedLineDot fill="var(--color-dau)" />}
          isAnimationActive={false}
        />
        {hoveredIndex != null && hoveredX != null && (
          <Line
            type="monotone"
            dataKey="dau"
            yAxisId="visitors"
            stroke="var(--color-dau)"
            strokeWidth={3}
            strokeOpacity={1}
            dot={false}
            activeDot={<HighlightedLineDot fill="var(--color-dau)" />}
            isAnimationActive={false}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ clipPath: `url(#dau-highlight-clip-${id})` }}
            legendType="none"
          />
        )}
        <Line
          type="monotone"
          dataKey="new_cents"
          yAxisId="revenue"
          stroke="var(--color-revenue)"
          strokeWidth={2.25}
          strokeOpacity={showRevenue ? (hoveredIndex == null ? 1 : 0.2) : 0}
          strokeDasharray="4 4"
          dot={false}
          activeDot={showRevenue ? <HighlightedLineDot fill="var(--color-revenue)" /> : false}
          isAnimationActive={false}
        />
        {showRevenue && hoveredIndex != null && hoveredX != null && (
          <Line
            type="monotone"
            dataKey="new_cents"
            yAxisId="revenue"
            stroke="var(--color-revenue)"
            strokeWidth={3.5}
            strokeOpacity={1}
            strokeDasharray="4 4"
            dot={false}
            activeDot={<HighlightedLineDot fill="var(--color-revenue)" />}
            isAnimationActive={false}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ clipPath: `url(#revenue-highlight-clip-${id})` }}
            legendType="none"
          />
        )}
        <YAxis
          yAxisId="visitors"
          tickLine={false}
          axisLine={false}
          width={compact ? 28 : 36}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: compact ? 9 : 10 }}
          ticks={visitorTicks}
          domain={[0, visitorsMax]}
        />
        <YAxis
          yAxisId="revenue"
          orientation="right"
          hide
          domain={[0, revenueMax]}
        />
        <XAxis
          dataKey="date"
          tickLine={false}
          tickMargin={compact ? 4 : 6}
          axisLine={false}
          padding={{ left: 8, right: 8 }}
          interval={datapoints.length <= 7 ? 0 : "equidistantPreserveStart"}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: compact ? 8 : 10 }}
          tickFormatter={(value) => {
            const date = parseChartDate(value);
            if (!isNaN(date.getTime())) {
              return `${date.toLocaleDateString("en-US", { month: "short" })} ${date.getDate()}`;
            }
            return value;
          }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function niceAxisTicks(maxValue: number, count: number): number[] {
  if (maxValue <= 0) return [0];
  const rough = maxValue / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / magnitude;
  let step: number;
  if (residual <= 1.5) {
    step = magnitude;
  } else if (residual <= 3) {
    step = 2 * magnitude;
  } else if (residual <= 7) {
    step = 5 * magnitude;
  } else {
    step = 10 * magnitude;
  }
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + step * 0.5; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

export type GradientColor = "blue" | "purple" | "green" | "orange" | "slate" | "cyan";

/**
 * Thin wrapper kept for backward compatibility within this file.
 * All new code should use DesignAnalyticsCard directly.
 */
export function ChartCard({
  children,
  className,
  gradientColor = "blue",
  chart,
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor?: GradientColor,
  chart?: DesignAnalyticsChartConfig,
}) {
  return (
    <DesignAnalyticsCard gradient={gradientColor} className={className} chart={chart}>
      {children}
    </DesignAnalyticsCard>
  );
}

export function TimeRangeToggle({
  timeRange,
  onTimeRangeChange,
  customDateRange = null,
  onCustomDateRangeChange,
}: {
  timeRange: TimeRange,
  onTimeRangeChange: (range: TimeRange) => void,
  customDateRange?: CustomDateRange | null,
  onCustomDateRangeChange?: (range: CustomDateRange) => void,
}) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const supportsCustomDateRange = onCustomDateRangeChange != null;
  const customDateRangeHandler = onCustomDateRangeChange;

  const options: { id: TimeRange, label: string }[] = [
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
    { id: 'all', label: 'All' },
    ...(supportsCustomDateRange ? [{ id: 'custom' as const, label: 'Custom' }] : []),
  ];

  const selectedRange = customDateRange == null ? undefined : {
    from: customDateRange.from,
    to: customDateRange.to,
  };
  const latestSelectableDate = normalizeToLocalDay(new Date());

  return (
    <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
      <PopoverAnchor asChild>
        <div className="inline-flex items-center relative">
          <DesignPillToggle
            options={options}
            selected={timeRange}
            size="sm"
            glassmorphic={false}
            onSelect={(selectedId) => {
              if (
                selectedId === '7d' ||
                selectedId === '30d' ||
                selectedId === 'all' ||
                selectedId === 'custom'
              ) {
                if (selectedId === "custom" && !supportsCustomDateRange) {
                  throw new Error("Custom range selected but onCustomDateRangeChange is not provided");
                }

                if (selectedId === "custom") {
                  if (customDateRangeHandler == null) {
                    throw new Error("Custom range selected but onCustomDateRangeChange is not provided");
                  }
                  if (customDateRange == null) {
                    const to = latestSelectableDate;
                    const from = new Date(to);
                    from.setDate(from.getDate() - 6);
                    customDateRangeHandler({ from, to });
                  }
                  onTimeRangeChange("custom");
                  setIsCalendarOpen(true);
                  return;
                }

                setIsCalendarOpen(false);
                onTimeRangeChange(selectedId);
                return;
              }
              throw new Error(`Unsupported time range selected: ${selectedId}`);
            }}
          />
        </div>
      </PopoverAnchor>
      {supportsCustomDateRange && (
        <PopoverContent
          align="end"
          sideOffset={8}
          className={cn(
            "w-auto p-3",
            "rounded-xl",
            "bg-white/95 dark:bg-background/95 backdrop-blur-xl",
            "border border-black/[0.08] dark:border-white/[0.08]",
            "ring-1 ring-black/[0.08] dark:ring-white/[0.08]",
            "shadow-lg",
          )}
        >
          <Calendar
            mode="range"
            selected={selectedRange}
            onSelect={(nextRange) => {
              if (nextRange?.from == null || nextRange.to == null) {
                return;
              }

              const normalizedFrom = normalizeToLocalDay(nextRange.from);
              const normalizedTo = normalizeToLocalDay(nextRange.to);
              const normalizedRange = normalizedFrom <= normalizedTo
                ? { from: normalizedFrom, to: normalizedTo }
                : { from: normalizedTo, to: normalizedFrom };

              if (customDateRangeHandler == null) {
                throw new Error("Custom date range update handler is missing");
              }
              customDateRangeHandler(normalizedRange);
              onTimeRangeChange("custom");
              setIsCalendarOpen(false);
            }}
            numberOfMonths={1}
            defaultMonth={customDateRange?.from}
            disabled={{ after: latestSelectableDate }}
            className="!p-0 !border-0"
            classNames={{
              months: "relative",
              month: "space-y-3",
              month_caption: "flex justify-center items-center h-8",
              caption_label: "text-sm font-semibold text-foreground",
              nav: "absolute inset-x-0 top-0 flex items-center justify-between",
              button_previous: cn(
                "h-8 w-8 rounded-lg",
                "inline-flex items-center justify-center",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-foreground/[0.05]",
                "transition-all duration-150 hover:transition-none",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              ),
              button_next: cn(
                "h-8 w-8 rounded-lg",
                "inline-flex items-center justify-center",
                "text-muted-foreground hover:text-foreground",
                "hover:bg-foreground/[0.05]",
                "transition-all duration-150 hover:transition-none",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              ),
              month_grid: "w-full border-collapse mt-4",
              weekdays: "flex gap-1",
              weekday: cn(
                "w-9 h-9 p-0 text-[11px] font-medium",
                "text-muted-foreground/80",
                "flex items-center justify-center",
              ),
              week: "flex gap-1 mt-1",
              day: cn(
                "relative w-9 h-9 p-0 text-center text-sm",
                "flex items-center justify-center",
                "focus-within:relative focus-within:z-20",
              ),
              day_button: cn(
                "h-9 w-9 p-0 text-sm font-normal rounded-lg",
                "inline-flex items-center justify-center",
                "text-foreground",
                "hover:bg-foreground/[0.05] hover:text-foreground",
                "transition-all duration-150 hover:transition-none",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "aria-selected:opacity-100",
              ),
              selected: "[&>button]:text-foreground",
              range_start: cn(
                "range_start",
                "[&>button]:bg-white/95 dark:[&>button]:bg-white/95",
                "[&>button]:text-background dark:[&>button]:text-background",
                "[&>button]:shadow-sm [&>button]:ring-1",
                "[&>button]:ring-black/[0.12] dark:[&>button]:ring-white/[0.08]",
                "[&>button]:hover:bg-white [&>button]:hover:text-background",
              ),
              range_end: cn(
                "range_end",
                "[&>button]:bg-white/95 dark:[&>button]:bg-white/95",
                "[&>button]:text-background dark:[&>button]:text-background",
                "[&>button]:shadow-sm [&>button]:ring-1",
                "[&>button]:ring-black/[0.12] dark:[&>button]:ring-white/[0.08]",
                "[&>button]:hover:bg-white [&>button]:hover:text-background",
              ),
              range_middle: cn(
                "[&>button]:bg-foreground/[0.05] dark:[&>button]:bg-white/[0.06]",
                "[&>button]:text-foreground [&>button]:shadow-none [&>button]:ring-0",
                "[&>button]:hover:bg-foreground/[0.08] dark:[&>button]:hover:bg-white/[0.08]",
              ),
              outside: "text-muted-foreground/30 aria-selected:text-muted-foreground/50",
              disabled: cn(
                "pointer-events-none text-muted-foreground/45 dark:text-muted-foreground/30",
                "[&>button]:text-muted-foreground/45 dark:[&>button]:text-muted-foreground/30",
                "[&>button]:opacity-60 dark:[&>button]:opacity-40",
                "[&>button]:bg-foreground/[0.02] dark:[&>button]:bg-transparent",
                "[&>button]:cursor-not-allowed",
                "[&>button]:hover:bg-foreground/[0.02] dark:[&>button]:hover:bg-transparent",
                "[&>button]:hover:text-muted-foreground/45 dark:[&>button]:hover:text-muted-foreground/30",
              ),
              hidden: "invisible",
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}

export function TabbedMetricsCard({
  config,
  chartData,
  stackedChartData,
  listData,
  listTitle,
  gradientColor = "blue",
  projectId,
  router,
  height,
  compact = false,
  timeRange,
  customDateRange = null,
  totalAllTime,
  showTotal = false,
  stackedLegendItems,
}: {
  config: LineChartDisplayConfig,
  chartData: DataPoint[],
  stackedChartData?: StackedDataPoint[],
  listData: UserListItem[],
  listTitle: string,
  gradientColor?: GradientColor,
  projectId: string,
  router: ReturnType<typeof useRouter>,
  height?: number,
  compact?: boolean,
  timeRange: TimeRange,
  customDateRange?: CustomDateRange | null,
  totalAllTime?: number,
  showTotal?: boolean,
  stackedLegendItems?: Array<{ key: string, label: string, color: string }>,
}) {
  const [view, setView] = useState<'chart' | 'list'>('chart');

  const filteredDatapoints = filterDatapointsByTimeRange(chartData, timeRange, customDateRange);
  const filteredStackedDatapoints = stackedChartData ? filterStackedDatapointsByTimeRange(stackedChartData, timeRange, customDateRange) : null;

  // Calculate total for the selected time range
  const total = filteredDatapoints.reduce((sum, point) => sum + point.activity, 0);

  // For "all" time range, use totalAllTime if provided (which includes data beyond 30 days)
  const displayTotal = timeRange === 'all' && totalAllTime !== undefined ? totalAllTime : total;

  const hoverAccentColors: Record<GradientColor, string> = {
    blue: "hover:bg-blue-500/[0.06]",
    purple: "hover:bg-purple-500/[0.06]",
    green: "hover:bg-emerald-500/[0.06]",
    orange: "hover:bg-orange-500/[0.06]",
    slate: "hover:bg-slate-500/[0.04]",
    cyan: "hover:bg-cyan-500/[0.06]",
  };

  const hoverAccentClass = hoverAccentColors[gradientColor];
  const tabsGradient: "blue" | "cyan" | "purple" | "green" | "orange" | "default" = gradientColor === "slate" ? "default" : gradientColor;

  const listWindow = useInfiniteListWindow(listData.length, view === "list" ? "list" : "chart", view === "list");

  return (
    <ChartCard
      className="h-full min-h-0 flex flex-col"
      gradientColor={gradientColor}
      chart={{
        type: view === "chart" ? (filteredStackedDatapoints != null ? "stacked-bar" : "bar") : "none",
        tooltipType: view === "chart" ? (filteredStackedDatapoints != null ? "stacked" : "default") : "none",
        highlightMode: view === "chart" ? "bar-segment" : "none",
        averages: filteredStackedDatapoints != null ? { movingAverage: true, sevenDayAverage: true } : undefined,
      }}
    >
      <div className={cn("flex items-center justify-between border-b border-foreground/[0.05]", compact ? "px-4" : "px-5")}>
        <DesignCategoryTabs
          categories={[
            { id: "chart", label: config.name },
            { id: "list", label: listTitle },
          ]}
          selectedCategory={view}
          onSelect={(selectedId) => {
            if (selectedId === "chart" || selectedId === "list") {
              setView(selectedId);
              return;
            }
            throw new Error(`Unsupported metrics tab selected: ${selectedId}`);
          }}
          showBadge={false}
          size="sm"
          glassmorphic={false}
          gradient={tabsGradient}
          className="flex-1 min-w-0 border-0 [&>button]:rounded-none [&>button]:px-3 [&>button]:py-3.5 [&>button]:text-xs"
        />

        {view === 'chart' && showTotal && (
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {displayTotal.toLocaleString()}
          </span>
        )}
      </div>

      {config.description && view === 'chart' && (
        <div className={cn("text-xs text-muted-foreground", compact ? "px-4 pt-3" : "px-5 pt-4")}>
          {config.description}
        </div>
      )}

      {filteredStackedDatapoints != null && view === 'chart' && (
        <DesignChartLegend
          items={(stackedLegendItems ?? [
            { key: 'new',         label: 'New',         color: 'hsl(152, 38%, 52%)' },
            { key: 'reactivated', label: 'Reactivated', color: 'hsl(36,  55%, 58%)'  },
            { key: 'retained',    label: 'Retained',    color: 'hsl(221, 42%, 55%)' },
          ])}
          compact={compact}
        />
      )}

      <div className={cn(
        view === 'chart'
          ? (compact ? "px-4 pt-2 pb-1" : "px-5 pt-3 pb-2")
          : (compact ? "px-4 pt-1 pb-2" : "px-5 pt-2 pb-3"),
        "flex flex-col flex-1 min-h-0",
        view === 'chart' ? "overflow-visible" : "overflow-hidden"
      )}>
        {view === 'chart' ? (
          filteredStackedDatapoints != null ? (
            filteredStackedDatapoints.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <Typography variant="secondary" className="text-xs text-center">
                  No data available for this period
                </Typography>
              </div>
            ) : (
              <StackedBarChartDisplay
                datapoints={filteredStackedDatapoints}
                height={height}
                compact={compact}
              />
            )
          ) : filteredDatapoints.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Typography variant="secondary" className="text-xs text-center">
                No data available for this period
              </Typography>
            </div>
          ) : (
            <ActivityBarChart
              datapoints={filteredDatapoints}
              config={config}
              height={height}
              compact={compact}
            />
          )
        ) : (
          <div ref={listWindow.scrollRef} className="flex-1 overflow-y-auto min-h-0">
            {listData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Typography variant="secondary" className="text-xs">
                  No users found
                </Typography>
              </div>
            ) : (
              <div className="divide-y divide-foreground/[0.04]">
                {listData.slice(0, listWindow.visibleCount).map((user) => {
                  const displayName = user.display_name || user.primary_email || 'Anonymous User';
                  const secondaryEmail = user.display_name && user.primary_email ? user.primary_email : null;
                  const timeLabel = config.name === 'Daily Active Users'
                    ? user.last_active_at_millis
                      ? fromNow(new Date(user.last_active_at_millis))
                      : null
                    : user.signed_up_at_millis
                      ? fromNow(new Date(user.signed_up_at_millis))
                      : null;

                  return (
                    <button
                      key={user.id}
                      onClick={() => router.push(`/projects/${projectId}/users/${user.id}`)}
                      className={cn(
                        "w-full flex items-center gap-3 px-1 py-2.5 transition-all duration-150 hover:transition-none text-left group",
                        hoverAccentClass
                      )}
                    >
                      <div className="shrink-0">
                        <UserAvatar
                          user={{
                            profileImageUrl: user.profile_image_url ?? undefined,
                            displayName: user.display_name ?? undefined,
                            primaryEmail: user.primary_email ?? undefined,
                          }}
                          size={30}
                          border
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium truncate text-foreground leading-tight">
                          {displayName}
                        </div>
                        {secondaryEmail && (
                          <div className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                            {secondaryEmail}
                          </div>
                        )}
                      </div>
                      {timeLabel && (
                        <div className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
                          {timeLabel}
                        </div>
                      )}
                    </button>
                  );
                })}
                {listWindow.hasMore && (
                  <div ref={listWindow.sentinelRef} className="py-2 text-center">
                    <Typography variant="secondary" className="text-[10px]">
                      Loading more...
                    </Typography>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

export function LineChartDisplay({
  config,
  datapoints,
  className,
  height = 300,
  compact = false,
  gradientColor = "blue",
  timeRange,
  customDateRange = null,
}: {
  config: LineChartDisplayConfig,
  datapoints: DataPoint[],
  className?: string,
  height?: number,
  compact?: boolean,
  gradientColor?: GradientColor,
  timeRange: TimeRange,
  customDateRange?: CustomDateRange | null,
}) {
  const filteredDatapoints = filterDatapointsByTimeRange(datapoints, timeRange, customDateRange);

  return (
    <ChartCard
      className={className}
      gradientColor={gradientColor}
      chart={{
        type: "bar",
        tooltipType: "default",
        highlightMode: "bar-segment",
      }}
    >
      <div className={compact ? "p-4 pb-3" : "p-5 pb-4"}>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {config.name}
            </span>
            {config.description && (
              <div className="text-xs text-muted-foreground">
                {config.description}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={cn(compact ? "p-4 pt-0" : "p-5 pt-0", "flex-1 min-h-0 overflow-visible")}>
        {filteredDatapoints.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Typography variant="secondary" className="text-xs">
              No data available
            </Typography>
          </div>
        ) : (
          <ActivityBarChart
            datapoints={filteredDatapoints}
            config={config}
            height={height}
            compact={compact}
          />
        )}
      </div>
    </ChartCard>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────

export type StatCardProps = {
  label: string,
  value: number | string,
  delta?: number,
  deltaLabel?: string,
  icon?: React.ReactNode,
  gradientColor?: GradientColor,
  className?: string,
  compact?: boolean,
};

export function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon,
  gradientColor = "blue",
  className,
  compact = false,
}: StatCardProps) {
  const isPositive = delta !== undefined && delta > 0;
  const isNegative = delta !== undefined && delta < 0;

  return (
    <ChartCard
      gradientColor={gradientColor}
      className={cn("h-full", className)}
      chart={{ type: "line", tooltipType: "default", highlightMode: "series-hover" }}
    >
      <div className={cn("flex flex-col gap-1 h-full justify-between", compact ? "p-4" : "p-5")}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
            {label}
          </span>
          {icon && (
            <span className="text-muted-foreground/60 shrink-0 mt-0.5">{icon}</span>
          )}
        </div>
        <div className="mt-auto">
          <div className={cn("font-bold tabular-nums text-foreground leading-none", compact ? "text-2xl" : "text-3xl")}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
          {delta !== undefined && (
            <div className={cn(
              "mt-1.5 text-xs font-medium flex items-center gap-1",
              isPositive ? "text-emerald-600 dark:text-emerald-400"
                : isNegative ? "text-red-500 dark:text-red-400"
                  : "text-muted-foreground"
            )}>
              <span>{isPositive ? '↑' : isNegative ? '↓' : '→'}</span>
              <span>
                {isPositive ? '+' : ''}{delta}{deltaLabel ?? ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </ChartCard>
  );
}

// ── RankedListCard ────────────────────────────────────────────────────────────

export type RankedListItem = {
  label: string,
  count: number,
  color?: string,
};

export function RankedListCard({
  title,
  items,
  gradientColor = "blue",
  className,
  compact = false,
  emptyMessage = 'No data available',
}: {
  title: string,
  items: RankedListItem[],
  gradientColor?: GradientColor,
  className?: string,
  compact?: boolean,
  emptyMessage?: string,
}) {
  const max = Math.max(...items.map(i => i.count), 1);

  return (
    <ChartCard gradientColor={gradientColor} className={cn("h-full", className)}>
      <div className={cn("border-b border-foreground/[0.05]", compact ? "px-4 py-3" : "px-5 py-4")}>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      <div className={cn("flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto", compact ? "p-4 pt-3" : "p-5 pt-4")}>
        {items.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <Typography variant="secondary" className="text-xs">{emptyMessage}</Typography>
          </div>
        ) : (
          items.map((item, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className="text-[10px] font-mono text-muted-foreground w-4 shrink-0 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className={cn("text-foreground font-medium truncate", compact ? "text-xs" : "text-sm")}>{item.label}</span>
                  <span className={cn("text-muted-foreground tabular-nums shrink-0 ml-2", compact ? "text-[10px]" : "text-xs")}>{item.count.toLocaleString()}</span>
                </div>
                <div className="h-1.5 rounded-full bg-foreground/[0.05] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(item.count / max) * 100}%`,
                      backgroundColor: item.color ?? 'hsl(var(--primary))',
                      opacity: 0.7,
                    }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </ChartCard>
  );
}

// ── StatusBreakdownCard ───────────────────────────────────────────────────────

export type StatusBreakdownItem = {
  label: string,
  count: number,
  color: string,
};

export function StatusBreakdownCard({
  title,
  items,
  gradientColor = "blue",
  className,
  compact = false,
  emptyMessage = 'No data',
}: {
  title: string,
  items: StatusBreakdownItem[],
  gradientColor?: GradientColor,
  className?: string,
  compact?: boolean,
  emptyMessage?: string,
}) {
  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    <ChartCard gradientColor={gradientColor} className={cn("h-full", className)}>
      <div className={cn("border-b border-foreground/[0.05]", compact ? "px-4 py-3" : "px-5 py-4")}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
          {total > 0 && (
            <span className="text-xs font-medium tabular-nums text-muted-foreground">{total.toLocaleString()}</span>
          )}
        </div>
      </div>
      <div className={cn("flex-1 min-h-0 flex flex-col", compact ? "p-4 pt-3 gap-2" : "p-5 pt-4 gap-2.5")}>
        {items.length === 0 || total === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <Typography variant="secondary" className="text-xs">{emptyMessage}</Typography>
          </div>
        ) : (
          <>
            {/* Stacked bar */}
            <div className="flex h-2 rounded-full overflow-hidden gap-px">
              {items.filter(i => i.count > 0).map((item, idx) => (
                <div
                  key={idx}
                  style={{ width: `${(item.count / total) * 100}%`, backgroundColor: item.color }}
                />
              ))}
            </div>
            {/* Legend */}
            <div className="flex flex-col gap-1.5 mt-1">
              {items.filter(i => i.count > 0).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className={cn("text-foreground", compact ? "text-[11px]" : "text-xs")}>{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-muted-foreground tabular-nums", compact ? "text-[10px]" : "text-[11px]")}>
                      {((item.count / total) * 100).toFixed(0)}%
                    </span>
                    <span className={cn("font-medium text-foreground tabular-nums", compact ? "text-[11px]" : "text-xs")}>
                      {item.count.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ChartCard>
  );
}

// ── AlertListCard ─────────────────────────────────────────────────────────────

export type AlertItem = {
  label: string,
  detail?: string,
  severity: 'error' | 'warning' | 'info',
};

export function AlertListCard({
  title,
  alerts,
  gradientColor = "orange",
  className,
  compact = false,
  emptyMessage = 'No issues detected',
}: {
  title: string,
  alerts: AlertItem[],
  gradientColor?: GradientColor,
  className?: string,
  compact?: boolean,
  emptyMessage?: string,
}) {
  const severityColors = {
    error: 'bg-red-500/[0.12] text-red-600 dark:text-red-400 ring-red-500/20',
    warning: 'bg-amber-500/[0.12] text-amber-600 dark:text-amber-400 ring-amber-500/20',
    info: 'bg-blue-500/[0.08] text-blue-600 dark:text-blue-400 ring-blue-500/20',
  };
  const severityDot = {
    error: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500',
  };

  return (
    <ChartCard gradientColor={gradientColor} className={cn("h-full", className)}>
      <div className={cn("border-b border-foreground/[0.05]", compact ? "px-4 py-3" : "px-5 py-4")}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
          {alerts.length > 0 && (
            <span className={cn(
              "text-[10px] font-medium px-2 py-0.5 rounded-full ring-1",
              alerts.some(a => a.severity === 'error') ? severityColors.error
                : alerts.some(a => a.severity === 'warning') ? severityColors.warning
                  : severityColors.info
            )}>
              {alerts.length}
            </span>
          )}
        </div>
      </div>
      <div className={cn("flex-1 min-h-0 overflow-y-auto flex flex-col", compact ? "p-4 pt-3 gap-1.5" : "p-5 pt-4 gap-2")}>
        {alerts.length === 0 ? (
          <div className="flex items-center justify-center flex-1 gap-1.5 text-emerald-600 dark:text-emerald-400">
            <span className="text-base">✓</span>
            <Typography className="text-xs font-medium">{emptyMessage}</Typography>
          </div>
        ) : (
          alerts.map((alert, idx) => (
            <div key={idx} className={cn(
              "flex items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1",
              severityColors[alert.severity]
            )}>
              <div className={cn("h-2 w-2 rounded-full shrink-0 mt-0.5", severityDot[alert.severity])} />
              <div className="min-w-0">
                <div className={cn("font-medium leading-snug", compact ? "text-xs" : "text-sm")}>{alert.label}</div>
                {alert.detail && (
                  <div className="text-[11px] opacity-80 mt-0.5">{alert.detail}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </ChartCard>
  );
}

// ── CorrelationCard ───────────────────────────────────────────────────────────

export type CorrelationSeries = {
  key: string,
  label: string,
  color: string,
  dataPoints: DataPoint[],
};

export function CorrelationCard({
  title,
  series,
  gradientColor = "purple",
  className,
  height = 180,
  compact = false,
  timeRange,
  customDateRange = null,
}: {
  title: string,
  series: CorrelationSeries[],
  gradientColor?: GradientColor,
  className?: string,
  height?: number,
  compact?: boolean,
  timeRange: TimeRange,
  customDateRange?: CustomDateRange | null,
}) {
  // Merge all series data points by date
  const dateSet = new Set<string>();
  for (const s of series) {
    for (const d of s.dataPoints) dateSet.add(d.date);
  }

  const sortedDates = [...dateSet].sort();
  const filteredDates = filterStackedDatapointsByTimeRange(
    sortedDates.map((date) => ({ date })),
    timeRange,
    customDateRange,
  ).map((item) => item.date);

  const merged = filteredDates.map(date => {
    const row: Record<string, number | string> = { date };
    for (const s of series) {
      const pt = s.dataPoints.find(d => d.date === date);
      row[s.key] = pt?.activity ?? 0;
    }
    return row;
  });

  const chartConfig: ChartConfig = Object.fromEntries(
    series.map(s => [s.key, { label: s.label, color: s.color }])
  );

  return (
    <ChartCard gradientColor={gradientColor} className={cn("h-full", className)}>
      <div className={cn("border-b border-foreground/[0.05]", compact ? "px-4 py-3" : "px-5 py-4")}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
          <div className="flex items-center gap-3 flex-wrap">
            {series.map(s => (
              <div key={s.key} className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={cn("flex-1 min-h-0 overflow-visible", compact ? "p-4 pt-3" : "p-5 pt-4")}>
        {merged.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Typography variant="secondary" className="text-xs">No data available</Typography>
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="w-full aspect-auto flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
            maxHeight={height}
          >
            <LineChart data={merged} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid
                horizontal
                vertical={false}
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                opacity={0.3}
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval="equidistantPreserveStart"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: compact ? 8 : 10 }}
                tickFormatter={(value) => {
                  const date = parseChartDate(value);
                  if (isNaN(date.getTime())) return value;
                  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={compact ? 30 : 40}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: compact ? 9 : 11 }}
              />
              <ChartTooltip
                content={<ChartTooltipContent className={`${tooltipSurfaceClass} px-3.5 py-2.5`} />}
                cursor={{ strokeDasharray: '3 3', stroke: "hsl(var(--border))" }}
                offset={20}
                allowEscapeViewBox={{ x: true, y: true }}
                wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
              />
              {series.map(s => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </div>
    </ChartCard>
  );
}

export type AuthMethodDatapoint = {
  method: string,
  count: number,
}

const BRAND_CONFIG: ChartConfig = {
  google: { label: "Google", color: "#DB4437" },
  github: { label: "GitHub", color: "#181717" },
  microsoft: { label: "Microsoft", color: "#00A4EF" },
  facebook: { label: "Facebook", color: "#1877F2" },
  apple: { label: "Apple", color: "#000000" },
  spotify: { label: "Spotify", color: "#1DB954" },
  twitch: { label: "Twitch", color: "#9146FF" },
  discord: { label: "Discord", color: "#5865F2" },
  slack: { label: "Slack", color: "#4A154B" },
  gitlab: { label: "GitLab", color: "#FC6D26" },
  bitbucket: { label: "Bitbucket", color: "#0052CC" },
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
  twitter: { label: "Twitter", color: "#1DA1F2" },
  instagram: { label: "Instagram", color: "#E4405F" },
  tiktok: { label: "TikTok", color: "#000000" },
  email: { label: "Email", color: "#F59E0B" },
  phone: { label: "Phone", color: "#10B981" },
  anonymous: { label: "Anonymous", color: "#6B7280" },
  other: { label: "Other", color: "#8B5CF6" },
};

// Memoized Map for efficient lookups
const BRAND_CONFIG_MAP = new Map(Object.entries(BRAND_CONFIG));

export function DonutChartDisplay({
  datapoints,
  className,
  height = 300,
  compact = false,
  gradientColor = "blue",
}: {
  datapoints: AuthMethodDatapoint[],
  className?: string,
  height?: number,
  compact?: boolean,
  gradientColor?: GradientColor,
}) {
  const total = datapoints.reduce((sum, d) => sum + d.count, 0);
  const innerRadius = compact ? 40 : 60;
  const outerRadius = compact ? 55 : 85;

  return (
    <ChartCard
      className={className}
      gradientColor={gradientColor}
      chart={{ type: "donut", tooltipType: "donut", highlightMode: "dot-hover" }}
    >
      <div className={compact ? "p-4 pb-3" : "p-5 pb-4"}>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Auth Methods
            </span>
            {!compact && (
              <div className="text-xs text-muted-foreground">
                Login distribution
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={cn(compact ? "p-4 pt-0" : "p-5 pt-0", "flex-1 min-h-0 flex flex-col overflow-visible")}>
        {datapoints.length === 0 || total === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Typography variant="secondary" className="text-xs text-center">
              No authentication data available
            </Typography>
          </div>
        ) : (
          <div className="flex flex-col items-center w-full h-full justify-center flex-1 min-h-0 overflow-visible">
            <ChartContainer
              config={BRAND_CONFIG}
              className="flex w-full items-center justify-center flex-1 min-h-0 pb-2 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
              maxHeight={height}
            >
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  offset={20}
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
                  content={
                    <ChartTooltipContent
                      className={`${tooltipSurfaceClass} px-3.5 py-2.5`}
                      hideIndicator
                      nameKey="method"
                      formatter={(value, _name, item) => {
                        const key = (item.payload as AuthMethodDatapoint | undefined)?.method;
                        const brandConfig = key ? BRAND_CONFIG[key as keyof typeof BRAND_CONFIG] : undefined;
                        const label = brandConfig?.label || _name;

                        if (typeof value !== "number" || !key) {
                          return null;
                        }

                        return (
                          <div className="flex items-center gap-2.5">
                            <span
                              className="h-2 w-2 rounded-full ring-2 ring-white/20"
                              style={{ backgroundColor: `var(--color-${key})` }}
                            />
                            <span className="text-[11px] font-medium">
                              {label}
                            </span>
                            <span className="font-mono text-xs font-semibold tabular-nums">
                              {value}
                            </span>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Pie
                  data={datapoints.map(x => ({
                    ...x,
                    fill: `var(--color-${x.method})`
                  }))}
                  dataKey="count"
                  nameKey="method"
                  innerRadius={innerRadius}
                  outerRadius={outerRadius}
                  paddingAngle={3}
                  labelLine={false}
                  isAnimationActive={false}
                />
              </PieChart>
            </ChartContainer>
            <div className={cn("flex w-full flex-wrap justify-center gap-2 shrink-0", compact ? "mt-3" : "mt-4")}>
              {datapoints.map((item) => {
                const percentage = total > 0 ? ((item.count / total) * 100).toFixed(0) : 0;
                return (
                  <div
                    key={item.method}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full bg-foreground/[0.03] ring-1 ring-foreground/[0.06] transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.05]",
                      compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-xs"
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: BRAND_CONFIG_MAP.get(item.method)?.color ?? "var(--color-other)" }}
                    />
                    <span className="font-medium text-foreground">
                      {BRAND_CONFIG_MAP.get(item.method)?.label ?? item.method}
                    </span>
                    <span className="text-muted-foreground">
                      {percentage}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

// ── Email stacked bar chart (ok · error · in_progress per day) ───────────────

export type EmailStackedDataPoint = {
  date: string,
  ok: number,
  error: number,
  in_progress: number,
};

const emailStackedChartConfig: ChartConfig = {
  ok: { label: "Delivered", color: "hsl(168, 38%, 48%)" },
  error: { label: "Error",     color: "hsl(355, 45%, 52%)" },
  in_progress: { label: "Sending",   color: "hsl(213, 38%, 52%)" },
};

const EmailStackedTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as EmailStackedDataPoint & { avg7d?: number };
  const date = parseChartDate(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : row.date;
  const total = row.ok + row.error + row.in_progress;
  const segments: Array<{ key: keyof typeof emailStackedChartConfig, value: number }> = [
    { key: 'ok',          value: row.ok },
    { key: 'error',       value: row.error },
    { key: 'in_progress', value: row.in_progress },
  ];
  return (
    <div className={`${tooltipSurfaceClass} px-3.5 py-2.5`} style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-6">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{formattedDate}</span>
          <span className="text-[11px] font-semibold tabular-nums text-foreground">{total} total</span>
        </div>
        {segments.filter(s => s.value > 0).map((seg) => (
          <div key={seg.key} className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 rounded-full ring-2 ring-white/20"
              style={{ backgroundColor: `var(--color-${seg.key})` }}
            />
            <span className="text-[11px] text-muted-foreground">
              {emailStackedChartConfig[seg.key].label}
            </span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {seg.value.toLocaleString()}
            </span>
          </div>
        ))}
        {row.avg7d != null && (
          <div className="border-t border-foreground/[0.06] pt-2">
            <div className="flex items-center justify-between gap-6">
              <span className="text-[11px] text-muted-foreground">7-day avg</span>
              <span className="font-mono text-[11px] font-medium tabular-nums text-foreground">
                {Math.round(row.avg7d).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export function EmailStackedBarChartDisplay({
  datapoints,
  height,
  compact = false,
}: {
  datapoints: EmailStackedDataPoint[],
  height?: number,
  compact?: boolean,
}) {
  const id = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const windowSize = Math.max(4, Math.round(datapoints.length / 2.5));
  const totals = datapoints.map(p => p.ok + p.error + p.in_progress);
  const avgValues = rollingAvg(totals, windowSize);
  const sevenDayAvgs = totals.map((_, i) => sevenDayAvg(totals, i));
  const chartData = datapoints.map((p, i) => {
    const total = totals[i];
    const rawAvg = avgValues[i];
    const movingAvg = total > 0 && rawAvg != null
      ? Math.min(total * 0.9, Math.max(total * 0.35, rawAvg))
      : null;
    const isHighlightedAvg = hoveredIndex != null && i <= hoveredIndex && i >= hoveredIndex - 6;
    return {
      ...p,
      movingAvg,
      avg7d: sevenDayAvgs[i],
      highlightedAvg: isHighlightedAvg ? movingAvg : null,
    };
  });

  const movingAvgConfig: ChartConfig = {
    ...emailStackedChartConfig,
    movingAvg: { label: "Moving avg", color: "hsl(var(--foreground))" },
  };

  return (
    <ChartContainer
      config={movingAvgConfig}
      className="w-full flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
      maxHeight={height}
    >
      <ComposedChart
        id={id}
        accessibilityLayer
        data={chartData}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
        onMouseMove={(state) => updateHoveredIndexFromChartState(state, chartData.length, setHoveredIndex)}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <CartesianGrid
          horizontal
          vertical={false}
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          opacity={0.3}
        />
        <ChartTooltip
          content={<EmailStackedTooltip />}
          cursor={{ fill: "hsl(var(--muted-foreground))", opacity: hoveredIndex == null ? 0.08 : 0.12, radius: 4 }}
          offset={20}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
        />
        {/* Stack order: ok (bottom) → in_progress → error (top). Only the topmost segment per bar gets rounded corners. */}
        {(["ok", "in_progress", "error"] as const).map((dataKey) => {
          const isTopmost = (entry: EmailStackedDataPoint) => {
            if (entry.error > 0) return dataKey === "error";
            if (entry.in_progress > 0) return dataKey === "in_progress";
            return dataKey === "ok";
          };
          const colorVar = dataKey === "ok" ? "ok" : dataKey === "in_progress" ? "in_progress" : "error";
          return (
            <Bar key={dataKey} dataKey={dataKey} stackId="split" fill={`var(--color-${colorVar})`} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {datapoints.map((entry, index) => {
                const baseOpacity = isWeekend(parseChartDate(entry.date)) ? 0.5 : 1;
                const isActiveBar = hoveredIndex === index;
                return (
                  <Cell
                    key={`${dataKey}-${index}`}
                    // Recharts supports tuple radius for bar cells, but the Cell prop type is still SVG-typed.
                    // @ts-expect-error tuple radius is intentional for top-segment rounding.
                    radius={isTopmost(entry) ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                    stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                    strokeWidth={isActiveBar ? 1 : 0}
                  />
                );
              })}
            </Bar>
          );
        })}
        <Line
          dataKey="movingAvg"
          type="natural"
          stroke="hsl(var(--foreground))"
          strokeWidth={5}
          strokeOpacity={hoveredIndex == null ? 0.14 : 0.05}
          strokeDasharray="2.5 3.5"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          connectNulls={false}
          legendType="none"
        />
        <Line
          dataKey="movingAvg"
          type="natural"
          stroke="hsl(var(--foreground))"
          strokeWidth={2.1}
          strokeOpacity={hoveredIndex == null ? 0.85 : 0.28}
          strokeDasharray="2.5 3.5"
          dot={false}
          activeDot={{ r: 3.5, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
          isAnimationActive={false}
          connectNulls={false}
          legendType="none"
        />
        {hoveredIndex != null && (
          <Line
            dataKey="highlightedAvg"
            type="natural"
            stroke="hsl(var(--foreground))"
            strokeWidth={3}
            strokeOpacity={1}
            strokeDasharray="2.5 3.5"
            dot={false}
            activeDot={{ r: 3.5, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />
        )}
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={compact ? 6 : 8}
          tick={{ fontSize: compact ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(value: string) => {
            const d = parseChartDate(value);
            return isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: compact ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
          allowDecimals={false}
          width={28}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

// ── Visitors hover chart (page views + avg line) ────────────────────────────

const visitorsHoverChartConfig: ChartConfig = {
  page_views: {
    label: "Page Views",
    theme: { light: "hsl(210, 84%, 64%)", dark: "hsl(210, 84%, 72%)" },
  },
  movingAvg: {
    label: "Moving avg",
    color: "hsl(var(--foreground))",
  },
};

function VisitorsHoverTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload as VisitorsHoverDataPoint | undefined;
  if (!row) return null;

  const date = parseChartDate(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : row.date;

  const topCountries = (row.top_countries ?? []).slice(0, 3);

  return (
    <div className={`${tooltipSurfaceClass} px-3.5 py-2.5`} style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-6">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{formattedDate}</span>
          <span className="text-[11px] font-semibold tabular-nums text-foreground">
            {row.page_views.toLocaleString()} total
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full ring-2 ring-white/20" style={{ backgroundColor: "var(--color-page_views)" }} />
            <span className="text-[11px] text-muted-foreground">Page Views</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {row.page_views.toLocaleString()}
            </span>
          </div>
          {row.avg7d != null && (
            <div className="mt-0.5 pt-1.5 border-t border-foreground/[0.06] flex items-center gap-2.5">
              <span className="text-[11px] text-muted-foreground">7-day avg</span>
              <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
                {Math.round(row.avg7d).toLocaleString()}
              </span>
            </div>
          )}
          {topCountries.length > 0 && (
            <div className="mt-0.5 pt-1.5 border-t border-foreground/[0.06] flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Top countries</span>
              {topCountries.map((country) => (
                <div key={country.country_code} className="flex items-center gap-2.5">
                  <span className="text-[11px] text-muted-foreground">{country.country_code}</span>
                  <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
                    {country.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VisitorsHoverChart({
  datapoints,
  height,
  compact = false,
}: {
  datapoints: VisitorsHoverDataPoint[],
  height?: number,
  compact?: boolean,
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const windowSize = Math.max(4, Math.round(datapoints.length / 2.5));
  const totals = datapoints.map((p) => p.page_views);
  const avgValues = rollingAvg(totals, windowSize);
  const sevenDayAvgs = totals.map((_, i) => sevenDayAvg(totals, i));
  const chartData = datapoints.map((p, i) => {
    const total = totals[i];
    const rawAvg = avgValues[i];
    const movingAvg = total > 0 && rawAvg != null
      ? Math.min(total * 0.9, Math.max(total * 0.35, rawAvg))
      : null;
    const isHighlightedAvg = hoveredIndex != null && i <= hoveredIndex && i >= hoveredIndex - 6;
    return {
      ...p,
      movingAvg,
      avg7d: sevenDayAvgs[i],
      highlightedAvg: isHighlightedAvg ? movingAvg : null,
    };
  });

  return (
    <ChartContainer
      config={visitorsHoverChartConfig}
      className="w-full flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
      maxHeight={height}
    >
      <ComposedChart
        data={chartData}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        onMouseMove={(state) => updateHoveredIndexFromChartState(state, chartData.length, setHoveredIndex)}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <CartesianGrid
          horizontal
          vertical={false}
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          opacity={0.3}
        />
        <ChartTooltip
          content={<VisitorsHoverTooltip />}
          cursor={{ fill: "hsl(var(--muted-foreground))", opacity: hoveredIndex == null ? 0.08 : 0.12, radius: 4 }}
          offset={20}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
        />
        <Bar dataKey="page_views" stackId="visitors" fill="var(--color-page_views)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(parseChartDate(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`pv-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <Line
          dataKey="movingAvg"
          type="natural"
          stroke="hsl(var(--foreground))"
          strokeWidth={5}
          strokeOpacity={hoveredIndex == null ? 0.14 : 0.05}
          strokeDasharray="2.5 3.5"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          connectNulls={false}
          legendType="none"
        />
        <Line
          dataKey="movingAvg"
          type="natural"
          stroke="hsl(var(--foreground))"
          strokeWidth={2.1}
          strokeOpacity={hoveredIndex == null ? 0.85 : 0.28}
          strokeDasharray="2.5 3.5"
          dot={false}
          activeDot={{ r: 3.5, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
          isAnimationActive={false}
          connectNulls={false}
          legendType="none"
        />
        {hoveredIndex != null && (
          <Line
            dataKey="highlightedAvg"
            type="natural"
            stroke="hsl(var(--foreground))"
            strokeWidth={3}
            strokeOpacity={1}
            strokeDasharray="2.5 3.5"
            dot={false}
            activeDot={{ r: 3.5, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />
        )}
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={compact ? 6 : 8}
          tick={{ fontSize: compact ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
          interval={chartData.length <= 7 ? 0 : "equidistantPreserveStart"}
          tickFormatter={(value: string) => {
            const d = parseChartDate(value);
            return isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: compact ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
          allowDecimals={false}
          width={28}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

// ── Revenue hover chart (new_cents + refund_cents stacked bar) ───────────────

const revenueHoverChartConfig: ChartConfig = {
  new_cents: {
    label: "Revenue",
    theme: { light: "hsl(268, 82%, 66%)", dark: "hsl(268, 82%, 74%)" },
  },
  refund_cents: {
    label: "Refunds",
    theme: { light: "hsl(355, 70%, 68%)", dark: "hsl(355, 70%, 76%)" },
  },
  movingAvg: {
    label: "Moving avg",
    color: "hsl(var(--foreground))",
  },
};

function formatUsdCompact(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

function RevenueHoverTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload as RevenueHoverDataPoint | undefined;
  if (!row) return null;

  const date = parseChartDate(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : row.date;

  const net = row.new_cents - row.refund_cents;

  return (
    <div className={`${tooltipSurfaceClass} px-3.5 py-2.5`} style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{formattedDate}</span>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(268, 82%, 66%)" }} />
            <span className="text-[11px] text-muted-foreground">Revenue</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {formatUsdCompact(row.new_cents)}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(355, 70%, 68%)" }} />
            <span className="text-[11px] text-muted-foreground">Refunds</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {formatUsdCompact(row.refund_cents)}
            </span>
          </div>
          <div className="flex items-center gap-2.5 mt-0.5 pt-1.5 border-t border-foreground/[0.06]">
            <span className="text-[11px] font-medium text-muted-foreground">Net</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {formatUsdCompact(Math.max(0, net))}
            </span>
          </div>
          {row.avg7d != null && (
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-muted-foreground">7-day avg</span>
              <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
                {formatUsdCompact(Math.round(row.avg7d))}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RevenueHoverChart({
  datapoints,
  height,
  compact = false,
}: {
  datapoints: RevenueHoverDataPoint[],
  height?: number,
  compact?: boolean,
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const windowSize = Math.max(4, Math.round(datapoints.length / 2.5));
  const totals = datapoints.map((p) => p.new_cents + p.refund_cents);
  const avgValues = rollingAvg(totals, windowSize);
  const sevenDayAvgs = totals.map((_, i) => sevenDayAvg(totals, i));
  const chartData = datapoints.map((p, i) => {
    const total = totals[i];
    const rawAvg = avgValues[i];
    const movingAvg = total > 0 && rawAvg != null
      ? Math.min(total * 0.9, Math.max(total * 0.35, rawAvg))
      : null;
    const isHighlightedAvg = hoveredIndex != null && i <= hoveredIndex && i >= hoveredIndex - 6;
    return {
      ...p,
      movingAvg,
      avg7d: sevenDayAvgs[i],
      highlightedAvg: isHighlightedAvg ? movingAvg : null,
    };
  });

  const maxCents = Math.max(...chartData.map(d => d.new_cents + d.refund_cents), 1);
  const ticksCents = niceAxisTicks(Math.ceil(maxCents * 1.1), 4);

  return (
    <ChartContainer
      config={revenueHoverChartConfig}
      className="w-full flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
      maxHeight={height}
    >
      <ComposedChart
        data={chartData}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        onMouseMove={(state) => updateHoveredIndexFromChartState(state, chartData.length, setHoveredIndex)}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <CartesianGrid
          horizontal
          vertical={false}
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          opacity={0.3}
        />
        <ChartTooltip
          content={<RevenueHoverTooltip />}
          cursor={{ fill: "hsl(var(--muted-foreground))", opacity: hoveredIndex == null ? 0.08 : 0.12, radius: 4 }}
          offset={20}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
        />
        <Bar dataKey="new_cents" stackId="revenue" fill="var(--color-new_cents)" radius={[0, 0, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(parseChartDate(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`nc-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <Bar dataKey="refund_cents" stackId="revenue" fill="var(--color-refund_cents)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(parseChartDate(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`rc-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <Line
          dataKey="movingAvg"
          type="natural"
          stroke="hsl(var(--foreground))"
          strokeWidth={5}
          strokeOpacity={hoveredIndex == null ? 0.14 : 0.05}
          strokeDasharray="2.5 3.5"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
          connectNulls={false}
          legendType="none"
        />
        <Line
          dataKey="movingAvg"
          type="natural"
          stroke="hsl(var(--foreground))"
          strokeWidth={2.1}
          strokeOpacity={hoveredIndex == null ? 0.85 : 0.28}
          strokeDasharray="2.5 3.5"
          dot={false}
          activeDot={{ r: 3.5, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
          isAnimationActive={false}
          connectNulls={false}
          legendType="none"
        />
        {hoveredIndex != null && (
          <Line
            dataKey="highlightedAvg"
            type="natural"
            stroke="hsl(var(--foreground))"
            strokeWidth={3}
            strokeOpacity={1}
            strokeDasharray="2.5 3.5"
            dot={false}
            activeDot={{ r: 3.5, fill: "hsl(var(--foreground))", stroke: "hsl(var(--background))", strokeWidth: 1.5 }}
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />
        )}
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={compact ? 6 : 8}
          tick={{ fontSize: compact ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
          interval={chartData.length <= 7 ? 0 : "equidistantPreserveStart"}
          tickFormatter={(value: string) => {
            const d = parseChartDate(value);
            return isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: compact ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
          ticks={ticksCents}
          tickFormatter={(v: number) => formatUsdCompact(v)}
          width={36}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
