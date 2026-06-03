import { ALL_APPS } from "../../packages/stack-shared/src/apps/apps-config";

export type DashboardReferencePage = {
  slug: string,
  dashboardNavLabel: string,
  title: string,
  description: string,
  sidebarTitle?: string,
};

export type DashboardReferenceApp = {
  appId: string,
  groupLabel: string,
  icon: string,
  pages: DashboardReferencePage[],
};

export type DiscoveredNavigableApp = {
  appId: string,
  navLabels: string[],
};

/** Maps dashboard `navigationItems[].displayName` to URL slug when slugify is insufficient. */
const NAV_LABEL_SLUG_OVERRIDES: Record<string, Record<string, string>> = {
  payments: {
    "Products & Items": "products-and-items",
  },
  neon: {
    "Neon Integration": "neon-integration",
  },
  convex: {
    "Convex Integration": "convex-integration",
  },
};

export const DASHBOARD_REFERENCE_PLACEHOLDER_BODY = [
  "No dashboard reference documentation is available for this page yet.",
  "",
  "To document this screen, add a `@dashboardReference` JSDoc block on the dashboard `page-client.tsx` for this route (see `api-keys-app/page-client.tsx` for an example).",
].join("\n");

export function dashboardNavLabelToSlug(appId: string, dashboardNavLabel: string): string {
  const override = NAV_LABEL_SLUG_OVERRIDES[appId]?.[dashboardNavLabel];
  if (override != null) {
    return override;
  }
  return dashboardNavLabel
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultPageMetadata(appId: string, dashboardNavLabel: string): DashboardReferencePage {
  const app = ALL_APPS[appId as keyof typeof ALL_APPS];
  return {
    slug: dashboardNavLabelToSlug(appId, dashboardNavLabel),
    dashboardNavLabel,
    title: dashboardNavLabel,
    description: `${dashboardNavLabel} in the ${app?.displayName ?? appId} app`,
    sidebarTitle: dashboardNavLabel,
  };
}

export function buildDashboardReferenceApps(
  discoveredApps: DiscoveredNavigableApp[],
): DashboardReferenceApp[] {
  const apps: DashboardReferenceApp[] = [];

  for (const { appId, navLabels } of discoveredApps) {
    const appConfig = ALL_APPS[appId as keyof typeof ALL_APPS];
    if (appConfig == null) {
      throw new Error(`Discovered dashboard app "${appId}" is missing from ALL_APPS in apps-config.ts`);
    }

    apps.push({
      appId,
      groupLabel: appConfig.displayName,
      icon: `/images/app-icons/${appId}.svg`,
      pages: navLabels.map((navLabel) => defaultPageMetadata(appId, navLabel)),
    });
  }

  return apps;
}

export function getDashboardReferenceDocPath(appId: string, slug: string): string {
  return `guides/dashboard-references/${appId}/${slug}`;
}

export function listDashboardReferencePages(apps: DashboardReferenceApp[]): Array<{
  app: DashboardReferenceApp,
  page: DashboardReferencePage,
  docPath: string,
}> {
  const result: Array<{
    app: DashboardReferenceApp,
    page: DashboardReferencePage,
    docPath: string,
  }> = [];
  for (const app of apps) {
    for (const page of app.pages) {
      result.push({
        app,
        page,
        docPath: getDashboardReferenceDocPath(app.appId, page.slug),
      });
    }
  }
  return result;
}
