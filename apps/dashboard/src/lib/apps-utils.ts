"use client";

import { ALL_APPS_FRONTEND, hasNavigationItems } from "@/lib/apps-frontend";
import { ALL_APPS, getParentAppId, type AppId } from "@hexclave/shared/dist/apps/apps-config";

type InstalledAppConfig = {
  enabled?: boolean,
} | undefined;

export type InstalledAppsMap = Record<string, InstalledAppConfig>;

// Typed wide on purpose: any given app's stage is a single literal, so a
// narrowed lookup type would make each caller's null check read as
// "always true/false" and rot the moment that app's stage changes.
const STAGE_LABELS: Record<"alpha" | "beta" | "stable", string | null> = { alpha: "Alpha", beta: "Beta", stable: null };

/**
 * The badge text for an app's maturity, or null once it is stable (a "Stable"
 * badge on every page would be noise). Derived from the app registry so a page
 * header can't go stale when the app graduates.
 */
export function getAppStageLabel(appId: AppId): string | null {
  return STAGE_LABELS[ALL_APPS[appId].stage];
}

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
  const parentAppId = getParentAppId(appId);
  if (parentAppId != null) {
    return installedApps[parentAppId]?.enabled ?? false;
  }
  return installedApps[appId]?.enabled ?? false;
}

/**
 * Get all enabled app IDs using centralized enabled/sub-app logic.
 *
 * Unlike `getAllAvailableAppIds`, this intentionally includes alpha-stage apps
 * that are explicitly enabled. The alpha filter only gates *discovery*
 * (app store listing, onboarding wizard), not functionality.
 */
export function getEnabledAppIds(installedApps: InstalledAppsMap): AppId[] {
  return (Object.keys(ALL_APPS) as AppId[]).filter((appId) => isAppEnabled(installedApps, appId));
}

/**
 * Get enabled apps that expose sidebar/cmdk navigation items.
 */
export function getEnabledNavigableAppIds(installedApps: InstalledAppsMap): AppId[] {
  return getEnabledAppIds(installedApps).filter((appId) =>
    getParentAppId(appId) == null && hasNavigationItems(ALL_APPS_FRONTEND[appId])
  );
}

/**
 * Get uninstalled app IDs (available but not installed)
 */
export function getUninstalledAppIds(installedApps: AppId[]): AppId[] {
  const installedSet = new Set(installedApps);
  return getAllAvailableAppIds().filter(appId => !installedSet.has(appId));
}
