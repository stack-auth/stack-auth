"use client";

import {
  DesignBadge,
  type DesignBadgeColor,
  DesignCard,
  DesignChartCard,
  DesignChartContainer,
  DesignChartTooltipContent,
  getDesignChartColor,
} from "@/components/design-components";
import { Skeleton, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { DataGridColumnDef } from "@stackframe/dashboard-ui-components";
import { ServerUser } from "@stackframe/stack";
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
import { UserPageMetricCard } from "./user-page-metric-card";
import { UserPageTableSection } from "./user-page-table-section";

const ANALYTICS_WINDOW_DAYS = 30;
const TOP_PAGES_LIMIT = 10;
const TOP_REFERRERS_LIMIT = 10;
const RECENT_EVENTS_LIMIT = 50;

// Formats a JS Date as `YYYY-MM-DD HH:MM:SS` UTC - the format ClickHouse
// expects when the query param is typed as `DateTime`. Keeping this
// inline avoids round-tripping through the backend's own DateTime helper.
function toClickhouseDateTimeParam(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// ClickHouse returns UInt64 counts as strings (JS can't safely represent
// every UInt64), so normalize everywhere. Anything we can't parse cleanly
// becomes 0 so the user won't get a phantom NaN in their KPI cards.
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
  page_views: number,
  clicks: number,
  sessions: number,
  last_event_at: string | null,
};

type DailyRow = {
  day: string,
  page_views: number,
  clicks: number,
};

type TopPageRow = {
  path: string,
  views: number,
};

type TopReferrerRow = {
  referrer: string,
  views: number,
};

type RecentEventRow = {
  event_type: string,
  event_at: string,
  path: string | null,
  url: string | null,
  click_text: string | null,
  tag_name: string | null,
};

type AnalyticsData = {
  summary: SummaryRow,
  daily: DailyRow[],
  topPages: TopPageRow[],
  topReferrers: TopReferrerRow[],
  recent: RecentEventRow[],
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready", data: AnalyticsData };

const SUMMARY_QUERY = `
  SELECT
    toString(count()) AS total_events,
    toString(countIf(event_type = '$page-view')) AS page_views,
    toString(countIf(event_type = '$click')) AS clicks,
    toString(uniqExactIf(session_replay_id, session_replay_id IS NOT NULL)) AS sessions,
    CAST(max(event_at), 'Nullable(String)') AS last_event_at
  FROM events
  WHERE user_id = {userId:String}
    AND event_at >= {since:DateTime}
`;

const DAILY_QUERY = `
  SELECT
    toString(toDate(event_at)) AS day,
    toString(countIf(event_type = '$page-view')) AS page_views,
    toString(countIf(event_type = '$click')) AS clicks
  FROM events
  WHERE user_id = {userId:String}
    AND event_at >= {since:DateTime}
    AND event_type IN ('$page-view', '$click')
  GROUP BY day
  ORDER BY day ASC
`;

const TOP_PAGES_QUERY = `
  SELECT
    path,
    toString(count()) AS views
  FROM (
    SELECT
      NULLIF(
        replaceRegexpOne(
          COALESCE(
            NULLIF(CAST(data.path, 'Nullable(String)'), ''),
            NULLIF(CAST(data.url, 'Nullable(String)'), ''),
            ''
          ),
          '[?#].*',
          ''
        ),
        ''
      ) AS path
    FROM events
    WHERE user_id = {userId:String}
      AND event_type = '$page-view'
      AND event_at >= {since:DateTime}
  )
  WHERE path IS NOT NULL
  GROUP BY path
  ORDER BY count() DESC
  LIMIT {limit:UInt32}
`;

const TOP_REFERRERS_QUERY = `
  SELECT
    referrer,
    toString(count()) AS views
  FROM (
    SELECT
      NULLIF(
        replaceRegexpOne(
          COALESCE(NULLIF(CAST(data.referrer, 'Nullable(String)'), ''), ''),
          '[?#].*',
          ''
        ),
        ''
      ) AS referrer
    FROM events
    WHERE user_id = {userId:String}
      AND event_type = '$page-view'
      AND event_at >= {since:DateTime}
  )
  WHERE referrer IS NOT NULL
  GROUP BY referrer
  ORDER BY count() DESC
  LIMIT {limit:UInt32}
`;

const RECENT_EVENTS_QUERY = `
  SELECT
    event_type,
    CAST(event_at, 'String') AS event_at_str,
    NULLIF(
      replaceRegexpOne(
        COALESCE(NULLIF(CAST(data.path, 'Nullable(String)'), ''), ''),
        '[?#].*',
        ''
      ),
      ''
    ) AS path,
    NULLIF(
      replaceRegexpOne(
        COALESCE(NULLIF(CAST(data.url, 'Nullable(String)'), ''), ''),
        '[?#].*',
        ''
      ),
      ''
    ) AS url,
    CAST(data.text, 'Nullable(String)') AS click_text,
    CAST(data.tag_name, 'Nullable(String)') AS tag_name
  FROM events
  WHERE user_id = {userId:String}
    AND event_at >= {since:DateTime}
  ORDER BY event_at DESC
  LIMIT {limit:UInt32}
`;

function parseSummary(rows: Record<string, unknown>[]): SummaryRow {
  // The SUMMARY query has no GROUP BY, so ClickHouse always returns exactly
  // one aggregate row - even when no events match. If that invariant ever
  // breaks we want to know loudly rather than silently render zeroes.
  const row = rows[0] ?? throwErr("SUMMARY_QUERY returned zero rows; expected exactly one aggregate row");
  return {
    total_events: toNumber(row.total_events),
    page_views: toNumber(row.page_views),
    clicks: toNumber(row.clicks),
    sessions: toNumber(row.sessions),
    last_event_at: toStringOrNull(row.last_event_at),
  };
}

function parseDaily(rows: Record<string, unknown>[]): DailyRow[] {
  return rows
    .map((row) => ({
      day: String(row.day ?? ""),
      page_views: toNumber(row.page_views),
      clicks: toNumber(row.clicks),
    }))
    .filter((r) => r.day.length > 0);
}

function parseTopPages(rows: Record<string, unknown>[]): TopPageRow[] {
  const result: TopPageRow[] = [];
  for (const row of rows) {
    const path = toStringOrNull(row.path);
    if (path == null) continue;
    result.push({ path, views: toNumber(row.views) });
  }
  return result;
}

function parseTopReferrers(rows: Record<string, unknown>[]): TopReferrerRow[] {
  const result: TopReferrerRow[] = [];
  for (const row of rows) {
    const referrer = toStringOrNull(row.referrer);
    if (referrer == null) continue;
    result.push({ referrer, views: toNumber(row.views) });
  }
  return result;
}

function parseRecentEvents(rows: Record<string, unknown>[]): RecentEventRow[] {
  return rows.map((row) => ({
    event_type: String(row.event_type ?? ""),
    event_at: String(row.event_at_str ?? ""),
    path: toStringOrNull(row.path),
    url: toStringOrNull(row.url),
    click_text: toStringOrNull(row.click_text),
    tag_name: toStringOrNull(row.tag_name),
  }));
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// "Feb 14" on the axis ticks and "Feb 14, 2026" in the tooltips. Parsing the
// `YYYY-MM-DD` day string as UTC keeps the label aligned with how the backend
// bucketed the row (ClickHouse `toDate(event_at)` is UTC).
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

const EVENT_AT_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatEventAt(eventAt: string): string {
  const asDate = new Date(eventAt.includes("T") ? eventAt : eventAt.replace(" ", "T") + "Z");
  return Number.isNaN(asDate.getTime()) ? eventAt : EVENT_AT_FORMATTER.format(asDate);
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

function eventLabel(event: RecentEventRow): string {
  switch (event.event_type) {
    case "$page-view": {
      return event.path ?? event.url ?? "Page view";
    }
    case "$click": {
      const text = event.click_text?.trim();
      if (text != null && text.length > 0) return text.length > 60 ? text.slice(0, 60) + "..." : text;
      if (event.tag_name != null) return `<${event.tag_name.toLowerCase()}>`;
      return "Click";
    }
    case "$token-refresh": {
      return "Session refresh";
    }
    default: {
      return event.event_type.replace(/^\$/, "");
    }
  }
}

function eventTypeBadge(eventType: string): { label: string, color: DesignBadgeColor } {
  switch (eventType) {
    case "$page-view": {
      return { label: "Page view", color: "blue" };
    }
    case "$click": {
      return { label: "Click", color: "green" };
    }
    case "$token-refresh": {
      return { label: "Refresh", color: "purple" };
    }
    default: {
      const label = eventType.replace(/^\$/, "");
      return { label: label.length > 0 ? label : "Event", color: "blue" };
    }
  }
}

// Re-emits the list of days into a dense, evenly-spaced series covering the
// full window. Without this, sparse days collapse together on the X axis and
// the chart reads "active all month" when really there are only two spikes.
function densifyDaily(daily: DailyRow[]): DailyRow[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const today = new Date();
  const dense: DailyRow[] = [];
  for (let offset = ANALYTICS_WINDOW_DAYS - 1; offset >= 0; offset--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    const day = d.toISOString().slice(0, 10);
    const existing = byDay.get(day);
    dense.push({
      day,
      page_views: existing?.page_views ?? 0,
      clicks: existing?.clicks ?? 0,
    });
  }
  return dense;
}

export function UserAnalyticsSection({ user }: { user: ServerUser }) {
  const stackAdminApp = useAdminApp();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    // Boxed cancellation flag: `let cancelled = false` works but the lint
    // narrower can't see the late mutation in the cleanup function and flags
    // `if (cancelled)` as "always falsy", so we put it on an object.
    const token = { cancelled: false };
    setState({ status: "loading" });

    const since = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const baseParams = {
      userId: user.id,
      since: toClickhouseDateTimeParam(since),
    };

    const runQuery = (query: string, params: Record<string, unknown>) =>
      stackAdminApp.queryAnalytics({ query, params, timeout_ms: 30_000, include_all_branches: false });

    runAsynchronously(async () => {
      const [summaryRes, dailyRes, topPagesRes, topReferrersRes, recentRes] = await Promise.all([
        runQuery(SUMMARY_QUERY, baseParams),
        runQuery(DAILY_QUERY, baseParams),
        runQuery(TOP_PAGES_QUERY, { ...baseParams, limit: TOP_PAGES_LIMIT }),
        runQuery(TOP_REFERRERS_QUERY, { ...baseParams, limit: TOP_REFERRERS_LIMIT }),
        runQuery(RECENT_EVENTS_QUERY, { ...baseParams, limit: RECENT_EVENTS_LIMIT }),
      ]);

      if (token.cancelled) return;

      setState({
        status: "ready",
        data: {
          summary: parseSummary(summaryRes.result),
          daily: parseDaily(dailyRes.result),
          topPages: parseTopPages(topPagesRes.result),
          topReferrers: parseTopReferrers(topReferrersRes.result),
          recent: parseRecentEvents(recentRes.result),
        },
      });
    }, {
      noErrorLogging: true,
      onError: (error) => {
        if (token.cancelled) return;
        // Swallow the underlying error into a generic UI message. The raw
        // message (often a ClickHouse stack) isn't actionable for admins, so
        // we surface a generic message and keep the details in the logs via
        // captureError for on-call triage.
        captureError("user-analytics-query", error);
        setState({ status: "error" });
      },
    });

    return () => {
      token.cancelled = true;
    };
  }, [stackAdminApp, user.id]);

  if (state.status === "loading") {
    return <UserAnalyticsLoading />;
  }

  if (state.status === "error") {
    return <UserAnalyticsError />;
  }

  return <UserAnalyticsLoaded data={state.data} />;
}

function UserAnalyticsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[64px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-[280px] rounded-2xl" />
      <div className="flex flex-col gap-6">
        <Skeleton className="h-[180px] rounded-2xl" />
        <Skeleton className="h-[180px] rounded-2xl" />
        <Skeleton className="h-[220px] rounded-2xl" />
      </div>
    </div>
  );
}

function UserAnalyticsError() {
  return (
    <DesignCard
      title="Analytics unavailable"
      icon={WarningCircleIcon}
    >
      <div className="flex flex-col items-center gap-1 py-8 text-center">
        <p className="text-sm text-muted-foreground">We couldn&apos;t load analytics for this user.</p>
        <p className="text-xs text-muted-foreground/70">Please try again in a moment.</p>
      </div>
    </DesignCard>
  );
}

function UserAnalyticsLoaded({ data }: { data: AnalyticsData }) {
  const hasAnyEvent = data.summary.total_events > 0;
  const lastActive = useMemo(() => {
    const raw = data.summary.last_event_at;
    if (raw == null) return null;
    const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }, [data.summary.last_event_at]);

  const dense = useMemo(() => densifyDaily(data.daily), [data.daily]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <UserPageMetricCard
          label="Total Events"
          value={formatCompact(data.summary.total_events)}
          description={`Last ${ANALYTICS_WINDOW_DAYS} days`}
          gradient="blue"
        />
        <UserPageMetricCard
          label="Page Views"
          value={formatCompact(data.summary.page_views)}
          description={lastActive ? `Last seen ${lastActive.toLocaleDateString()}` : "No recent activity"}
          gradient="cyan"
        />
        <UserPageMetricCard
          label="Clicks"
          value={formatCompact(data.summary.clicks)}
          description={`Across ${ANALYTICS_WINDOW_DAYS}-day window`}
          gradient="green"
        />
        <UserPageMetricCard
          label="Sessions"
          value={formatCompact(data.summary.sessions)}
          description="Recorded replays"
          gradient="purple"
        />
      </div>

      <ActivityChart daily={dense} hasAnyEvent={hasAnyEvent} />

      <div className="flex flex-col gap-6">
        <TopPathsTableSection
          title="Top Pages"
          rows={data.topPages.map((p) => ({ label: p.path, count: p.views }))}
          emptyMessage="No page views yet"
        />
        <TopPathsTableSection
          title="Top Referrers"
          rows={data.topReferrers.map((r) => ({ label: r.referrer, count: r.views }))}
          emptyMessage="No referrer data yet"
        />
        <RecentEventsTableSection events={data.recent} />
      </div>
    </div>
  );
}

function ActivityChart({ daily, hasAnyEvent }: { daily: DailyRow[], hasAnyEvent: boolean }) {
  const pageViewColor = getDesignChartColor(0);
  const clickColor = getDesignChartColor(1);

  const chartConfig = {
    page_views: { label: "Page views", color: pageViewColor },
    clicks: { label: "Clicks", color: clickColor },
  } as const;

  return (
    <DesignChartCard
      gradient="blue"
      title="Daily activity"
      description={`Page views and clicks over the last ${ANALYTICS_WINDOW_DAYS} days`}
    >
      {!hasAnyEvent ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          No events recorded for this user yet.
        </div>
      ) : (
        <DesignChartContainer config={chartConfig} maxHeight={240} className="h-[240px] w-full">
          <AreaChart data={daily} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="user-analytics-pv-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={pageViewColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={pageViewColor} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="user-analytics-click-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={clickColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={clickColor} stopOpacity={0.02} />
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
              dataKey="page_views"
              stroke={pageViewColor}
              strokeWidth={1.5}
              fill="url(#user-analytics-pv-fill)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="clicks"
              stroke={clickColor}
              strokeWidth={1.5}
              fill="url(#user-analytics-click-fill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </DesignChartContainer>
      )}
    </DesignChartCard>
  );
}

type TopPathsTableRow = {
  label: string,
  count: number,
};

function TopPathsTableSection({
  title,
  rows,
  emptyMessage,
}: {
  title: string,
  rows: TopPathsTableRow[],
  emptyMessage: string,
}) {
  const maxCount = rows[0]?.count ?? 0;
  const columns = useMemo<DataGridColumnDef<TopPathsTableRow>[]>(() => [
    {
      id: "label",
      accessor: "label",
      header: "Path",
      width: 280,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => {
        const fillPercent = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
        return (
          <div className="relative -mx-2 flex w-[calc(100%+1rem)] items-center overflow-hidden rounded-lg px-2 py-1.5">
            <div
              className="absolute inset-y-0 left-0 rounded-lg bg-blue-500/10 dark:bg-blue-400/10"
              style={{ width: `${fillPercent}%` }}
              aria-hidden
            />
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <span className="relative truncate text-xs text-foreground">
                  {row.label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[360px] break-all">
                {row.label}
              </TooltipContent>
            </Tooltip>
          </div>
        );
      },
    },
    {
      id: "count",
      accessor: "count",
      header: "Views",
      width: 110,
      align: "right",
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm font-medium tabular-nums text-foreground">
          {row.count.toLocaleString()}
        </span>
      ),
    },
  ], [maxCount]);

  return (
    <UserPageTableSection
      title={title}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.label}
      emptyLabel={emptyMessage}
    />
  );
}

type RecentEventTableRow = RecentEventRow & {
  id: string,
};

function RecentEventsTableSection({ events }: { events: RecentEventRow[] }) {
  const rows = useMemo<RecentEventTableRow[]>(
    () => events.map((event, index) => ({ ...event, id: `${event.event_at}-${index}` })),
    [events],
  );
  const columns = useMemo<DataGridColumnDef<RecentEventTableRow>[]>(() => [
    {
      id: "event_type",
      accessor: "event_type",
      header: "Event",
      width: 140,
      sortable: false,
      renderCell: ({ row }) => {
        const badge = eventTypeBadge(row.event_type);
        return <DesignBadge label={badge.label} color={badge.color} size="sm" />;
      },
    },
    {
      id: "label",
      header: "Detail",
      width: 280,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="truncate text-sm text-foreground">{eventLabel(row)}</span>
      ),
    },
    {
      id: "event_at",
      accessor: "event_at",
      header: "Time",
      width: 150,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatEventAt(row.event_at)}
        </span>
      ),
    },
  ], []);

  return (
    <UserPageTableSection
      title="Recent activity"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      emptyLabel="No recent events for this user."
    />
  );
}
