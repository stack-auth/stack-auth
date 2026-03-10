import { useRouter } from "@/components/router";
import {
  cn,
  Typography
} from "@/components/ui";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { DesignCardTint, DesignCategoryTabs, DesignPillToggle } from "@/components/design-components";
import { UserAvatar } from '@stackframe/stack';
import { fromNow, isWeekend } from '@stackframe/stack-shared/dist/utils/dates';
import { useId, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, TooltipProps, XAxis, YAxis } from "recharts";

export type TimeRange = '7d' | '30d' | 'all';

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
  signed_up_at_millis?: number | null,
}

const CustomTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload as DataPoint;
  const date = new Date(data.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : data.date;

  return (
    <div className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]" style={{ zIndex: 9999 }}>
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
export function filterDatapointsByTimeRange(datapoints: DataPoint[], timeRange: TimeRange): DataPoint[] {
  if (timeRange === '7d') {
    return datapoints.slice(-7);
  }
  if (timeRange === '30d') {
    return datapoints.slice(-30);
  }
  return datapoints;
}

export function filterStackedDatapointsByTimeRange<T extends { date: string }>(datapoints: T[], timeRange: TimeRange): T[] {
  if (timeRange === '7d') return datapoints.slice(-7);
  if (timeRange === '30d') return datapoints.slice(-30);
  return datapoints;
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
            const isWeekendDay = isWeekend(new Date(entry.date));
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
            const date = new Date(value);
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
  const date = new Date(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : row.date;

  const segments: Array<{ key: keyof typeof stackedChartConfig, value: number }> = [
    { key: 'retained', value: row.retained },
    { key: 'reactivated', value: row.reactivated },
    { key: 'new', value: row.new },
  ];
  const total = row.retained + row.reactivated + row.new;

  return (
    <div className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]" style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-6">
          <span className="text-[11px] font-medium text-muted-foreground tracking-wide">
            {formattedDate}
          </span>
          <span className="text-[11px] font-semibold tabular-nums text-foreground">{total} total</span>
        </div>
        {segments.map((seg) => (
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
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
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
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
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
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
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
            const date = new Date(value);
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
};

export type VisitorsHoverDataPoint = {
  date: string,
  page_views: number,
  clicks: number,
};

export type RevenueHoverDataPoint = {
  date: string,
  new_cents: number,
  refund_cents: number,
};

type HighlightDotProps = {
  cx?: number,
  cy?: number,
  fill?: string,
};

const composedChartConfig: ChartConfig = {
  visitors: {
    label: "Visitors",
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

  const date = new Date(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
    : row.date;

  const revenueDollars = (row.new_cents / 100);
  const revenuePerVisitor = row.visitors > 0 ? (revenueDollars / row.visitors) : 0;

  return (
    <div className="rounded-xl bg-background/95 px-4 py-3 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08] min-w-[180px]" style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">
          {formattedDate}
        </span>

        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--color-visitors)" }} />
            <span className="text-xs text-muted-foreground">Visitors</span>
          </div>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {row.visitors.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--color-revenue)" }} />
            <span className="text-xs text-muted-foreground">Revenue</span>
          </div>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            ${revenueDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>

        <div className="border-t border-foreground/[0.06] pt-2">
          <div className="flex items-center justify-between gap-6">
            <span className="text-[11px] text-muted-foreground">Revenue/visitor</span>
            <span className="font-mono text-[11px] font-medium tabular-nums text-foreground">
              ${revenuePerVisitor.toFixed(2)}
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
  height,
  compact = false,
}: {
  datapoints: ComposedDataPoint[],
  height?: number,
  compact?: boolean,
}) {
  const id = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredX, setHoveredX] = useState<number | null>(null);
  const maxVisitors = Math.max(...datapoints.map(d => d.visitors), 1);
  const maxRevenueCents = Math.max(...datapoints.map(d => d.new_cents), 1);
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
        data={datapoints}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
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
          fillOpacity={hoveredIndex == null ? 1 : 0.12}
          strokeOpacity={hoveredIndex == null ? 1 : 0.22}
          dot={false}
          activeDot={<HighlightedLineDot fill="var(--color-visitors)" />}
          isAnimationActive={false}
        />
        {hoveredIndex != null && hoveredX != null && (
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
          dataKey="new_cents"
          yAxisId="revenue"
          stroke="var(--color-revenue)"
          strokeWidth={2.25}
          strokeOpacity={hoveredIndex == null ? 1 : 0.2}
          strokeDasharray="4 4"
          dot={false}
          activeDot={<HighlightedLineDot fill="var(--color-revenue)" />}
          isAnimationActive={false}
        />
        {hoveredIndex != null && hoveredX != null && (
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
          interval={datapoints.length <= 7 ? 0 : "equidistantPreserveStart"}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: compact ? 8 : 10 }}
          tickFormatter={(value) => {
            const date = new Date(value);
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

export function ChartCard({
  children,
  className,
  gradientColor = "blue"
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor?: GradientColor,
}) {
  const designCardGradients: Record<GradientColor, "blue" | "cyan" | "purple" | "green" | "orange" | "default"> = {
    blue: "blue",
    purple: "purple",
    green: "green",
    orange: "orange",
    slate: "default",
    cyan: "cyan",
  };

  return (
    <>
      <style>
        {`
          .chart-card-tooltip-escape .recharts-tooltip-wrapper {
            z-index: 9999 !important;
            overflow: visible !important;
          }
          .chart-card-tooltip-escape .recharts-tooltip-wrapper > * {
            overflow: visible !important;
          }
        `}
      </style>
      <div className={cn(
        "group relative min-h-0 rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none chart-card-tooltip-escape",
        "ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1]",
        "shadow-sm hover:shadow-md hover:z-10",
        className
      )}>
        {/* Subtle glassmorphic background */}
        <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.06] via-foreground/[0.02] dark:from-foreground/[0.03] dark:via-foreground/[0.01] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
        {/* Accent hover tint */}
        <div className={cn(
          "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl overflow-hidden",
          hoverTints[gradientColor]
        )} />
        <div className="relative h-full min-h-0 flex flex-col">
          {children}
        </div>
      </DesignCardTint>
    </>
  );
}

export function TimeRangeToggle({
  timeRange,
  onTimeRangeChange,
}: {
  timeRange: TimeRange,
  onTimeRangeChange: (range: TimeRange) => void,
}) {
  const options: { id: TimeRange, label: string }[] = [
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
    { id: 'all', label: 'All' },
  ];

  return (
    <DesignPillToggle
      options={options}
      selected={timeRange}
      size="sm"
      glassmorphic
      onSelect={(selectedId) => {
        if (selectedId === '7d' || selectedId === '30d' || selectedId === 'all') {
          onTimeRangeChange(selectedId);
          return;
        }
        throw new Error(`Unsupported time range selected: ${selectedId}`);
      }}
    />
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
  totalAllTime,
  showTotal = false,
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
  totalAllTime?: number,
  showTotal?: boolean,
}) {
  const [view, setView] = useState<'chart' | 'list'>('chart');

  const filteredDatapoints = filterDatapointsByTimeRange(chartData, timeRange);
  const filteredStackedDatapoints = stackedChartData ? filterStackedDatapointsByTimeRange(stackedChartData, timeRange) : null;

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

  return (
    <ChartCard className="h-full min-h-0 flex flex-col" gradientColor={gradientColor}>
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
        <div className={cn("flex items-center gap-3 flex-wrap", compact ? "px-4 pt-2" : "px-5 pt-2.5")}>
          {[
            { key: 'new',         label: 'New',         color: 'hsl(152, 38%, 52%)' },
            { key: 'reactivated', label: 'Reactivated', color: 'hsl(36,  55%, 58%)'  },
            { key: 'retained',    label: 'Retained',    color: 'hsl(221, 42%, 55%)' },
          ].map((item) => (
            <div key={item.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-[10px] font-medium text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
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
          <div className="flex-1 overflow-y-auto min-h-0">
            {listData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Typography variant="secondary" className="text-xs">
                  No users found
                </Typography>
              </div>
            ) : (
              <div className="divide-y divide-foreground/[0.04]">
                {listData.map((user) => {
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
}: {
  config: LineChartDisplayConfig,
  datapoints: DataPoint[],
  className?: string,
  height?: number,
  compact?: boolean,
  gradientColor?: GradientColor,
  timeRange: TimeRange,
}) {
  const filteredDatapoints = filterDatapointsByTimeRange(datapoints, timeRange);

  return (
    <ChartCard className={className} gradientColor={gradientColor}>
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
    <ChartCard gradientColor={gradientColor} className={cn("h-full", className)}>
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
}: {
  title: string,
  series: CorrelationSeries[],
  gradientColor?: GradientColor,
  className?: string,
  height?: number,
  compact?: boolean,
  timeRange: TimeRange,
}) {
  // Merge all series data points by date
  const dateSet = new Set<string>();
  for (const s of series) {
    for (const d of s.dataPoints) dateSet.add(d.date);
  }

  const sortedDates = [...dateSet].sort();
  const filteredDates = (() => {
    if (timeRange === '7d') return sortedDates.slice(-7);
    if (timeRange === '30d') return sortedDates.slice(-30);
    return sortedDates;
  })();

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
                  const date = new Date(value);
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
                content={<ChartTooltipContent className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]" />}
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
    <ChartCard className={className} gradientColor={gradientColor}>
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
                      className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]"
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
  const date = new Date(row.date);
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
    <div className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]" style={{ zIndex: 9999 }}>
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
        <Bar dataKey="ok" stackId="split" fill="var(--color-ok)" radius={[0, 0, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`ok-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <Bar dataKey="in_progress" stackId="split" fill="var(--color-in_progress)" radius={[0, 0, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`ip-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <Bar dataKey="error" stackId="split" fill="var(--color-error)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`err-${index}`}
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
          tickFormatter={(value: string) => {
            const d = new Date(value);
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

// ── Visitors hover chart (page views + clicks stacked bar) ──────────────────

const visitorsHoverChartConfig: ChartConfig = {
  page_views: {
    label: "Page Views",
    theme: { light: "hsl(210, 84%, 64%)", dark: "hsl(210, 84%, 72%)" },
  },
  clicks: {
    label: "Clicks",
    theme: { light: "hsl(210, 84%, 82%)", dark: "hsl(210, 84%, 88%)" },
  },
};

function VisitorsHoverTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload as VisitorsHoverDataPoint | undefined;
  if (!row) return null;

  const date = new Date(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : row.date;

  const total = row.page_views + row.clicks;

  return (
    <div className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]" style={{ zIndex: 9999 }}>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{formattedDate}</span>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(210, 84%, 64%)" }} />
            <span className="text-[11px] text-muted-foreground">Page Views</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {row.page_views.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(210, 84%, 82%)" }} />
            <span className="text-[11px] text-muted-foreground">Clicks</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {row.clicks.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2.5 mt-0.5 pt-1.5 border-t border-foreground/[0.06]">
            <span className="text-[11px] font-medium text-muted-foreground">Total</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-foreground">
              {total.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VisitorsHoverChart({
  datapoints,
  compact = false,
}: {
  datapoints: VisitorsHoverDataPoint[],
  compact?: boolean,
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <ChartContainer
      config={visitorsHoverChartConfig}
      className="w-full flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
    >
      <BarChart
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
          content={<VisitorsHoverTooltip />}
          cursor={{ fill: "hsl(var(--muted-foreground))", opacity: hoveredIndex == null ? 0.08 : 0.12, radius: 4 }}
          offset={20}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
        />
        <Bar dataKey="page_views" stackId="visitors" fill="var(--color-page_views)" radius={[0, 0, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
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
        <Bar dataKey="clicks" stackId="visitors" fill="var(--color-clicks)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
            const isActiveBar = hoveredIndex === index;
            return (
              <Cell
                key={`cl-${index}`}
                opacity={getDimmedOpacity(baseOpacity, index, hoveredIndex)}
                stroke={isActiveBar ? "hsl(var(--background))" : undefined}
                strokeWidth={isActiveBar ? 1 : 0}
              />
            );
          })}
        </Bar>
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={compact ? 6 : 8}
          tick={{ fontSize: compact ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
          interval={datapoints.length <= 7 ? 0 : "equidistantPreserveStart"}
          tickFormatter={(value: string) => {
            const d = new Date(value);
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
      </BarChart>
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

  const date = new Date(row.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : row.date;

  const net = row.new_cents - row.refund_cents;

  return (
    <div className="rounded-xl bg-background/95 px-3.5 py-2.5 shadow-lg backdrop-blur-xl ring-1 ring-foreground/[0.08]" style={{ zIndex: 9999 }}>
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
        </div>
      </div>
    </div>
  );
}

export function RevenueHoverChart({
  datapoints,
  compact = false,
}: {
  datapoints: RevenueHoverDataPoint[],
  compact?: boolean,
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const maxCents = Math.max(...datapoints.map(d => d.new_cents + d.refund_cents), 1);
  const ticksCents = niceAxisTicks(Math.ceil(maxCents * 1.1), 4);

  return (
    <ChartContainer
      config={revenueHoverChartConfig}
      className="w-full flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
    >
      <BarChart
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
          content={<RevenueHoverTooltip />}
          cursor={{ fill: "hsl(var(--muted-foreground))", opacity: hoveredIndex == null ? 0.08 : 0.12, radius: 4 }}
          offset={20}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
        />
        <Bar dataKey="new_cents" stackId="revenue" fill="var(--color-new_cents)" radius={[0, 0, 0, 0]} isAnimationActive={false}>
          {datapoints.map((entry, index) => {
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
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
            const baseOpacity = isWeekend(new Date(entry.date)) ? 0.5 : 1;
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
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={compact ? 6 : 8}
          tick={{ fontSize: compact ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
          interval={datapoints.length <= 7 ? 0 : "equidistantPreserveStart"}
          tickFormatter={(value: string) => {
            const d = new Date(value);
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
      </BarChart>
    </ChartContainer>
  );
}
