'use client';

import { AppIcon } from "@/components/app-square";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import { ALL_APPS_FRONTEND, getAppPath } from "@/lib/apps-frontend";
import { useUser } from '@stackframe/stack';
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { cn, Typography } from '@stackframe/stack-ui';
import { Globe2, LayoutGrid } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { PageLayout } from "../page-layout";
import { useAdminApp, useProjectId } from '../use-admin-app';
import { GlobeSectionWithData } from './globe-section-with-data';
import { ChartCard, LineChartDisplayConfig, TabbedMetricsCard, TimeRange, TimeRangeToggle } from './line-chart';
import { MetricsLoadingFallback } from './metrics-loading';

// Widget definitions
type WidgetId = 'apps' | 'daily-active-users' | 'daily-sign-ups' | 'globe' | 'total-users';

type WidgetConfig = {
  id: WidgetId,
  name: string,
  description: string,
  defaultEnabled: boolean,
  area: 'left' | 'right',
}

const AVAILABLE_WIDGETS: WidgetConfig[] = [
  { id: 'globe', name: 'Globe', description: 'Interactive 3D globe showing user locations', defaultEnabled: true, area: 'left' },
  { id: 'total-users', name: 'Total Users', description: 'Overview of total registered users', defaultEnabled: true, area: 'right' },
  { id: 'apps', name: 'Quick Access', description: 'Quick access to your installed apps', defaultEnabled: true, area: 'right' },
  { id: 'daily-active-users', name: 'Daily Active Users', description: 'Chart and list of active users', defaultEnabled: true, area: 'right' },
  { id: 'daily-sign-ups', name: 'Daily Sign-Ups', description: 'Chart and list of new registrations', defaultEnabled: true, area: 'right' },
];

type DashboardConfig = {
  enabledWidgets: WidgetId[],
  widgetOrder: WidgetId[],
}

const DEFAULT_CONFIG: DashboardConfig = {
  enabledWidgets: AVAILABLE_WIDGETS.filter(w => w.defaultEnabled).map(w => w.id),
  widgetOrder: AVAILABLE_WIDGETS.map(w => w.id),
};

const STORAGE_KEY = 'stack-dashboard-widget-config';

function loadConfig(): DashboardConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate and merge with defaults for any new widgets
      const validWidgetIds = new Set(AVAILABLE_WIDGETS.map(w => w.id));
      const enabledWidgets = (parsed.enabledWidgets || []).filter((id: string) => validWidgetIds.has(id as WidgetId));
      const widgetOrder = (parsed.widgetOrder || []).filter((id: string) => validWidgetIds.has(id as WidgetId));

      // Add any new widgets that aren't in the stored config
      for (const widget of AVAILABLE_WIDGETS) {
        if (!widgetOrder.includes(widget.id)) {
          widgetOrder.push(widget.id);
          if (widget.defaultEnabled) {
            enabledWidgets.push(widget.id);
          }
        }
      }

      return { enabledWidgets, widgetOrder };
    }
  } catch (e) {
    console.error('Failed to load dashboard config:', e);
  }
  return DEFAULT_CONFIG;
}

// TODO: This function will be used when widget configuration UI is implemented
function saveConfig(config: DashboardConfig) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save dashboard config:', e);
  }
}

const dailySignUpsConfig = {
  name: 'Daily Sign-Ups',
  chart: {
    activity: {
      label: "Activity",
      theme: {
        light: "hsl(221, 83%, 53%)",
        dark: "hsl(217, 91%, 60%)",
      },
    },
  }
} satisfies LineChartDisplayConfig;

const dauConfig = {
  name: 'Daily Active Users',
  chart: {
    activity: {
      label: "Activity",
      theme: {
        light: "hsl(142, 76%, 36%)",
        dark: "hsl(142, 71%, 45%)",
      },
    },
  }
} satisfies LineChartDisplayConfig;

const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

function TotalUsersDisplay({ timeRange, includeAnonymous, minimal = false }: { timeRange: TimeRange, includeAnonymous: boolean, minimal?: boolean }) {
  const adminApp = useAdminApp();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);

  const calculateTotalUsers = () => {
    if (timeRange === 'all') {
      return data.total_users || 0;
    }
    const dailyUsers = data.daily_users || [];
    const filteredData = timeRange === '7d' ? dailyUsers.slice(-7) : dailyUsers.slice(-30);
    return filteredData.reduce((sum: any, point: { activity: any }) => sum + point.activity, 0);
  };

  const totalUsers = calculateTotalUsers();

  if (minimal) {
    return <>{totalUsers.toLocaleString()}</>;
  }

  return (
    <span className="text-foreground font-semibold">
      {totalUsers.toLocaleString()} users
    </span>
  );
}

// Widget components for better organization
function AppsWidget({ installedApps, projectId }: { installedApps: AppId[], projectId: string }) {
  return (
    <ChartCard gradientColor="slate" className="shrink-0">
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-5">
          <LayoutGrid className="h-4 w-4 text-muted-foreground/70" />
          <span className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
            Quick Access
          </span>
        </div>
        {installedApps.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Typography variant="secondary" className="text-sm text-center">
              No apps installed
            </Typography>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-6">
            {installedApps.map((appId) => {
              const appFrontend = ALL_APPS_FRONTEND[appId];
              const app = ALL_APPS[appId];
              const appPath = getAppPath(projectId, appFrontend);
              return (
                <Link
                  key={appId}
                  href={appPath}
                  className="group flex flex-col items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-muted/50 transition-all duration-300 ease-out"
                  title={app.displayName}
                >
                  <div className="relative transform transition-transform duration-300 group-hover:scale-105">
                    <AppIcon
                      appId={appId}
                      size="medium"
                      variant="installed"
                      className="shadow-sm group-hover:shadow-md bg-white dark:bg-gray-800 rounded-[1.2rem] ring-1 ring-black/5 dark:ring-white/5"
                    />
                  </div>
                  <span className="text-[11px] font-medium text-center text-muted-foreground group-hover:text-foreground transition-colors truncate leading-tight w-full px-1">
                    {app.displayName}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

function DailyActiveUsersWidget({
  data,
  projectId,
  router,
  timeRange
}: {
  data: any,
  projectId: string,
  router: ReturnType<typeof useRouter>,
  timeRange: TimeRange,
}) {
  return (
    <TabbedMetricsCard
      config={dauConfig}
      chartData={data.daily_active_users || []}
      listData={data.recently_active || []}
      listTitle="Recently Active"
      projectId={projectId}
      router={router}
      compact
      gradientColor="green"
      timeRange={timeRange}
    />
  );
}

function DailySignUpsWidget({
  data,
  projectId,
  router,
  timeRange
}: {
  data: any,
  projectId: string,
  router: ReturnType<typeof useRouter>,
  timeRange: TimeRange,
}) {
  return (
    <TabbedMetricsCard
      config={dailySignUpsConfig}
      chartData={data.daily_users || []}
      listData={data.recently_registered || []}
      listTitle="Recent Sign Ups"
      projectId={projectId}
      router={router}
      compact
      gradientColor="blue"
      timeRange={timeRange}
      totalAllTime={data.total_users}
    />
  );
}

export default function MetricsPage(props: { toSetup: () => void }) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  // Currently always false - can be made configurable in the future
  const includeAnonymous = false;
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig>(DEFAULT_CONFIG);
  const user = useUser();

  // Load config from localStorage on mount
  useEffect(() => {
    setDashboardConfig(loadConfig());
  }, []);

  const installedApps = typedEntries(config.apps.installed)
    .filter(([_, appConfig]) => appConfig?.enabled)
    .map(([appId]) => appId as AppId);

  // Get display name with smart truncation
  const displayName = user?.displayName || user?.primaryEmail || 'User';
  const truncatedName = displayName.length > 30 ? displayName.slice(0, 30) + '...' : displayName;

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
        <MetricsContent
          includeAnonymous={includeAnonymous}
          installedApps={installedApps}
          timeRange={timeRange}
          dashboardConfig={dashboardConfig}
        />
      </Suspense>
    </PageLayout>
  );
}

function MetricsContent({
  includeAnonymous,
  installedApps,
  timeRange,
  dashboardConfig,
}: {
  includeAnonymous: boolean,
  installedApps: AppId[],
  timeRange: TimeRange,
  dashboardConfig: DashboardConfig,
}) {
  const adminApp = useAdminApp();
  const projectId = useProjectId();
  const router = useRouter();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);

  const isWidgetEnabled = (id: WidgetId) => dashboardConfig.enabledWidgets.includes(id);

  // Get ordered right-side widgets
  const rightWidgets = useMemo(() => {
    return dashboardConfig.widgetOrder
      .filter(id => {
        const widget = AVAILABLE_WIDGETS.find(w => w.id === id);
        return widget?.area === 'right' && dashboardConfig.enabledWidgets.includes(id);
      });
  }, [dashboardConfig]);

  const showGlobe = isWidgetEnabled('globe');

  // Render a widget by ID
  const renderWidget = (widgetId: WidgetId) => {
    switch (widgetId) {
      case 'apps': {
        return <AppsWidget installedApps={installedApps} projectId={projectId} />;
      }
      case 'daily-active-users': {
        return (
          <DailyActiveUsersWidget
            data={data}
            projectId={projectId}
            router={router}
            timeRange={timeRange}
          />
        );
      }
      case 'daily-sign-ups': {
        return (
          <DailySignUpsWidget
            data={data}
            projectId={projectId}
            router={router}
            timeRange={timeRange}
          />
        );
      }
      default: {
        return null;
      }
    }
  };

  // Group widgets for grid layout
  const chartWidgets = rightWidgets.filter(id => id === 'daily-active-users' || id === 'daily-sign-ups');
  const statWidgets = rightWidgets.filter(id => id === 'apps');

  return (
    <div className="relative pb-4 sm:pb-8">
      <div className={cn(
        "grid gap-3 sm:gap-4 min-h-[400px] h-[calc(100vh-160px)]",
        showGlobe ? "grid-cols-1 lg:grid-cols-12" : "grid-cols-1"
      )}>
        {/* Left Column: Globe - Hidden on mobile */}
        {showGlobe && (
          <div className="hidden lg:flex lg:flex-col lg:col-span-5 h-full min-h-[300px]">
            <div className="mb-6 px-1">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Total Users
              </h2>
              <div className="text-4xl font-bold tracking-tight text-foreground">
                <Suspense fallback="...">
                  <TotalUsersDisplay timeRange={timeRange} includeAnonymous={includeAnonymous} minimal />
                </Suspense>
              </div>
            </div>
            <div className="relative flex-1 w-full overflow-hidden flex items-center justify-center">
              <div className="absolute inset-0">
                <GlobeSectionWithData includeAnonymous={includeAnonymous} />
              </div>
            </div>
          </div>
        )}

        {/* Right Column: Stats Grid */}
        <div className={cn(
          "flex flex-col gap-3 h-full min-h-0",
          showGlobe ? "lg:col-span-7" : ""
        )}>
          {/* Stat Widgets Row (Apps) */}
          {statWidgets.length > 0 && (
            <div className={cn(
              "shrink-0 grid gap-3",
              statWidgets.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
            )}>
              {statWidgets.map(widgetId => (
                <div key={widgetId}>
                  {renderWidget(widgetId)}
                </div>
              ))}
            </div>
          )}

          {/* Charts Grid */}
          {chartWidgets.length > 0 && (
            <div className={cn(
              "flex-1 min-h-0 grid gap-3",
              chartWidgets.length === 1
                ? "grid-cols-1"
                : "grid-cols-1 sm:grid-cols-2"
            )}>
              {chartWidgets.map(widgetId => (
                <div key={widgetId} className="h-full min-h-[200px]">
                  {renderWidget(widgetId)}
                </div>
              ))}
            </div>
          )}

          {/* Empty state when no widgets */}
          {rightWidgets.length === 0 && !showGlobe && (
            <div className="flex-1 flex items-center justify-center min-h-[300px]">
              <div className="text-center p-8">
                <LayoutGrid className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <Typography variant="secondary" className="text-sm">
                  No widgets enabled
                </Typography>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Globe Notice */}
      {showGlobe && (
        <div className="lg:hidden mt-4 p-3 rounded-lg bg-muted/30 border border-border/50 text-center">
          <Typography variant="secondary" className="text-xs">
            <Globe2 className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
            Globe visualization is available on larger screens
          </Typography>
        </div>
      )}
    </div>
  );
}
