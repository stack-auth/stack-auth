"use client";

import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";

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
 * Get uninstalled app IDs (available but not installed)
 */
export function getUninstalledAppIds(installedApps: AppId[]): AppId[] {
  const installedSet = new Set(installedApps);
  return getAllAvailableAppIds().filter(appId => !installedSet.has(appId));
}

