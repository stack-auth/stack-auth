'use client';

import { AppIcon } from "@/components/app-square";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import { cn, Typography } from "@/components/ui";
import { ALL_APPS_FRONTEND, type AppId, getAppPath } from "@/lib/apps-frontend";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { DesignListItemRow } from "@/components/design-components/list";
import { CompassIcon, EnvelopeIcon, EnvelopeOpenIcon, GlobeIcon, SquaresFourIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import useResizeObserver from '@react-hook/resize-observer';
import { useUser } from "@stackframe/stack";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp, useProjectId } from "../use-admin-app";
import { GlobeSectionWithData } from "./globe-section-with-data";
import {
  ActivityBarChart,
  ChartCard,
  ComposedAnalyticsChart,
  ComposedDataPoint,
  DataPoint,
  DonutChartDisplay,
  filterDatapointsByTimeRange,
  GradientColor,
  LineChartDisplayConfig,
  TabbedMetricsCard,
  TimeRange,
  TimeRangeToggle,
} from "./line-chart";
import { MetricsLoadingFallback } from "./metrics-loading";

// ── Chart configs ────────────────────────────────────────────────────────────

const dailySignUpsConfig: LineChartDisplayConfig = {
  name: 'Daily Sign-Ups',
  chart: {
    activity: {
      label: "Sign-Ups",
      theme: { light: "hsl(221, 83%, 53%)", dark: "hsl(240, 71%, 70%)" },
    },
  },
};

const dailyEmailsConfig: LineChartDisplayConfig = {
  name: 'Emails Sent',
  chart: {
    activity: {
      label: "Emails",
      theme: { light: "hsl(38, 92%, 50%)", dark: "hsl(38, 92%, 65%)" },
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function sumRange(points: DataPoint[], range: TimeRange): number {
  return filterDatapointsByTimeRange(points, range).reduce((s, p) => s + p.activity, 0);
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ── Compact dual-value stat card ─────────────────────────────────────────────

function DualStatCard({
  label,
  value,
  subLabel,
  subValue,
  gradientColor = "blue",
}: {
  label: string,
  value: string | number,
  subLabel: string,
  subValue: string | number,
  gradientColor?: GradientColor,
}) {
  return (
    <ChartCard gradientColor={gradientColor}>
      <div className="p-4 flex flex-col gap-1.5 h-full justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
          {label}
        </span>
        <div>
          <div className="text-2xl font-bold tabular-nums text-foreground leading-none">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
            <span>{subLabel}</span>
            <span className="font-semibold text-foreground tabular-nums">
              {typeof subValue === 'number' ? subValue.toLocaleString() : subValue}
            </span>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

// ── Hero analytics widget (stat pills + composed bar+line chart) ─────────────

type AnalyticsStatPill = {
  label: string,
  value: string,
  delta?: number,
};

function StatPill({ stat }: { stat: AnalyticsStatPill }) {
  return (
    <div className="flex flex-col items-center min-w-0">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {stat.label}
      </span>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-base font-bold tabular-nums text-foreground leading-tight">
          {stat.value}
        </span>
        {stat.delta != null && (
          <span className={cn(
            "text-[10px] font-medium tabular-nums leading-none shrink-0",
            stat.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : stat.delta < 0 ? "text-red-500 dark:text-red-400" : "text-muted-foreground"
          )}>
            {stat.delta > 0 ? "+" : ""}{stat.delta}%
          </span>
        )}
      </div>
    </div>
  );
}

function HeroAnalyticsWidget({
  composedData,
  stats,
  compact = false,
}: {
  composedData: ComposedDataPoint[],
  stats: AnalyticsStatPill[],
  compact?: boolean,
}) {
  return (
    <ChartCard gradientColor="blue">
      <div className="flex flex-col h-full">
        {/* Stat pills row */}
        <div className="grid grid-cols-3 border-b border-foreground/[0.05] divide-x divide-foreground/[0.05]">
          {stats.map((stat) => (
            <div key={stat.label} className={cn(
              "flex flex-col items-center text-center",
              compact ? "px-4 py-2.5" : "px-5 py-3",
            )}>
              <StatPill stat={stat} />
            </div>
          ))}
        </div>

        {/* Legend + chart */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className={cn(
            "flex-1 min-h-0",
            compact ? "px-3 pt-1 pb-2" : "px-4 pt-2 pb-3"
          )}>
            {composedData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Typography variant="secondary" className="text-xs">No data available</Typography>
              </div>
            ) : (
              <ComposedAnalyticsChart
                datapoints={composedData}
                compact={compact}
              />
            )}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

// ── Tabbed DAU stacked chart + recently active list ──────────────────────────

// ── Email list row ────────────────────────────────────────────────────────────

type EmailItem = { id: string, subject: string, status: string };

const emailStatusConfig = new Map<string, {
  label: string,
  icon: React.ElementType,
  bg: string,
  text: string,
  dot: string,
}>([
  ['sent',         { label: 'Sent',       icon: EnvelopeIcon,      bg: 'bg-blue-500/10 dark:bg-blue-500/15',    text: 'text-blue-600 dark:text-blue-400',    dot: 'bg-blue-500' }],
  ['opened',       { label: 'Opened',     icon: EnvelopeOpenIcon,  bg: 'bg-emerald-500/10 dark:bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' }],
  ['delivered',    { label: 'Delivered',  icon: EnvelopeIcon,      bg: 'bg-emerald-500/10 dark:bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' }],
  ['bounced',      { label: 'Bounced',    icon: XCircleIcon,       bg: 'bg-red-500/10 dark:bg-red-500/15',      text: 'text-red-600 dark:text-red-400',      dot: 'bg-red-500' }],
  ['error',        { label: 'Error',      icon: WarningCircleIcon, bg: 'bg-amber-500/10 dark:bg-amber-500/15',  text: 'text-amber-600 dark:text-amber-400',  dot: 'bg-amber-500' }],
  ['in_progress',  { label: 'Sending',    icon: EnvelopeIcon,      bg: 'bg-sky-500/10 dark:bg-sky-500/15',      text: 'text-sky-600 dark:text-sky-400',      dot: 'bg-sky-400' }],
]);

const fallbackEmailStatus = { label: 'Unknown', icon: EnvelopeIcon, bg: 'bg-foreground/[0.06]', text: 'text-muted-foreground', dot: 'bg-muted-foreground' };

function EmailListRow({ email }: { email: EmailItem }) {
  const key = email.status.toLowerCase().replace(/\s+/g, '_');
  const cfg = emailStatusConfig.get(key) ?? fallbackEmailStatus;
  const StatusIcon = cfg.icon;

  return (
    <div className="flex items-center gap-3 px-1 py-2.5 group">
      {/* Icon badge */}
      <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", cfg.bg)}>
        <StatusIcon className={cn("h-3.5 w-3.5", cfg.text)} weight="fill" />
      </div>

      {/* Subject */}
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium truncate text-foreground leading-tight">
          {email.subject}
        </div>
      </div>

      {/* Status pill */}
      <div className={cn(
        "shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        cfg.bg, cfg.text
      )}>
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dot)} />
        {cfg.label}
      </div>
    </div>
  );
}

// ── Tabbed Emails card (bar chart + recent list) ─────────────────────────────

function TabbedEmailsCard({
  chartData,
  recentEmails,
  timeRange,
  compact = false,
}: {
  chartData: DataPoint[],
  recentEmails: Array<{ id: string, subject: string, status: string }>,
  timeRange: TimeRange,
  compact?: boolean,
}) {
  const [view, setView] = useState<'chart' | 'list'>('chart');
  const filteredDatapoints = filterDatapointsByTimeRange(chartData, timeRange);

  const activeTabColor = "bg-orange-500 dark:bg-[hsl(240,71%,70%)]";

  return (
    <ChartCard gradientColor="orange" className="h-full min-h-0 flex flex-col">
      <div className={cn("flex items-center justify-between border-b border-foreground/[0.05]", compact ? "px-4" : "px-5")}>
        <div className="flex items-center gap-1">
          {(['chart', 'list'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setView(tab)}
              className={cn(
                "relative px-3 py-3.5 text-xs font-medium transition-all duration-150 hover:transition-none rounded-t-lg",
                view === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === 'chart' ? 'Emails Sent' : 'Recent Emails'}
              {view === tab && (
                <div className={cn("absolute bottom-0 left-3 right-3 h-0.5 rounded-full", activeTabColor)} />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className={cn(
        view === 'chart'
          ? (compact ? "px-4 pt-2 pb-1" : "px-5 pt-3 pb-2")
          : (compact ? "px-4 pt-1 pb-2" : "px-5 pt-2 pb-3"),
        "flex flex-col flex-1 min-h-0",
        view === 'chart' ? "overflow-visible" : "overflow-hidden"
      )}>
        {view === 'chart' ? (
          filteredDatapoints.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Typography variant="secondary" className="text-xs">No email data for this period</Typography>
            </div>
          ) : (
            <ActivityBarChart datapoints={filteredDatapoints} config={dailyEmailsConfig} compact={compact} />
          )
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
            {recentEmails.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Typography variant="secondary" className="text-xs">No recent emails</Typography>
              </div>
            ) : (
              <div className="divide-y divide-foreground/[0.04]">
                {recentEmails.map((email) => (
                  <EmailListRow key={email.id} email={email} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

// ── Email breakdown with rate footer ─────────────────────────────────────────

function EmailBreakdownCard({
  deliverabilityStatus,
  bounceRate,
  clickRate,
}: {
  deliverabilityStatus: Record<string, number>,
  bounceRate: number,
  clickRate: number,
}) {
  const items = [
    { label: 'Delivered', count: deliverabilityStatus.delivered, color: '#10b981' },
    { label: 'Bounced', count: deliverabilityStatus.bounced, color: '#ef4444' },
    { label: 'In Progress', count: deliverabilityStatus.in_progress, color: '#06b6d4' },
    { label: 'Error', count: deliverabilityStatus.error, color: '#f59e0b' },
  ];
  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    <ChartCard gradientColor="orange" className="h-full">
      <div className="px-4 py-3 border-b border-foreground/[0.05]">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Delivery</span>
      </div>
      <div className="p-4 pt-3 flex-1 flex flex-col gap-2.5">
        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Typography variant="secondary" className="text-xs">No email data</Typography>
          </div>
        ) : (
          <>
            <div className="flex h-2 rounded-full overflow-hidden gap-px">
              {items.filter(i => i.count > 0).map((item, idx) => (
                <div key={idx} style={{ width: `${(item.count / total) * 100}%`, backgroundColor: item.color }} />
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {items.filter(i => i.count > 0).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-[11px] text-foreground">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {((item.count / total) * 100).toFixed(0)}%
                    </span>
                    <span className="text-[11px] font-medium text-foreground tabular-nums">
                      {item.count.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-auto pt-2 border-t border-foreground/[0.05] grid grid-cols-2 gap-2 text-center">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Bounce Rate</div>
            <div className="text-sm font-semibold tabular-nums">{bounceRate}%</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Click Rate</div>
            <div className="text-sm font-semibold tabular-nums">{clickRate}%</div>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

// ── Top Referrers with analytics footer ──────────────────────────────────────

function ReferrersWithAnalyticsCard({
  topReferrers,
}: {
  topReferrers: Array<{ referrer: string, visitors: number }>,
}) {
  return (
    <ChartCard gradientColor="purple" className="h-full">
      <div className="px-4 py-3 border-b border-foreground/[0.05]">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top Referrers</span>
      </div>
      <div className="p-4 pt-3 flex-1 flex flex-col gap-2">
        {topReferrers.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <Typography variant="secondary" className="text-xs">No referrer data</Typography>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {topReferrers.map((item) => {
              const max = topReferrers[0].visitors;
              return (
                <div key={item.referrer} className="relative flex items-center justify-between rounded-lg px-2.5 py-1.5 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-lg bg-purple-500/10 dark:bg-purple-400/10"
                    style={{ width: max > 0 ? `${(item.visitors / max) * 100}%` : '0%' }}
                  />
                  <span className="relative text-[11px] text-foreground truncate max-w-[65%]">{item.referrer}</span>
                  <span className="relative text-[11px] font-medium text-foreground tabular-nums">{item.visitors.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

// ── Quick Access Apps ──────────────────────────────────────────────────────────

function QuickAccessApps({ projectId, installedApps }: { projectId: string, installedApps: AppId[] }) {
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
          <SquaresFourIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Quick Access
        </span>
      </div>

      {installedApps.length === 0 ? (
        <div className="flex items-center justify-center py-8 rounded-xl bg-foreground/[0.02] ring-1 ring-foreground/[0.06]">
          <Typography variant="secondary" className="text-sm text-center">
            No apps installed
          </Typography>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2">
          {installedApps.map((appId) => {
            const appFrontend = ALL_APPS_FRONTEND[appId];
            const appPath = getAppPath(projectId, appFrontend);
            const app = ALL_APPS[appId];
            return (
              <Link
                key={appId}
                href={appPath}
                className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-150 hover:transition-none"
                title={app.displayName}
              >
                <div className="relative transition-transform duration-150 group-hover:transition-none group-hover:scale-105">
                  <AppIcon
                    appId={appId}
                    variant="installed"
                    className="shadow-sm group-hover:shadow-[0_0_20px_rgba(59,130,246,0.45)] group-hover:brightness-110 group-hover:saturate-110 transition-all duration-150 group-hover:transition-none"
                  />
                </div>
                <span
                  className="text-[11px] font-medium text-center group-hover:text-foreground transition-colors duration-150 group-hover:transition-none leading-tight w-full"
                  title={app.displayName}
                >
                  {app.displayName}
                </span>
              </Link>
            );
          })}

          <Link
            href={`/projects/${projectId}/apps`}
            className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-150 hover:transition-none"
            title="Explore apps"
          >
            <div className="relative transition-transform duration-150 group-hover:transition-none group-hover:scale-105">
              <div className="flex items-center justify-center w-[72px] h-[72px]">
                <CompassIcon className="w-[30px] h-[30px] text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none" />
              </div>
            </div>
            <span className="text-[11px] font-medium text-center text-muted-foreground group-hover:text-foreground transition-colors duration-150 group-hover:transition-none leading-tight w-full">
              Explore
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MetricsPage(props: { toSetup: () => void }) {
  const includeAnonymous = false;
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const user = useUser();

  const displayName = user?.displayName || user?.primaryEmail || "User";
  const truncatedName = displayName.length > 30 ? `${displayName.slice(0, 30)}...` : displayName;

  return (
    <PageLayout
      title={`Welcome back, ${truncatedName}!`}
      actions={
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <TimeRangeToggle timeRange={timeRange} onTimeRangeChange={setTimeRange} />
        </div>
      }
      fillWidth
    >
      <Suspense fallback={<MetricsLoadingFallback />}>
        <MetricsContent includeAnonymous={includeAnonymous} timeRange={timeRange} />
      </Suspense>
    </PageLayout>
  );
}

// ── Metrics content ──────────────────────────────────────────────────────────

function MetricsContent({ includeAnonymous, timeRange }: { includeAnonymous: boolean, timeRange: TimeRange }) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const projectId = useProjectId();
  const router = useRouter();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);
  const installedApps = useMemo(
    () => typedEntries(config.apps.installed)
      .filter(([_, appConfig]) => appConfig?.enabled === true)
      .map(([appId]) => appId as AppId),
    [config.apps.installed]
  );

  const auth = data.auth_overview ?? {};
  const payments = data.payments_overview ?? {};
  const email = data.email_overview ?? {};
  const analytics = data.analytics_overview ?? {};

  const recentEmails = (email.recent_emails ?? []) as Array<{ id: string, subject: string, status: string }>;
  const topReferrers = (analytics.top_referrers ?? []) as Array<{ referrer: string, visitors: number }>;

  const signUpsInRange = sumRange(data.daily_users ?? [], timeRange);
  const emailsInRange = sumRange(email.daily_emails ?? [], timeRange);

  // ── Composed chart data (visitors bars + revenue line) ───────────────────
  const composedData = useMemo<ComposedDataPoint[]>(() => {
    const analyticsObj = data.analytics_overview ?? {};
    const dailyRev = (analyticsObj.daily_revenue ?? []) as Array<{ date: string, new_cents: number, refund_cents: number }>;
    const dailyVis = (analyticsObj.daily_visitors ?? []) as DataPoint[];

    const visitorMap = new Map(dailyVis.map(d => [d.date, d.activity]));
    const revenueMap = new Map(dailyRev.map(d => [d.date, d]));

    const allDates = new Set([
      ...dailyVis.map(d => d.date),
      ...dailyRev.map(d => d.date),
    ]);

    const points = [...allDates].map(date => ({
      date,
      visitors: visitorMap.get(date) ?? 0,
      new_cents: revenueMap.get(date)?.new_cents ?? 0,
      refund_cents: revenueMap.get(date)?.refund_cents ?? 0,
    })).sort((a, b) => stringCompare(a.date, b.date));

    if (timeRange === '7d') return points.slice(-7);
    if (timeRange === '30d') return points.slice(-30);
    return points;
  }, [data.analytics_overview, timeRange]);

  const heroStats = useMemo<AnalyticsStatPill[]>(() => {
    const analyticsObj = data.analytics_overview ?? {};
    const paymentsObj = data.payments_overview ?? {};
    const deltasObj = (analyticsObj.deltas ?? {}) as Record<string, number>;
    const totalRevenueCents = analyticsObj.total_revenue_cents ?? (paymentsObj.revenue_cents ?? 0);
    return [
      {
        label: "Visitors",
        value: formatCompact(analyticsObj.visitors ?? 0),
        delta: deltasObj.visitors,
      },
      {
        label: "Revenue",
        value: formatUsdFromCents(totalRevenueCents),
        delta: deltasObj.revenue,
      },
      {
        label: "Session time",
        value: formatSeconds(analyticsObj.avg_session_seconds ?? 0),
        delta: deltasObj.session_time,
      },
    ];
  }, [data.analytics_overview, data.payments_overview]);

  // ── Globe visibility ──────────────────────────────────────────────────────
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [gridContainerWidth, setGridContainerWidth] = useState(0);
  useLayoutEffect(() => {
    setGridContainerWidth(gridContainerRef.current?.getBoundingClientRect().width ?? 0);
  }, []);
  useResizeObserver(gridContainerRef, (entry) => setGridContainerWidth(entry.contentRect.width));

  // Show the globe when the 5-column slot is wide enough to look good
  const GLOBE_MIN_WIDTH = 352.5;
  const globeColumnWidth = (() => {
    if (!gridContainerWidth) return 0;
    const gap = 20;
    const availableWidth = gridContainerWidth - gap * 11;
    return (availableWidth / 12) * 5 + gap * 4;
  })();
  const shouldShowGlobe = globeColumnWidth >= GLOBE_MIN_WIDTH;

  return (
    <div className="pb-6 flex flex-col gap-5">

      {/* ──────────────────────────────────────────────────────────────────────
          HERO — Globe + KPIs + Daily Active Users (stacked bar)
         ────────────────────────────────────────────────────────────────────── */}
      <div
        ref={gridContainerRef}
        className={cn(
          "grid gap-4 sm:gap-5 grid-cols-1 lg:grid-cols-12",
        )}
        style={shouldShowGlobe ? { height: Math.max(400, Math.round(globeColumnWidth)) } : undefined}
      >
        {shouldShowGlobe && (
          <div className="hidden lg:flex lg:col-span-5 h-full relative">
            <div className="absolute inset-0 flex items-start justify-center">
              <GlobeSectionWithData includeAnonymous={includeAnonymous} />
            </div>
            <div className="absolute top-0 left-0 px-1 z-10">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
                  <GlobeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Total Users
                </span>
              </div>
              <div className="text-4xl font-bold tracking-tight text-foreground pl-0.5">
                {(data.total_users ?? 0).toLocaleString()}
              </div>
            </div>
          </div>
        )}

        <div className={cn(
          shouldShowGlobe ? "lg:col-span-7 h-full" : "lg:col-span-12",
        )}>
          <HeroAnalyticsWidget
            composedData={composedData}
            stats={heroStats}
            compact={shouldShowGlobe}
          />
        </div>
      </div>

      {/* Mobile total users */}
      {!shouldShowGlobe && (
        <div className="lg:hidden">
          <DualStatCard label="Total Users" value={data.total_users ?? 0} subLabel={`Sign-ups (${timeRange})`} subValue={signUpsInRange} gradientColor="blue" />
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────
          QUICK ACCESS — App shortcuts
         ────────────────────────────────────────────────────────────────────── */}
      <QuickAccessApps projectId={projectId} installedApps={installedApps} />

      {/* ──────────────────────────────────────────────────────────────────────
          ROW 2 — Daily Sign-ups + Emails trend
         ────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[340px] min-h-0">
        <TabbedMetricsCard
          config={dailySignUpsConfig}
          chartData={data.daily_users ?? []}
          listData={data.recently_registered ?? []}
          listTitle="Recent Sign-Ups"
          projectId={projectId}
          router={router}
          compact
          gradientColor="blue"
          timeRange={timeRange}
        />
        <TabbedEmailsCard
          chartData={email.daily_emails ?? []}
          recentEmails={recentEmails}
          timeRange={timeRange}
          compact
        />
      </div>

      {/* ──────────────────────────────────────────────────────────────────────
          ROW 3 — Breakdown
         ────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DonutChartDisplay
          datapoints={(data.login_methods ?? []) as { method: string, count: number }[]}
          compact
          height={180}
          gradientColor="blue"
        />
        <EmailBreakdownCard
          deliverabilityStatus={email.deliverability_status ?? {}}
          bounceRate={email.bounce_rate ?? 0}
          clickRate={email.click_rate ?? 0}
        />
        <ReferrersWithAnalyticsCard
          topReferrers={topReferrers}
        />
      </div>
    </div>
  );
}
