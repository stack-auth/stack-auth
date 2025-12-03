"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { AppSquare } from "@/components/app-square";
import { type AppId } from "@/lib/apps-frontend";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { cn } from "@stackframe/stack-ui";
import { CheckCircle2, LayoutGrid, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PageLayout } from "../page-layout";

// Simplified categories as tabs
const CATEGORIES: Array<{
  id: string,
  label: string,
  tags: string[],
  special?: boolean,
}> = [
  { id: "all", label: "All Apps", tags: [] },
  { id: "installed", label: "Installed", tags: [], special: true },
  { id: "auth", label: "Authentication", tags: ["auth"] },
  { id: "developer", label: "Developer", tags: ["developers"] },
  { id: "integration", label: "Integrations", tags: ["integration"] },
  { id: "expert", label: "Advanced", tags: ["expert", "security", "storage", "operations"] },
];

export default function PageClient() {
  const adminApp = useAdminApp()!;
  const project = adminApp.useProject();
  const config = project.useConfig();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Get installed apps
  const installedApps = useMemo(() =>
    (Object.entries(config.apps.installed) as [string, { enabled?: boolean } | undefined][])
      .filter(([_, appConfig]) => appConfig?.enabled)
      .map(([appId]) => appId as AppId),
    [config.apps.installed]
  );

  // Create a Set for O(1) lookups
  const installedAppsSet = useMemo(() => new Set(installedApps), [installedApps]);

  // Filter and categorize apps
  const filteredApps = useMemo(() => {
    let apps = Object.keys(ALL_APPS) as AppId[];

    // Filter out alpha apps in production
    if (process.env.NODE_ENV !== "development") {
      apps = apps.filter(appId => ALL_APPS[appId].stage !== "alpha");
    }

    // Apply category filter
    if (selectedCategory === "installed") {
      apps = apps.filter(appId => installedApps.includes(appId));
    } else if (selectedCategory !== "all") {
      const category = CATEGORIES.find(c => c.id === selectedCategory);
      if (category && category.tags.length > 0) {
        apps = apps.filter(appId =>
          ALL_APPS[appId].tags.some((tag: string) => category.tags.includes(tag))
        );
      }
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      apps = apps.filter(appId => {
        const app = ALL_APPS[appId];
        return app.displayName.toLowerCase().includes(query) ||
               app.subtitle.toLowerCase().includes(query) ||
               app.tags.some((tag: string) => tag.toLowerCase().includes(query));
      });
    }

    // Sort: installed first, then by name
    return apps.sort((a, b) => {
      const aInstalled = installedAppsSet.has(a);
      const bInstalled = installedAppsSet.has(b);
      if (aInstalled && !bInstalled) return -1;
      if (!aInstalled && bInstalled) return 1;
      return stringCompare(ALL_APPS[a].displayName, ALL_APPS[b].displayName);
    });
  }, [searchQuery, selectedCategory, installedApps, installedAppsSet]);

  // Get count for each category
  const getCategoryCount = (categoryId: string) => {
    if (categoryId === "installed") return installedApps.length;
    if (categoryId === "all") return Object.keys(ALL_APPS).filter(appId =>
      process.env.NODE_ENV === "development" || ALL_APPS[appId as AppId].stage !== "alpha"
    ).length;

    const category = CATEGORIES.find(c => c.id === categoryId);
    if (!category) return 0;

    return (Object.entries(ALL_APPS) as [AppId, typeof ALL_APPS[AppId]][]).filter(([appId, app]) => {
      if (process.env.NODE_ENV !== "development" && app.stage === "alpha") return false;
      return app.tags.some((tag: string) => category.tags.includes(tag));
    }).length;
  };

  return (
    <PageLayout fillWidth>
      <div className="max-w-[1400px] mx-auto w-full px-6">
        {/* Header Section */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <LayoutGrid className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              Apps
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Extend your project with powerful features and integrations
          </p>
        </div>

        {/* Search and Stats Bar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search apps..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "w-full pl-10 pr-4 py-2.5",
                "bg-white dark:bg-gray-900",
                "border border-gray-200 dark:border-gray-800",
                "rounded-xl",
                "text-sm",
                "placeholder:text-gray-400",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500",
                "transition-all"
              )}
            />
          </div>

          {installedApps.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 dark:bg-green-950/30 rounded-xl border border-green-200 dark:border-green-900">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-800 dark:text-green-300">
                {installedApps.length} app{installedApps.length !== 1 ? 's' : ''} installed
              </span>
            </div>
          )}
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1 mb-8 border-b border-gray-200 dark:border-gray-800 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {CATEGORIES.map((category) => {
            const count = getCategoryCount(category.id);
            const isActive = selectedCategory === category.id;

            return (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "px-3 sm:px-4 py-3 text-sm font-medium transition-all relative flex-shrink-0 whitespace-nowrap",
                  "hover:text-gray-900 dark:hover:text-gray-100",
                  isActive
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-gray-600 dark:text-gray-400"
                )}
              >
                <span className="flex items-center gap-2">
                  {category.label}
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded-full",
                    isActive
                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                  )}>
                    {count}
                  </span>
                </span>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Apps Grid */}
        {filteredApps.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredApps.map(appId => (
              <AppSquare
                key={appId}
                appId={appId}
                variant={installedAppsSet.has(appId) ? "installed" : "default"}
                showSubtitle={true}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">
              No apps found
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
              {searchQuery
                ? `No apps match "${searchQuery}". Try adjusting your search.`
                : "No apps available in this category."}
            </p>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
