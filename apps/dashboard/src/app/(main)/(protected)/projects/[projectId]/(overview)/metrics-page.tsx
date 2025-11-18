'use client';

import { AppSquare } from "@/components/app-square";
import { Link } from "@/components/link";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { cn } from '@stackframe/stack-ui';
import { Activity, ArrowRight, Globe2, TrendingUp, Users } from "lucide-react";
import { Suspense, useState } from 'react';
import { PageLayout } from "../page-layout";
import { useAdminApp } from '../use-admin-app';
import { ChartsSectionWithData } from './charts-section-with-data';
import { GlobeSectionWithData } from './globe-section-with-data';
import { MetricsLoadingFallback } from './metrics-loading';


export default function MetricsPage(props: { toSetup: () => void }) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const [includeAnonymous, setIncludeAnonymous] = useState(false);

  const installedApps = typedEntries(config.apps.installed)
    .filter(([_, appConfig]) => appConfig?.enabled)
    .map(([appId]) => appId as AppId);

  const suggestedApps = typedEntries(ALL_APPS)
    .filter(([_, app]) => app.stage === "stable")
    .map(([appId]) => appId)
    .filter((appId) => !config.apps.installed[appId]?.enabled);

  return (
    <PageLayout>
      <div className="space-y-6">
        {/* Hero Stats - Premium Glass Cards */}
        <Suspense fallback={<MetricsLoadingFallback />}>
          <HeroSection includeAnonymous={includeAnonymous} />
        </Suspense>

        {/* Analytics */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Analytics</h2>
              <p className="text-sm text-muted-foreground">Real-time metrics and insights</p>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/50">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Live</span>
            </div>
          </div>

          <Suspense fallback={<MetricsLoadingFallback />}>
            <ChartsSectionWithData includeAnonymous={includeAnonymous} />
          </Suspense>
        </div>

        {/* Integrations */}
        {(installedApps.length > 0 || suggestedApps.length > 0) && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Integrations</h2>
              <p className="text-sm text-muted-foreground">Connected apps and services</p>
            </div>

            {installedApps.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">Active</h3>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-medium border border-emerald-200 dark:border-emerald-800/50">
                    {installedApps.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {installedApps.map(appId => (
                    <AppSquare
                      key={appId}
                      appId={appId}
                      variant="installed"
                      showSubtitle={true}
                    />
                  ))}
                </div>
              </div>
            )}

            {suggestedApps.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Discover</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {suggestedApps.slice(0, 5).map(appId => (
                    <AppSquare
                      key={appId}
                      appId={appId}
                      showSubtitle={true}
                    />
                  ))}
                  <Link
                    href={urlString`/projects/${adminApp.projectId}/apps`}
                    className={cn(
                      "relative overflow-hidden group",
                      "flex flex-col items-center justify-center gap-2 p-4",
                      "rounded-2xl bg-muted/50",
                      "border border-border",
                      "transition-all duration-200",
                      "hover:bg-accent hover:shadow-lg",
                      "cursor-pointer"
                    )}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                      <ArrowRight className="w-7 h-7 text-primary" strokeWidth={2} />
                    </div>
                    <div className="relative text-center">
                      <p className="text-sm font-semibold">View All</p>
                      <p className="text-xs text-muted-foreground">Explore apps</p>
                    </div>
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// Hero Section - Premium Glass Design
function HeroSection({ includeAnonymous }: { includeAnonymous: boolean }) {
  const adminApp = useAdminApp();
  const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);

  // Calculate metrics
  const recentUsers = data.daily_users.slice(-7).reduce((sum: number, day: any) => sum + day.activity, 0);
  const previousWeekUsers = data.daily_users.slice(-14, -7).reduce((sum: number, day: any) => sum + day.activity, 0);
  const growthRate = previousWeekUsers > 0
    ? Math.round(((recentUsers - previousWeekUsers) / previousWeekUsers) * 100)
    : 0;

  const recentActiveUsers = data.daily_active_users.slice(-7).reduce((sum: number, day: any) => sum + day.activity, 0);
  const avgDailyActive = Math.round(recentActiveUsers / 7);

  const topCountries = Object.entries(data.users_by_country as Record<string, number>)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 3);

  return (
    <>
      {/* Stats Grid - Subtle Modern Cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {/* Total Users */}
        <div className="group relative overflow-hidden rounded-xl bg-card border border-border transition-all hover:shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Users</span>
              <div className="p-2 rounded-lg bg-blue-500/10 dark:bg-blue-500/20">
                <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight">{data.total_users.toLocaleString()}</div>
            {growthRate !== 0 && (
              <div className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium",
                growthRate > 0
                  ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400"
              )}>
                <TrendingUp className={cn("h-3 w-3", growthRate < 0 && "rotate-180")} />
                {Math.abs(growthRate)}% vs last week
              </div>
            )}
          </div>
        </div>

        {/* Weekly Sign-ups */}
        <div className="group relative overflow-hidden rounded-xl bg-card border border-border transition-all hover:shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Weekly</span>
              <div className="p-2 rounded-lg bg-purple-500/10 dark:bg-purple-500/20">
                <Activity className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight">{recentUsers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground font-medium">
              New sign-ups in 7 days
            </p>
          </div>
        </div>

        {/* Daily Active */}
        <div className="group relative overflow-hidden rounded-xl bg-card border border-border transition-all hover:shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Daily Active</span>
              <div className="p-2 rounded-lg bg-orange-500/10 dark:bg-orange-500/20">
                <TrendingUp className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight">{avgDailyActive.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground font-medium">
              Avg per day (7-day)
            </p>
          </div>
        </div>

        {/* Top Regions */}
        <div className="group relative overflow-hidden rounded-xl bg-card border border-border transition-all hover:shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Top Region</span>
              <div className="p-2 rounded-lg bg-teal-500/10 dark:bg-teal-500/20">
                <Globe2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              </div>
            </div>
            {topCountries.length > 0 ? (
              <>
                <div className="text-3xl font-bold tracking-tight">{topCountries[0][1]}</div>
                <p className="text-xs text-muted-foreground font-medium">
                  users in {topCountries[0][0]}
                </p>
              </>
            ) : (
              <div className="text-lg text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Globe - Themed Card */}
      <div className="relative overflow-hidden rounded-2xl bg-card border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5" />
        <div className="relative p-6">
          <div className="mb-4 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Global Distribution</h3>
            </div>
            <p className="text-sm text-muted-foreground">Explore where your users are located</p>
          </div>
          <div className="rounded-xl overflow-hidden bg-muted/30">
            <GlobeSectionWithData includeAnonymous={includeAnonymous} />
          </div>
        </div>
      </div>
    </>
  );
}
