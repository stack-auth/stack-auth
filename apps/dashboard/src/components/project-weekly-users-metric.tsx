'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { useId } from 'react';

type DataPoint = { date: string, activity: number };
type ChartDataPoint = DataPoint & {
  completeActivity: number | null,
  incompleteActivity: number | null,
};

const CHART_HEIGHT = 56;
const EMPTY_BASELINE_COUNT = 30;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

function getTodayUtcDateKey(): string {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today.toISOString().split("T")[0];
}

function toChartData(data: DataPoint[]): ChartDataPoint[] {
  const todayKey = getTodayUtcDateKey();
  const firstIncompleteIndex = data.findIndex((point) => point.date >= todayKey);

  return data.map((point, index) => ({
    ...point,
    completeActivity: firstIncompleteIndex === -1 || index < firstIncompleteIndex ? point.activity : null,
    incompleteActivity: firstIncompleteIndex !== -1 && index >= Math.max(0, firstIncompleteIndex - 1) ? point.activity : null,
  }));
}

function EmptyBaseline({ count }: { count: number }) {
  return (
    <svg
      viewBox={`0 0 ${Math.max(count - 1, 1)} 10`}
      preserveAspectRatio="none"
      className="absolute inset-x-0 bottom-0 h-5 w-full text-foreground/20"
      aria-hidden="true"
    >
      <line
        x1="0"
        x2={Math.max(count - 1, 1)}
        y1="5"
        y2="5"
        stroke="currentColor"
        strokeWidth="0.15"
        strokeDasharray="0.4 0.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function ProjectWeeklyUsersMetric(props: {
  weeklyUsers: number | undefined,
  data: DataPoint[] | undefined,
  loading?: boolean,
  error?: boolean,
}) {
  const weeklyUsers = props.weeklyUsers ?? 0;
  const data = props.data;
  const dailyTotal = data?.reduce((sum, d) => sum + d.activity, 0) ?? 0;
  const hasActivity = weeklyUsers > 0 || dailyTotal > 0;
  const gradId = useId().replace(/:/g, '');

  if (props.loading && props.weeklyUsers === undefined) {
    return (
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
        <div className="absolute left-0 top-0 z-10 flex items-baseline gap-1">
          <span className="h-[18px] w-10 animate-pulse rounded bg-foreground/10" aria-hidden="true" />
          <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">
            users/wk
          </span>
        </div>
        <EmptyBaseline count={EMPTY_BASELINE_COUNT} />
      </div>
    );
  }

  if (props.error && props.weeklyUsers === undefined) {
    return (
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
        <div className="absolute left-0 top-0 z-10 flex items-baseline gap-1">
          <span className="text-lg font-semibold tabular-nums leading-none text-muted-foreground/50">
            —
          </span>
          <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">
            users/wk
          </span>
        </div>
        <span className="absolute right-0 top-0 text-[9px] uppercase tracking-[0.14em] text-destructive/80">
          Failed to load
        </span>
        <EmptyBaseline count={EMPTY_BASELINE_COUNT} />
      </div>
    );
  }

  const chartData = data ? toChartData(data) : undefined;

  return (
    <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
      <div className="absolute left-0 top-0 z-10 flex items-baseline gap-1">
        <span
          className={
            'text-lg font-semibold tabular-nums leading-none ' +
            (hasActivity ? 'text-foreground' : 'text-muted-foreground/50')
          }
        >
          {weeklyUsers.toLocaleString()}
        </span>
        <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">
          users/wk
        </span>
      </div>

      {hasActivity && chartData ? (
        <div className="absolute inset-0 text-foreground/80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 22, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <defs>
                <linearGradient id={`weekly-users-fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={{ stroke: 'currentColor', strokeOpacity: 0.2, strokeDasharray: '2 3' }}
                contentStyle={{
                  background: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 6,
                  fontSize: 11,
                  padding: '4px 8px',
                  boxShadow: '0 6px 20px -10px rgb(0 0 0 / 0.3)',
                }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: 1, fontSize: 10 }}
                itemStyle={{ color: 'hsl(var(--foreground))', padding: 0 }}
                labelFormatter={(label: string) => formatDay(label)}
                formatter={(value: number, name: string) => [
                  value.toLocaleString(),
                  name,
                ]}
              />
              <Area
                type="monotone"
                dataKey="completeActivity"
                name="daily active users"
                stroke="currentColor"
                strokeWidth={1.5}
                fill={`url(#weekly-users-fill-${gradId})`}
                isAnimationActive={false}
                activeDot={{ r: 2.5, strokeWidth: 0, fill: 'currentColor' }}
              />
              <Area
                type="monotone"
                dataKey="incompleteActivity"
                name="daily active users (incomplete day)"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                fill="transparent"
                isAnimationActive={false}
                activeDot={{ r: 2.5, strokeWidth: 0, fill: 'currentColor' }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyBaseline count={data?.length ?? EMPTY_BASELINE_COUNT} />
      )}
    </div>
  );
}
