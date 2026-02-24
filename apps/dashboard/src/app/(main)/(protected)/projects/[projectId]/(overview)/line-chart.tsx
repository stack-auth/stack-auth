import { useRouter } from "@/components/router";
import {
  cn,
  Typography
} from "@/components/ui";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { UserAvatar } from '@stackframe/stack';
import { fromNow, isWeekend } from '@stackframe/stack-shared/dist/utils/dates';
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, TooltipProps, XAxis, YAxis } from "recharts";

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
function filterDatapointsByTimeRange(datapoints: DataPoint[], timeRange: TimeRange): DataPoint[] {
  if (timeRange === '7d') {
    return datapoints.slice(-7);
  }
  if (timeRange === '30d') {
    return datapoints.slice(-30);
  }
  return datapoints;
}

// Shared BarChart component to reduce duplication
function ActivityBarChart({
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
  return (
    <ChartContainer
      config={config.chart}
      className="w-full aspect-auto flex-1 min-h-0 !overflow-visible [&_.recharts-wrapper]:!overflow-visible"
      maxHeight={height}
    >
      <BarChart
        accessibilityLayer
        data={datapoints}
        margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
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
            return (
              <Cell
                key={`cell-${index}`}
                fill="var(--color-activity)"
                opacity={isWeekendDay ? 0.5 : 1}
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
          interval="equidistantPreserveStart"
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
  const hoverTints: Record<GradientColor, string> = {
    blue: "group-hover:bg-slate-500/[0.02]",
    purple: "group-hover:bg-slate-500/[0.02]",
    green: "group-hover:bg-slate-500/[0.02]",
    orange: "group-hover:bg-slate-500/[0.02]",
    slate: "group-hover:bg-slate-500/[0.02]",
    cyan: "group-hover:bg-slate-500/[0.02]",
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
        "group relative rounded-2xl bg-white/90 dark:bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none chart-card-tooltip-escape",
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
        <div className="relative h-full flex flex-col">
          {children}
        </div>
      </div>
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
  const options: { value: TimeRange, label: string }[] = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-foreground/[0.04] p-1 backdrop-blur-sm">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onTimeRangeChange(option.value)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 hover:transition-none",
            timeRange === option.value
              ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06] dark:bg-[hsl(240,71%,70%)]/10 dark:text-[hsl(240,71%,90%)] dark:ring-[hsl(240,71%,70%)]/20"
              : "text-muted-foreground hover:text-foreground hover:bg-background/50"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TabbedMetricsCard({
  config,
  chartData,
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

  // Calculate total for the selected time range
  const total = filteredDatapoints.reduce((sum, point) => sum + point.activity, 0);

  // For "all" time range, use totalAllTime if provided (which includes data beyond 30 days)
  const displayTotal = timeRange === 'all' && totalAllTime !== undefined ? totalAllTime : total;

  const activeTabColors: Record<GradientColor, string> = {
    blue: "bg-blue-500 dark:bg-[hsl(240,71%,70%)]",
    purple: "bg-purple-500 dark:bg-[hsl(200,91%,70%)]",
    green: "bg-emerald-500 dark:bg-[hsl(200,91%,70%)]",
    orange: "bg-orange-500 dark:bg-[hsl(240,71%,70%)]",
    slate: "bg-slate-500 dark:bg-[hsl(240,71%,70%)]",
    cyan: "bg-cyan-500 dark:bg-[hsl(200,91%,70%)]",
  };

  const hoverAccentColors: Record<GradientColor, string> = {
    blue: "hover:bg-blue-500/[0.06]",
    purple: "hover:bg-purple-500/[0.06]",
    green: "hover:bg-emerald-500/[0.06]",
    orange: "hover:bg-orange-500/[0.06]",
    slate: "hover:bg-slate-500/[0.04]",
    cyan: "hover:bg-cyan-500/[0.06]",
  };

  const activeColorClass = activeTabColors[gradientColor];
  const hoverAccentClass = hoverAccentColors[gradientColor];

  return (
    <ChartCard className="h-full flex flex-col" gradientColor={gradientColor}>
      <div className={cn("flex items-center justify-between border-b border-foreground/[0.05]", compact ? "px-4" : "px-5")}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView('chart')}
            className={cn(
              "relative px-3 py-3.5 text-xs font-medium transition-all duration-150 hover:transition-none rounded-t-lg",
              view === 'chart' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {config.name}
            {view === 'chart' && (
              <div className={cn("absolute bottom-0 left-3 right-3 h-0.5 rounded-full", activeColorClass)} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={cn(
              "relative px-3 py-3.5 text-xs font-medium transition-all duration-150 hover:transition-none rounded-t-lg",
              view === 'list' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {listTitle}
            {view === 'list' && (
              <div className={cn("absolute bottom-0 left-3 right-3 h-0.5 rounded-full", activeColorClass)} />
            )}
          </button>
        </div>

        {view === 'chart' && showTotal && (
          <span className="text-lg font-semibold text-foreground tabular-nums">
            {displayTotal.toLocaleString()}
          </span>
        )}
      </div>

      {config.description && view === 'chart' && (
        <div className={cn("text-xs text-muted-foreground", compact ? "px-4 pt-3" : "px-5 pt-4")}>
          {config.description}
        </div>
      )}

      <div className={cn(compact ? "p-4 pt-3" : "p-5 pt-4", "flex flex-col justify-center flex-1 min-h-0 overflow-visible")}>
        {view === 'chart' ? (
          filteredDatapoints.length === 0 ? (
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
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
            {listData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Typography variant="secondary" className="text-xs">
                  No users found
                </Typography>
              </div>
            ) : (
              <div className="space-y-0.5">
                {listData.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => router.push(`/projects/${projectId}/users/${user.id}`)}
                    className={cn(
                      "w-full flex items-center gap-3 p-2.5 rounded-xl transition-all duration-150 hover:transition-none text-left group",
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
                        size={32}
                        border
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate text-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none">
                        {user.display_name || user.primary_email || 'Anonymous User'}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        <span>
                          {config.name === 'Daily Active Users'
                            ? user.last_active_at_millis
                              ? `Active ${fromNow(new Date(user.last_active_at_millis))}`
                              : 'Never active'
                            : user.signed_up_at_millis
                              ? `Signed up ${fromNow(new Date(user.signed_up_at_millis))}`
                              : 'Unknown'
                          }
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
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
