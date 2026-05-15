"use client";

import {
  DesignCard,
  DesignChartCard,
  DesignChartContainer,
  DesignChartTooltipContent,
  getDesignChartColor,
} from "@/components/design-components";
import { Avatar, AvatarFallback, AvatarImage, Skeleton, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { DataGridColumnDef } from "@stackframe/dashboard-ui-components";
import { ServerTeam, ServerUser } from "@stackframe/stack";
import { captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAdminApp } from "../../use-admin-app";
import { UserPageMetricCard } from "../../users/[userId]/user-page-metric-card";
import { UserPageTableSection } from "../../users/[userId]/user-page-table-section";

const ANALYTICS_WINDOW_DAYS = 30;
const HEATMAP_WINDOW_DAYS = 28; // 4 full weeks — clean weekly average
const HEATMAP_WEEKS = HEATMAP_WINDOW_DAYS / 7;
const TOP_CONTRIBUTORS_LIMIT = 10;

function toClickhouseDateTimeParam(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

type SummaryRow = {
  total_events: number,
  active_users_30d: number,
  active_users_7d: number,
  last_event_at: string | null,
  prev_total_events: number,
  prev_active_users_30d: number,
  prev_active_users_7d: number,
};

type DauRow = {
  day: string,
  active_users: number,
  events: number,
};

type HeatmapRow = {
  // ClickHouse `toDayOfWeek` returns 1=Mon..7=Sun
  dow: number,
  hour: number,
  active_users: number,
};

type ContributorRow = {
  user_id: string,
  events: number,
  active_days: number,
  last_event_at: string | null,
};

type AnalyticsData = {
  summary: SummaryRow,
  dau: DauRow[],
  heatmap: HeatmapRow[],
  contributors: ContributorRow[],
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready", data: AnalyticsData };

// Team events aren't tagged with team_id; scope by member user_ids.
const SUMMARY_QUERY = `
  SELECT
    toString(countIf(event_at >= {since:DateTime})) AS total_events,
    toString(uniqExactIf(user_id, user_id IS NOT NULL AND event_at >= {since:DateTime})) AS active_users_30d,
    toString(uniqExactIf(user_id, user_id IS NOT NULL AND event_at >= {since7d:DateTime})) AS active_users_7d,
    toString(countIf(event_at < {since:DateTime})) AS prev_total_events,
    toString(uniqExactIf(user_id, user_id IS NOT NULL AND event_at >= {prevSince:DateTime} AND event_at < {since:DateTime})) AS prev_active_users_30d,
    toString(uniqExactIf(user_id, user_id IS NOT NULL AND event_at >= {prev7dSince:DateTime} AND event_at < {since7d:DateTime})) AS prev_active_users_7d,
    CAST(maxIf(event_at, event_at >= {since:DateTime}), 'Nullable(String)') AS last_event_at
  FROM events
  WHERE user_id IN {memberIds:Array(String)}
    AND event_at >= {prevSince:DateTime}
    AND event_at < {until:DateTime}
`;

const DAU_QUERY = `
  SELECT
    toString(toDate(event_at)) AS day,
    toString(uniqExact(user_id)) AS active_users,
    toString(count()) AS events
  FROM events
  WHERE user_id IN {memberIds:Array(String)}
    AND event_at >= {since:DateTime}
    AND event_at < {until:DateTime}
  GROUP BY day
  ORDER BY day ASC
`;

const HEATMAP_QUERY = `
  SELECT
    toDayOfWeek(event_at) AS dow,
    toHour(event_at) AS hour,
    toString(uniqExact(user_id)) AS active_users
  FROM events
  WHERE user_id IN {memberIds:Array(String)}
    AND event_at >= {since:DateTime}
    AND event_at < {until:DateTime}
  GROUP BY dow, hour
`;

const TOP_CONTRIBUTORS_QUERY = `
  SELECT
    user_id,
    toString(count()) AS events,
    toString(uniqExact(toDate(event_at))) AS active_days,
    CAST(max(event_at), 'Nullable(String)') AS last_event_at
  FROM events
  WHERE user_id IN {memberIds:Array(String)}
    AND event_at >= {since:DateTime}
    AND event_at < {until:DateTime}
  GROUP BY user_id
  ORDER BY count() DESC
  LIMIT {limit:UInt32}
`;

function parseSummary(rows: Record<string, unknown>[]): SummaryRow {
  const row = rows[0] ?? throwErr("SUMMARY_QUERY returned zero rows; expected exactly one aggregate row");
  return {
    total_events: toNumber(row.total_events),
    active_users_30d: toNumber(row.active_users_30d),
    active_users_7d: toNumber(row.active_users_7d),
    last_event_at: toStringOrNull(row.last_event_at),
    prev_total_events: toNumber(row.prev_total_events),
    prev_active_users_30d: toNumber(row.prev_active_users_30d),
    prev_active_users_7d: toNumber(row.prev_active_users_7d),
  };
}

function parseDau(rows: Record<string, unknown>[]): DauRow[] {
  return rows
    .map((row) => ({
      day: String(row.day ?? ""),
      active_users: toNumber(row.active_users),
      events: toNumber(row.events),
    }))
    .filter((r) => r.day.length > 0);
}

function parseHeatmap(rows: Record<string, unknown>[]): HeatmapRow[] {
  const result: HeatmapRow[] = [];
  for (const row of rows) {
    const dow = toNumber(row.dow);
    const hour = toNumber(row.hour);
    if (dow < 1 || dow > 7 || hour < 0 || hour > 23) continue;
    result.push({ dow, hour, active_users: toNumber(row.active_users) });
  }
  return result;
}

function parseContributors(rows: Record<string, unknown>[]): ContributorRow[] {
  const result: ContributorRow[] = [];
  for (const row of rows) {
    const userId = toStringOrNull(row.user_id);
    if (userId == null) continue;
    result.push({
      user_id: userId,
      events: toNumber(row.events),
      active_days: toNumber(row.active_days),
      last_event_at: toStringOrNull(row.last_event_at),
    });
  }
  return result;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

const DAY_LABEL_SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const DAY_LABEL_LONG = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function parseDayUtc(day: string): Date | null {
  const parts = day.split("-").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function formatDayShort(day: string): string {
  const date = parseDayUtc(day);
  return date ? DAY_LABEL_SHORT.format(date) : day;
}

function formatDayLong(day: string): string {
  const date = parseDayUtc(day);
  return date ? DAY_LABEL_LONG.format(date) : day;
}

function getTooltipDay(payload: readonly unknown[]): string | null {
  for (const item of payload) {
    if (typeof item !== "object" || item === null || !("payload" in item)) continue;
    const row = item.payload;
    if (typeof row !== "object" || row === null || !("day" in row)) continue;
    if (typeof row.day === "string") return row.day;
  }
  return null;
}

function densifyDau(dau: DauRow[], range: { startUtc: Date, endUtcInclusive: Date }): DauRow[] {
  const byDay = new Map(dau.map((d) => [d.day, d]));
  const dense: DauRow[] = [];
  const cursor = new Date(Date.UTC(
    range.startUtc.getUTCFullYear(),
    range.startUtc.getUTCMonth(),
    range.startUtc.getUTCDate(),
  ));
  const end = Date.UTC(
    range.endUtcInclusive.getUTCFullYear(),
    range.endUtcInclusive.getUTCMonth(),
    range.endUtcInclusive.getUTCDate(),
  );
  while (cursor.getTime() <= end) {
    const day = cursor.toISOString().slice(0, 10);
    const existing = byDay.get(day);
    dense.push({
      day,
      active_users: existing?.active_users ?? 0,
      events: existing?.events ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dense;
}

export function TeamAnalyticsSection({ team }: { team: ServerTeam }) {
  const stackAdminApp = useAdminApp();
  const members = team.useUsers();
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const memberIdsKey = useMemo(() => memberIds.join(","), [memberIds]);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const token = { cancelled: false };
    setState({ status: "loading" });

    if (memberIds.length === 0) {
      setState({
        status: "ready",
        data: {
          summary: {
            total_events: 0,
            active_users_30d: 0,
            active_users_7d: 0,
            last_event_at: null,
            prev_total_events: 0,
            prev_active_users_30d: 0,
            prev_active_users_7d: 0,
          },
          dau: [],
          heatmap: [],
          contributors: [],
        },
      });
      return;
    }

    const now = new Date();
    const since = new Date(now.getTime() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const heatmapSince = new Date(now.getTime() - HEATMAP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const prevSince = new Date(since.getTime() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const prev7dSince = new Date(since7d.getTime() - 7 * 24 * 60 * 60 * 1000);
    const baseParams = {
      memberIds,
      since: toClickhouseDateTimeParam(since),
      until: toClickhouseDateTimeParam(now),
    };

    const runQuery = (query: string, params: Record<string, unknown>) =>
      stackAdminApp.queryAnalytics({ query, params, timeout_ms: 30_000, include_all_branches: false });

    const emptySummary: SummaryRow = {
      total_events: 0,
      active_users_30d: 0,
      active_users_7d: 0,
      last_event_at: null,
      prev_total_events: 0,
      prev_active_users_30d: 0,
      prev_active_users_7d: 0,
    };

    runAsynchronously(async () => {
      const results = await Promise.allSettled([
        runQuery(SUMMARY_QUERY, {
          ...baseParams,
          since7d: toClickhouseDateTimeParam(since7d),
          prevSince: toClickhouseDateTimeParam(prevSince),
          prev7dSince: toClickhouseDateTimeParam(prev7dSince),
        }),
        runQuery(DAU_QUERY, baseParams),
        runQuery(HEATMAP_QUERY, {
          memberIds,
          since: toClickhouseDateTimeParam(heatmapSince),
          until: toClickhouseDateTimeParam(now),
        }),
        runQuery(TOP_CONTRIBUTORS_QUERY, { ...baseParams, limit: TOP_CONTRIBUTORS_LIMIT }),
      ]);

      if (token.cancelled) return;

      const queryNames = ["summary", "dau", "heatmap", "contributors"] as const;
      for (const [i, res] of results.entries()) {
        if (res.status === "rejected") {
          captureError(`team-analytics-query:${queryNames[i]}`, res.reason);
        }
      }
      if (results.every((r) => r.status === "rejected")) {
        setState({ status: "error" });
        return;
      }

      const [summaryRes, dauRes, heatmapRes, contributorsRes] = results;

      setState({
        status: "ready",
        data: {
          summary: summaryRes.status === "fulfilled" ? parseSummary(summaryRes.value.result) : emptySummary,
          dau: dauRes.status === "fulfilled" ? parseDau(dauRes.value.result) : [],
          heatmap: heatmapRes.status === "fulfilled" ? parseHeatmap(heatmapRes.value.result) : [],
          contributors: contributorsRes.status === "fulfilled" ? parseContributors(contributorsRes.value.result) : [],
        },
      });
    }, {
      noErrorLogging: true,
      onError: (error) => {
        if (token.cancelled) return;
        captureError("team-analytics-query", error);
        setState({ status: "error" });
      },
    });

    return () => {
      token.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dependency on serialized member IDs, not referential equality
  }, [stackAdminApp, team.id, memberIdsKey]);

  return (
    <div className="flex flex-col gap-4">
      {state.status === "loading" ? (
        <TeamAnalyticsLoading />
      ) : state.status === "error" ? (
        <TeamAnalyticsError />
      ) : (
        <TeamAnalyticsLoaded data={state.data} members={members} />
      )}
    </div>
  );
}

function TeamAnalyticsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[64px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-[260px] rounded-2xl" />
      <Skeleton className="h-[280px] rounded-2xl" />
      <Skeleton className="h-[220px] rounded-2xl" />
    </div>
  );
}

function TeamAnalyticsError() {
  return (
    <DesignCard
      title="Analytics unavailable"
      icon={WarningCircleIcon}
    >
      <div className="flex flex-col items-center gap-1 py-8 text-center">
        <p className="text-sm text-muted-foreground">We couldn&apos;t load analytics for this team.</p>
        <p className="text-xs text-muted-foreground/70">Please try again in a moment.</p>
      </div>
    </DesignCard>
  );
}

function TeamAnalyticsLoaded({ data, members }: { data: AnalyticsData, members: readonly ServerUser[] }) {
  const hasAnyEvent = data.summary.total_events > 0;
  const lastActive = useMemo(() => {
    const raw = data.summary.last_event_at;
    if (raw == null) return null;
    const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }, [data.summary.last_event_at]);

  const dense = useMemo(() => {
    const now = new Date();
    const startUtc = new Date(now.getTime() - (ANALYTICS_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
    return densifyDau(data.dau, { startUtc, endUtcInclusive: now });
  }, [data.dau]);

  const memberCount = members.length;
  const activePct7d = memberCount > 0 ? Math.round((data.summary.active_users_7d / memberCount) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <UserPageMetricCard
          label="Members"
          value={formatCompact(memberCount)}
          description="In this team"
          gradient="blue"
        />
        <UserPageMetricCard
          label="Active (7d)"
          value={formatCompact(data.summary.active_users_7d)}
          description={memberCount > 0 ? `${activePct7d}% of members` : "Last 7 days"}
          gradient="green"
          delta={{
            current: data.summary.active_users_7d,
            previous: data.summary.prev_active_users_7d,
            comparisonLabel: "vs. previous 7 days",
          }}
        />
        <UserPageMetricCard
          label="Active (30d)"
          value={formatCompact(data.summary.active_users_30d)}
          description={`Last ${ANALYTICS_WINDOW_DAYS} days`}
          gradient="cyan"
          delta={{
            current: data.summary.active_users_30d,
            previous: data.summary.prev_active_users_30d,
            comparisonLabel: `vs. previous ${ANALYTICS_WINDOW_DAYS} days`,
          }}
        />
        <UserPageMetricCard
          label="Total events"
          value={formatCompact(data.summary.total_events)}
          description={lastActive ? `Last seen ${lastActive.toLocaleDateString()}` : "No recent activity"}
          gradient="purple"
          delta={{
            current: data.summary.total_events,
            previous: data.summary.prev_total_events,
            comparisonLabel: `vs. previous ${ANALYTICS_WINDOW_DAYS} days`,
          }}
        />
      </div>

      <HourOfWeekHeatmap rows={data.heatmap} hasAnyEvent={hasAnyEvent} />

      <DauChart dau={dense} hasAnyEvent={hasAnyEvent} />

      <TopContributorsTable contributors={data.contributors} members={members} />
    </div>
  );
}

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOUR_AXIS_TICKS = [0, 4, 8, 12, 16, 20] as const;

function HourOfWeekHeatmap({ rows, hasAnyEvent }: { rows: HeatmapRow[], hasAnyEvent: boolean }) {
  const { grid, max } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    let m = 0;
    for (const row of rows) {
      const dowIdx = row.dow - 1;
      if (dowIdx < 0 || dowIdx > 6) continue;
      const value = row.active_users;
      g[dowIdx][row.hour] = value;
      if (value > m) m = value;
    }
    return { grid: g, max: m };
  }, [rows]);

  return (
    <DesignChartCard
      gradient="green"
      title="Active users by hour of week"
      description={`Distinct active users per hour over the last ${HEATMAP_WEEKS} weeks (UTC)`}
    >
      {!hasAnyEvent ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          No events recorded for this team yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-stretch gap-2">
            <div className="flex w-9 shrink-0 flex-col justify-around pt-[18px] pb-1 text-[11px] font-medium text-muted-foreground">
              {DOW_LABELS.map((d) => (
                <span key={d} className="leading-none">{d}</span>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div
                className="grid text-[10px] text-muted-foreground/70"
                style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="text-center leading-none">
                    {HOUR_AXIS_TICKS.includes(h as typeof HOUR_AXIS_TICKS[number]) ? h : ""}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-[3px]">
                {DOW_LABELS.map((dayLabel, dowIdx) => (
                  <div
                    key={dayLabel}
                    className="grid gap-[3px]"
                    style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
                  >
                    {grid[dowIdx].map((value, hour) => {
                      const intensity = max > 0 ? value / max : 0;
                      return (
                        <Tooltip key={hour} delayDuration={100}>
                          <TooltipTrigger asChild>
                            <div
                              className="aspect-square w-full rounded-[3px] border border-foreground/[0.04] bg-emerald-500 transition-opacity"
                              style={{ opacity: value === 0 ? 0.06 : 0.18 + intensity * 0.82 }}
                              aria-label={`${dayLabel} ${hour}:00 — ${value.toFixed(1)} active users`}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            <div className="font-medium">{dayLabel} · {hour.toString().padStart(2, "0")}:00</div>
                            <div className="text-muted-foreground">
                              {value === 0
                                ? "No active users"
                                : `${value.toFixed(value < 10 ? 1 : 0)} active users over ${HEATMAP_WEEKS} weeks`}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <HeatmapLegend max={max} />
        </div>
      )}
    </DesignChartCard>
  );
}

function HeatmapLegend({ max }: { max: number }) {
  if (max <= 0) return null;
  const stops = [0.0, 0.25, 0.5, 0.75, 1.0];
  return (
    <div className="flex items-center justify-end gap-2 pt-2 text-[11px] text-muted-foreground">
      <span>0</span>
      <div className="flex h-3 w-32 overflow-hidden rounded-sm">
        {stops.map((s) => (
          <div
            key={s}
            className="flex-1 bg-emerald-500"
            style={{ opacity: s === 0 ? 0.06 : 0.18 + s * 0.82 }}
          />
        ))}
      </div>
      <span>{max < 10 ? max.toFixed(1) : Math.round(max)}</span>
    </div>
  );
}

function DauChart({ dau, hasAnyEvent }: { dau: DauRow[], hasAnyEvent: boolean }) {
  const usersColor = getDesignChartColor(0);
  const eventsColor = getDesignChartColor(1);

  const chartConfig = {
    active_users: { label: "Active users", color: usersColor },
    events: { label: "Events", color: eventsColor },
  } as const;

  return (
    <DesignChartCard
      gradient="blue"
      title="Daily activity"
      description={`Active users and events per day over the last ${ANALYTICS_WINDOW_DAYS} days`}
    >
      {!hasAnyEvent ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          No events recorded for this team yet.
        </div>
      ) : (
        <DesignChartContainer config={chartConfig} maxHeight={240} className="h-[240px] w-full">
          <AreaChart data={dau} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="team-dau-users-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={usersColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={usersColor} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="team-dau-events-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={eventsColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={eventsColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tickFormatter={formatDayShort}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={28}
            />
            <RechartsTooltip
              cursor={{ stroke: "hsl(var(--border))" }}
              content={
                <DesignChartTooltipContent
                  labelFormatter={(_label, payload) => {
                    const day = getTooltipDay(payload);
                    return day === null ? "" : formatDayLong(day);
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              type="monotone"
              dataKey="active_users"
              stroke={usersColor}
              strokeWidth={1.5}
              fill="url(#team-dau-users-fill)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="events"
              stroke={eventsColor}
              strokeWidth={1.5}
              fill="url(#team-dau-events-fill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </DesignChartContainer>
      )}
    </DesignChartCard>
  );
}

type ContributorTableRow = {
  id: string,
  user: ServerUser | null,
  fallbackId: string,
  events: number,
  active_days: number,
};

function TopContributorsTable({
  contributors,
  members,
}: {
  contributors: ContributorRow[],
  members: readonly ServerUser[],
}) {
  const memberMap = useMemo(() => {
    const m = new Map<string, ServerUser>();
    for (const u of members) m.set(u.id, u);
    return m;
  }, [members]);

  const rows = useMemo<ContributorTableRow[]>(
    () => contributors.map((c) => ({
      id: c.user_id,
      user: memberMap.get(c.user_id) ?? null,
      fallbackId: c.user_id,
      events: c.events,
      active_days: c.active_days,
    })),
    [contributors, memberMap],
  );

  const maxEvents = rows[0]?.events ?? 0;

  const columns = useMemo<DataGridColumnDef<ContributorTableRow>[]>(() => [
    {
      id: "user",
      header: "Member",
      width: 280,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => {
        const fillPercent = maxEvents > 0 ? (row.events / maxEvents) * 100 : 0;
        const name = row.user?.displayName || row.user?.primaryEmail || row.fallbackId;
        const sub = row.user?.primaryEmail && row.user.displayName ? row.user.primaryEmail : null;
        return (
          <div className="relative -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5">
            <div
              className="absolute inset-y-0 left-0 rounded-lg bg-blue-500/10 dark:bg-blue-400/10"
              style={{ width: `${fillPercent}%` }}
              aria-hidden
            />
            <Avatar className="relative h-6 w-6 shrink-0">
              <AvatarImage src={row.user?.profileImageUrl ?? undefined} alt={name} />
              <AvatarFallback className="text-[10px]">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="relative flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium text-foreground">{name}</span>
              {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
            </div>
          </div>
        );
      },
    },
    {
      id: "active_days",
      accessor: "active_days",
      header: "Active days",
      width: 110,
      align: "right",
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {row.active_days.toLocaleString()}
        </span>
      ),
    },
    {
      id: "events",
      accessor: "events",
      header: "Events",
      width: 110,
      align: "right",
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm font-medium tabular-nums text-foreground">
          {row.events.toLocaleString()}
        </span>
      ),
    },
  ], [maxEvents]);

  return (
    <UserPageTableSection
      title="Top contributors"
      urlStateKey="contributors"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      emptyLabel="No member activity in this window."
    />
  );
}
