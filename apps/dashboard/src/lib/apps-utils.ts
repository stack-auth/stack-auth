"use client";

import { ALL_APPS_FRONTEND, hasNavigationItems, isSubApp } from "@/lib/apps-frontend";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";

type InstalledAppConfig = {
  enabled?: boolean,
} | undefined;

export type InstalledAppsMap = Record<string, InstalledAppConfig>;

/**
 * Get all available app IDs, filtering out alpha apps in production
 */
export function getAllAvailableAppIds(): AppId[] {
  let apps = Object.keys(ALL_APPS) as AppId[];

  // Filter out alpha apps in production
  if (process.env.NODE_ENV !== "development") {
    apps = apps.filter(appId => ALL_APPS[appId].stage !== "alpha");
  }

  return apps;
}

/**
 * Determines whether an app is enabled.
 * - Regular apps are enabled via their own config entry.
 * - Sub-apps are enabled when their parent app is enabled.
 */
export function isAppEnabled(installedApps: InstalledAppsMap, appId: AppId): boolean {
  const appFrontend = ALL_APPS_FRONTEND[appId];
  if (isSubApp(appFrontend)) {
    return installedApps[appFrontend.parentAppId]?.enabled ?? false;
  }
  return installedApps[appId]?.enabled ?? false;
}

/**
 * Get all enabled app IDs using centralized enabled/sub-app logic.
 */
export function getEnabledAppIds(installedApps: InstalledAppsMap): AppId[] {
  return getAllAvailableAppIds().filter((appId) => isAppEnabled(installedApps, appId));
}

/**
 * Get enabled apps that expose sidebar/cmdk navigation items.
 */
export function getEnabledNavigableAppIds(installedApps: InstalledAppsMap): AppId[] {
  return getEnabledAppIds(installedApps).filter((appId) => hasNavigationItems(ALL_APPS_FRONTEND[appId]));
}

/**
 * Get uninstalled app IDs (available but not installed)
 */
export function getUninstalledAppIds(installedApps: AppId[]): AppId[] {
  const installedSet = new Set(installedApps);
  return getAllAvailableAppIds().filter(appId => !installedSet.has(appId));
}

