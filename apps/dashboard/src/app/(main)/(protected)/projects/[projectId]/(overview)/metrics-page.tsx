'use client';

import { AppIcon } from "@/components/app-square";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import { cn, Typography } from "@/components/ui";
import { ALL_APPS_FRONTEND, type AppId, getAppPath } from "@/lib/apps-frontend";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { DesignListItemRow } from "@/components/design-components/list";
import { CompassIcon, GlobeIcon, SquaresFourIcon } from "@phosphor-icons/react";
import useResizeObserver from '@react-hook/resize-observer';
import { UserAvatar, useUser } from "@stackframe/stack";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp, useProjectId } from "../use-admin-app";
import { GlobeSectionWithData } from "./globe-section-with-data";
import {
  ActivityBarChart,
  ChartCard,
  DataPoint,
  DonutChartDisplay,
  filterDatapointsByTimeRange,
  GradientColor,
  LineChartDisplayConfig,
  StackedBarChartDisplay,
  StackedDataPoint,
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

type SplitSeries = {
  new?: DataPoint[],
  reactivated?: DataPoint[],
  retained?: DataPoint[],
};

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

function mergeSplitToStacked(split: SplitSeries, range: TimeRange): StackedDataPoint[] {
  const newPts = filterDatapointsByTimeRange(split.new ?? [], range);
  const reactivatedPts = filterDatapointsByTimeRange(split.reactivated ?? [], range);
  const retainedPts = filterDatapointsByTimeRange(split.retained ?? [], range);

  const dateMap = new Map<string, StackedDataPoint>();
  for (const arr of [newPts, reactivatedPts, retainedPts]) {
    for (const p of arr) {
      if (!dateMap.has(p.date)) {
        dateMap.set(p.date, { date: p.date, new: 0, reactivated: 0, retained: 0 });
      }
    }
  }
  for (const p of newPts) {
    const entry = dateMap.get(p.date);
    if (entry) entry.new = p.activity;
  }
  for (const p of reactivatedPts) {
    const entry = dateMap.get(p.date);
    if (entry) entry.reactivated = p.activity;
  }
  for (const p of retainedPts) {
    const entry = dateMap.get(p.date);
    if (entry) entry.retained = p.activity;
  }

  return [...dateMap.values()].sort((a, b) => stringCompare(a.date, b.date));
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

// ── Tabbed DAU stacked chart + recently active list ──────────────────────────

type UserListItem = {
  id: string,
  profile_image_url?: string | null,
  display_name?: string | null,
  primary_email?: string | null,
  last_active_at_millis?: number | null,
  signed_up_at_millis?: number | null,
};

function TabbedDauCard({
  dauSplit,
  recentlyActive,
  timeRange,
  projectId,
  router,
  compact = false,
}: {
  dauSplit: SplitSeries,
  recentlyActive: UserListItem[],
  timeRange: TimeRange,
  projectId: string,
  router: ReturnType<typeof useRouter>,
  compact?: boolean,
}) {
  const [view, setView] = useState<'chart' | 'list'>('chart');

  const dauStacked = useMemo(() => mergeSplitToStacked(dauSplit, timeRange), [dauSplit, timeRange]);

  const activeTabColor = "bg-cyan-500 dark:bg-[hsl(200,91%,70%)]";

  const tabs: Array<{ id: 'chart' | 'list', label: string }> = [
    { id: 'chart', label: 'Daily Active Users' },
    { id: 'list', label: 'Recently Active' },
  ];

  return (
    <ChartCard gradientColor="cyan">
      <div className={cn("flex items-center justify-between border-b border-foreground/[0.05]", compact ? "px-4" : "px-5")}>
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={cn(
                "relative px-3 py-3.5 text-xs font-medium transition-all duration-150 hover:transition-none rounded-t-lg",
                view === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {view === tab.id && (
                <div className={cn("absolute bottom-0 left-3 right-3 h-0.5 rounded-full", activeTabColor)} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={cn(
        view === 'chart'
          ? (compact ? "px-4 pt-2 pb-1" : "px-5 pt-3 pb-2")
          : (compact ? "p-4 pt-3" : "p-5 pt-4"),
        "flex flex-col flex-1 min-h-0 overflow-visible"
      )}>
        {view === 'chart' && (
          dauStacked.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Typography variant="secondary" className="text-xs">No activity data</Typography>
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <StackedBarChartDisplay datapoints={dauStacked} compact={compact} height={compact ? 220 : 260} />
            </div>
          )
        )}
        {view === 'list' && (
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
            {recentlyActive.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Typography variant="secondary" className="text-xs">No recently active users</Typography>
              </div>
            ) : (
              <div className="space-y-0.5">
                {recentlyActive.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => router.push(`/projects/${projectId}/users/${user.id}`)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl transition-all duration-150 hover:transition-none text-left group hover:bg-cyan-500/[0.06]"
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
                      <div className="text-sm font-medium truncate text-foreground">
                        {user.display_name || user.primary_email || 'Anonymous User'}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {user.last_active_at_millis
                          ? `Active ${fromNow(new Date(user.last_active_at_millis))}`
                          : 'Never active'}
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
    <ChartCard gradientColor="orange">
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
      <div className={cn(compact ? "p-4 pt-3" : "p-5 pt-4", "flex flex-col justify-center min-h-[260px] overflow-visible")}>
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
              <div className="space-y-0.5">
                {recentEmails.map((email) => (
                  <DesignListItemRow key={email.id} size="sm" title={email.subject} subtitle={email.status} />
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
  avgSession,
  revenuePerVisitor,
}: {
  topReferrers: Array<{ referrer: string, visitors: number }>,
  avgSession: number,
  revenuePerVisitor: number,
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

        <div className="mt-auto pt-2 border-t border-foreground/[0.05] grid grid-cols-2 gap-2 text-center">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg. Session</div>
            <div className="text-sm font-semibold tabular-nums">{formatSeconds(avgSession)}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Revenue / User</div>
            <div className="text-sm font-semibold tabular-nums">${revenuePerVisitor}</div>
          </div>
        </div>
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
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
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
          "flex flex-col gap-4",
          shouldShowGlobe ? "lg:col-span-7 h-full" : "lg:col-span-12",
        )}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <DualStatCard label="Revenue" value={formatUsdFromCents(payments.revenue_cents ?? 0)} subLabel="Recurring" subValue={formatUsdFromCents(payments.mrr_cents ?? 0)} gradientColor="green" />
            <DualStatCard label="Active Subscriptions" value={payments.active_subscription_count ?? 0} subLabel="Total Orders" subValue={payments.total_orders ?? 0} gradientColor="cyan" />
            <DualStatCard label="Visitors" value={analytics.visitors ?? 0} subLabel="Online Now" subValue={analytics.online_live ?? 0} gradientColor="purple" />
            <DualStatCard label="Emails Sent" value={emailsInRange} subLabel="Conversion" subValue={`${payments.checkout_conversion_rate ?? 0}%`} gradientColor="orange" />
          </div>

          <div className={shouldShowGlobe ? "flex-1 min-h-0" : "h-[300px]"}>
            <TabbedDauCard
              dauSplit={(auth.daily_active_users_split ?? {}) as SplitSeries}
              recentlyActive={data.recently_active ?? []}
              timeRange={timeRange}
              projectId={projectId}
              router={router}
              compact
            />
          </div>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[340px]">
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
          avgSession={analytics.avg_session_seconds ?? 0}
          revenuePerVisitor={analytics.revenue_per_visitor ?? 0}
        />
      </div>
    </div>
  );
}
