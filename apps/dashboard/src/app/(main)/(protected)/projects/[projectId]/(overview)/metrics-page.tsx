'use client';

import { AppIcon } from "@/components/app-square";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import { cn, Typography } from '@/components/ui';
import { ALL_APPS_FRONTEND, getAppPath } from "@/lib/apps-frontend";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { CaretUpIcon, CompassIcon, DotsThreeIcon, GlobeIcon, SquaresFourIcon } from "@phosphor-icons/react";
import useResizeObserver from '@react-hook/resize-observer';
import { useUser } from '@stackframe/stack';
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PageLayout } from "../page-layout";
import { useAdminApp, useProjectId } from '../use-admin-app';
import { GlobeSectionWithData } from './globe-section-with-data';
import { LineChartDisplayConfig, TabbedMetricsCard, TimeRange, TimeRangeToggle } from './line-chart';
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
        dark: "hsl(240, 71%, 70%)",
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
        light: "hsl(180, 95%, 53%)",
        dark: "hsl(200, 91%, 70%)",
      },
    },
  }
} satisfies LineChartDisplayConfig;

function TotalUsersDisplay({ includeAnonymous, minimal = false }: { includeAnonymous: boolean, minimal?: boolean }) {
  const adminApp = useAdminApp();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics(includeAnonymous);

  const totalUsers = data.total_users || 0;

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
  const [ref, setRef] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useResizeObserver(ref, (entry) => setWidth(entry.contentRect.width));

  const gap = 8;
  const minItemWidth = 90;
  const itemsPerRow = Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
  const maxRows = 2;
  const maxItems = itemsPerRow * maxRows;

  // Account for Explore button (always shown) and See all button (shown when can expand)
  // Explore takes 1 slot, See all takes 1 slot when needed
  const slotsForApps = maxItems - 1; // -1 for Explore (always shown)
  const canExpand = installedApps.length > slotsForApps && width > 0;
  const showSeeAll = !expanded && canExpand;
  const showShowLess = expanded && canExpand;
  // When See all is shown, we need another slot for it
  const displayApps = showSeeAll ? installedApps.slice(0, slotsForApps - 1) : installedApps;

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
          <SquaresFourIcon className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Quick Access
        </span>
      </div>
      {installedApps.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <Typography variant="secondary" className="text-sm text-center">
            No apps installed
          </Typography>
        </div>
      ) : (
        <div
          ref={setRef}
          className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2"
        >
          {displayApps.map((appId) => {
            const appFrontend = ALL_APPS_FRONTEND[appId];
            const app = ALL_APPS[appId];
            const appPath = getAppPath(projectId, appFrontend);
            return (
              <Link
                key={appId}
                href={appPath}
                className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-750 hover:transition-none"
                title={app.displayName}
              >
                <div className="relative transition-transform duration-750 group-hover:transition-none group-hover:scale-105">
                  <AppIcon
                    appId={appId}
                    variant="installed"
                    className="shadow-sm group-hover:shadow-[0_0_20px_rgba(59,130,246,0.45)] group-hover:brightness-110 group-hover:saturate-110 transition-all duration-750 group-hover:transition-none"
                  />
                </div>
                <span
                  className="text-[11px] font-medium text-center group-hover:text-foreground transition-colors duration-750 group-hover:transition-none leading-tight w-full"
                  title={app.displayName}
                >
                  {app.displayName}
                </span>
              </Link>
            );
          })}
          {/* Explore Apps - always shown before See all/Less */}
          <Link
            href={`/projects/${projectId}/apps`}
            className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-750 hover:transition-none"
            title="Explore all apps"
          >
            <div className="relative transition-transform duration-750 group-hover:transition-none group-hover:scale-105">
              <div className="flex items-center justify-center w-[72px] h-[72px]">
                <CompassIcon className="w-[30px] h-[30px] text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none" />
              </div>
            </div>
            <span className="text-[11px] font-medium text-center text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none leading-tight w-full">
              Explore
            </span>
          </Link>
          {showSeeAll && (
            <button
              onClick={() => setExpanded(true)}
              className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-750 hover:transition-none"
              title="See all apps"
            >
              <div className="relative transition-transform duration-750 group-hover:transition-none group-hover:scale-105">
                <div className="flex items-center justify-center w-[72px] h-[72px]">
                  <DotsThreeIcon className="w-[30px] h-[30px] text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none" />
                </div>
              </div>
              <span className="text-[11px] font-medium text-center text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none leading-tight w-full">
                See all
              </span>
            </button>
          )}
          {showShowLess && (
            <button
              onClick={() => setExpanded(false)}
              className="group flex flex-col items-center gap-2.5 pt-3 pb-2 rounded-xl hover:bg-foreground/[0.03] transition-all duration-750 hover:transition-none"
              title="Show less"
            >
              <div className="relative transition-transform duration-750 group-hover:transition-none group-hover:scale-105">
                <div className="flex items-center justify-center w-[72px] h-[72px]">
                  <CaretUpIcon className="w-[30px] h-[30px] text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none" />
                </div>
              </div>
              <span className="text-[11px] font-medium text-center text-muted-foreground group-hover:text-foreground transition-colors duration-750 group-hover:transition-none truncate leading-tight w-full">
                Less
              </span>
            </button>
          )}
        </div>
      )}
    </div>
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
      gradientColor="cyan"
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
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
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

  // Track grid container width to calculate globe column width
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [gridContainerSize, setGridContainerSize] = useState<DOMRectReadOnly>();

  useLayoutEffect(() => {
    setGridContainerSize(gridContainerRef.current?.getBoundingClientRect());
  }, []);

  useResizeObserver(gridContainerRef, (entry) => setGridContainerSize(entry.contentRect));

  // Calculate globe column width (5/12 of grid width, accounting for gaps)
  // Grid has 12 columns, globe takes 5, with gap-4 sm:gap-5 between columns
  // On lg screens, gap-5 applies = 1.25rem = 20px
  const calculateGlobeColumnWidth = () => {
    if (!gridContainerSize?.width) return 0;
    const gap = 20; // gap-5 = 1.25rem = 20px on lg screens (sm:gap-5 applies)
    const totalGaps = gap * 11; // 11 gaps between 12 columns
    const availableWidth = gridContainerSize.width - totalGaps;
    const columnWidth = availableWidth / 12;
    return columnWidth * 5 + gap * 4; // 5 columns + 4 gaps
  };

  const globeColumnWidth = calculateGlobeColumnWidth();

  // Hide globe and total users section when width is less than 352.5px
  const GLOBE_MIN_WIDTH = 352.5;
  const shouldShowGlobeSection = showGlobe && globeColumnWidth >= GLOBE_MIN_WIDTH;

  // On lg screens, derive grid height from globe column width
  // Formula: height = min(max(viewHeight, globeWidth), globeWidth * 1.75)
  const [isLgScreen, setIsLgScreen] = useState(false);
  const [viewHeight, setViewHeight] = useState(0);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    setIsLgScreen(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsLgScreen(e.matches);
    mediaQuery.addEventListener('change', handler);

    // Track viewport height
    const updateViewHeight = () => setViewHeight(window.innerHeight - 180); // same as calc(100vh - 180px)
    updateViewHeight();
    window.addEventListener('resize', updateViewHeight);

    return () => {
      mediaQuery.removeEventListener('change', handler);
      window.removeEventListener('resize', updateViewHeight);
    };
  }, []);

  // Calculate grid height based on globe column width on lg screens
  // height = min(max(viewHeight, globeWidth), globeWidth * 1.75)
  const gridHeightFromGlobe = isLgScreen && showGlobe && shouldShowGlobeSection && globeColumnWidth > 0 && viewHeight > 0
    ? Math.min(Math.max(viewHeight, globeColumnWidth), globeColumnWidth * 1.75)
    : undefined;

  // Track charts grid size to determine layout
  const chartsGridRef = useRef<HTMLDivElement>(null);
  const [chartsGridSize, setChartsGridSize] = useState<{ width: number, height: number }>({ width: 0, height: 0 });

  useResizeObserver(chartsGridRef, (entry) => {
    setChartsGridSize({ width: entry.contentRect.width, height: entry.contentRect.height });
  });

  // Determine chart layout based on charts grid dimensions:
  // - If charts grid is at least 70% as tall as wide (tall/portrait), stack vertically
  // - If charts grid is wide and less than 70% as tall, use 2 columns
  const shouldUseTwoColumns = chartsGridSize.width > 400 && chartsGridSize.height > 0 && (chartsGridSize.height / chartsGridSize.width) < 0.7;

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
    <div className="relative pb-4 sm:pb-6">
      <div
        ref={gridContainerRef}
        className={cn(
          "grid gap-4 sm:gap-5 min-h-[400px]",
          gridHeightFromGlobe ? "" : "h-[calc(100vh-180px)]",
          showGlobe ? "grid-cols-1 lg:grid-cols-12" : "grid-cols-1"
        )}
        style={gridHeightFromGlobe ? { height: gridHeightFromGlobe } : undefined}
      >
        {/* Left Column: Globe - Hidden on mobile */}
        {showGlobe && shouldShowGlobeSection && (
          <div className="hidden lg:flex lg:col-span-5 h-full min-h-[300px] relative">
            {/* Globe takes full space */}
            <div className="absolute inset-0 flex items-start justify-center">
              <GlobeSectionWithData includeAnonymous={includeAnonymous} />
            </div>
            {/* Total Users overlay */}
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
                <Suspense fallback="...">
                  <TotalUsersDisplay includeAnonymous={includeAnonymous} minimal />
                </Suspense>
              </div>
            </div>
          </div>
        )}

        {/* Right Column: Stats Grid */}
        <div
          className={cn(
            "flex flex-col gap-12 h-full min-h-0",
            showGlobe && shouldShowGlobeSection ? "lg:col-span-7" : showGlobe ? "lg:col-span-12" : ""
          )}
        >
          {/* Stat Widgets Row (Apps) */}
          {statWidgets.length > 0 && (
            <div className={cn(
              "shrink-0 grid gap-4",
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
            <div
              ref={chartsGridRef}
              className={cn(
                "flex-1 min-h-0 grid gap-4",
                chartWidgets.length === 1
                  ? "grid-cols-1"
                  : shouldUseTwoColumns ? "grid-cols-2" : "grid-cols-1"
              )}
            >
              {chartWidgets.map(widgetId => (
                <div key={widgetId} className="min-h-0">
                  {renderWidget(widgetId)}
                </div>
              ))}
            </div>
          )}

          {/* Empty state when no widgets */}
          {rightWidgets.length === 0 && !showGlobe && (
            <div className="flex-1 flex items-center justify-center min-h-[300px]">
              <div className="text-center p-10">
                <div className="p-3 rounded-2xl bg-foreground/[0.03] w-fit mx-auto mb-4">
                  <SquaresFourIcon className="h-8 w-8 text-muted-foreground/40" />
                </div>
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
        <div className="lg:hidden mt-5 p-4 rounded-2xl bg-foreground/[0.02] ring-1 ring-foreground/[0.05] text-center">
          <Typography variant="secondary" className="text-xs">
            <GlobeIcon className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
            Globe visualization is available on larger screens
          </Typography>
        </div>
      )}
    </div>
  );
}
