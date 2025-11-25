import { useRouter } from "@/components/router";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { UserAvatar } from '@stackframe/stack';
import { fromNow } from '@stackframe/stack-shared/dist/utils/dates';
import {
    cn,
    Typography
} from "@stackframe/stack-ui";
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

const isWeekend = (dateString: string): boolean => {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return false;
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday (0) or Saturday (6)
};

// Standardized weekend color - dark blue for weekends
const WEEKEND_COLOR = "hsl(217, 91%, 30%)";

const CustomTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload as DataPoint;
  const date = new Date(data.date);
  const formattedDate = !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : data.date;

  return (
    <div className="rounded-xl border border-border/70 bg-background/90 px-3 py-2 text-xs shadow-xl backdrop-blur-sm">
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.7rem] font-medium text-muted-foreground">
          {formattedDate}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: "var(--color-activity)" }}
          />
          <span className="text-[0.7rem] text-muted-foreground">
            Activity
          </span>
          <span className="ml-auto font-mono text-[0.7rem] font-semibold tabular-nums text-foreground">
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
      className="w-full aspect-auto flex-1 min-h-0"
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
            opacity: 0.1,
          }}
        />
        <Bar
          dataKey="activity"
          fill="var(--color-activity)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          {datapoints.map((entry, index) => {
            const isWeekendDay = isWeekend(entry.date);
            return (
              <Cell
                key={`cell-${index}`}
                fill={isWeekendDay ? WEEKEND_COLOR : "var(--color-activity)"}
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

export function ChartCard({
  children,
  className,
  gradientColor = "blue"
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor?: "blue" | "purple" | "green" | "orange" | "slate",
}) {
  const gradientColors = {
    blue: "from-blue-500/5",
    purple: "from-purple-500/5",
    green: "from-emerald-500/5",
    orange: "from-orange-500/5",
    slate: "from-slate-500/5",
  };

  return (
    <div className={cn(
      "group relative overflow-hidden rounded-xl bg-card border border-border transition-all hover:shadow-md",
      className
    )}>
      <div className={cn(
        "absolute inset-0 bg-gradient-to-br to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none",
        gradientColors[gradientColor]
      )} />
      <div className="relative h-full flex flex-col">
        {children}
      </div>
    </div>
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
    <div className="flex items-center gap-0.5 rounded-md border border-border/40 bg-background/50 p-0.5 backdrop-blur-sm">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onTimeRangeChange(option.value)}
          className={cn(
            "px-2.5 py-1 text-xs font-medium rounded-[4px] transition-all",
            timeRange === option.value
              ? "bg-muted text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
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
  gradientColor?: "blue" | "purple" | "green" | "orange" | "slate",
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

  const activeTabColors = {
    blue: "bg-blue-500",
    purple: "bg-purple-500",
    green: "bg-emerald-500",
    orange: "bg-orange-500",
    slate: "bg-slate-500",
  };

  const activeColorClass = activeTabColors[gradientColor];

  return (
    <ChartCard className="h-full flex flex-col" gradientColor={gradientColor}>
      <div className={cn("flex items-center justify-between border-b border-border/40", compact ? "px-3" : "px-4")}>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setView('chart')}
            className={cn(
              "relative py-3 text-xs font-medium transition-all",
              view === 'chart' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {config.name}
            {view === 'chart' && (
              <div className={cn("absolute bottom-0 left-0 right-0 h-0.5 rounded-full", activeColorClass)} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={cn(
              "relative py-3 text-xs font-medium transition-all",
              view === 'list' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {listTitle}
            {view === 'list' && (
              <div className={cn("absolute bottom-0 left-0 right-0 h-0.5 rounded-full", activeColorClass)} />
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
        <div className={cn("text-xs text-muted-foreground", compact ? "px-3 pt-2" : "px-4 pt-3")}>
          {config.description}
        </div>
      )}

      <div className={cn(compact ? "p-3 pt-2" : "p-4 pt-3", "flex flex-col justify-center flex-1 min-h-0")}>
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
              <div className="space-y-1">
                {listData.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => router.push(`/projects/${projectId}/users/${user.id}`)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left group"
                  >
                    <div className="shrink-0">
                      <UserAvatar
                        user={{
                          profileImageUrl: user.profile_image_url ?? undefined,
                          displayName: user.display_name ?? undefined,
                          primaryEmail: user.primary_email ?? undefined,
                        }}
                        size={28}
                        border
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate text-foreground group-hover:text-primary transition-colors">
                        {user.display_name || user.primary_email || 'Anonymous User'}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1.5">
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
  gradientColor?: "blue" | "purple" | "green" | "orange" | "slate",
  timeRange: TimeRange,
}) {
  const filteredDatapoints = filterDatapointsByTimeRange(datapoints, timeRange);

  return (
    <ChartCard className={className} gradientColor={gradientColor}>
      <div className={compact ? "p-3 pb-2" : "p-4 pb-3"}>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {config.name}
            </span>
            {config.description && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {config.description}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={cn(compact ? "p-3 pt-0" : "p-4 pt-0", "flex-1 min-h-0")}>
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
  gradientColor?: "blue" | "purple" | "green" | "orange" | "slate",
}) {
  const total = datapoints.reduce((sum, d) => sum + d.count, 0);
  const innerRadius = compact ? 40 : 60;
  const outerRadius = compact ? 55 : 85;

  return (
    <ChartCard className={className} gradientColor={gradientColor}>
      <div className={compact ? "p-3 pb-2" : "p-4 pb-3"}>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Auth Methods
            </span>
            {!compact && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Login distribution
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={cn(compact ? "p-3 pt-0" : "p-4 pt-0", "flex-1 min-h-0 flex flex-col")}>
        {datapoints.length === 0 || total === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Typography variant="secondary" className="text-xs text-center">
              No authentication data available
            </Typography>
          </div>
        ) : (
          <div className="flex flex-col items-center w-full h-full justify-center flex-1 min-h-0">
            <ChartContainer
              config={BRAND_CONFIG}
              className="flex w-full items-center justify-center flex-1 min-h-0 pb-2"
              maxHeight={height}
            >
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      className="rounded-xl border border-border/70 bg-background/90 px-3 py-1.5 text-xs shadow-xl backdrop-blur-sm"
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
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: `var(--color-${key})` }}
                            />
                            <span className="text-[0.7rem] font-medium">
                              {label}
                            </span>
                            <span className="font-mono text-[0.7rem] font-semibold tabular-nums">
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
            <div className={cn("flex w-full flex-wrap justify-center gap-2 shrink-0", compact ? "mt-2" : "mt-4")}>
              {datapoints.map((item) => {
                const percentage = total > 0 ? ((item.count / total) * 100).toFixed(0) : 0;
                return (
                  <div
                    key={item.method}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 shadow-sm transition-colors hover:bg-muted/40",
                      compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs"
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: BRAND_CONFIG[item.method as keyof typeof BRAND_CONFIG].color ?? "var(--color-other)" }}
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
