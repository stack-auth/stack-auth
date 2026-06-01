export type DashboardReferencePage = {
  /** URL slug under `guides/dashboard-references/<appId>/`. */
  slug: string,
  /** Must match `navigationItems[].displayName` in `apps/dashboard/src/lib/apps-frontend.tsx` for this app. */
  dashboardNavLabel: string,
  title: string,
  description: string,
  /** Mintlify sidebar label; defaults to `title`. */
  sidebarTitle?: string,
};

export type DashboardReferenceApp = {
  /** Matches the app key in `apps-frontend.tsx` (e.g. `emails`, `payments`). */
  appId: string,
  /** Mintlify group label in the Dashboard reference nav. */
  groupLabel: string,
  icon: string,
  pages: DashboardReferencePage[],
  /**
   * Dashboard nav labels that exist in the product but intentionally have no reference doc yet.
   * Validation will not fail if these are missing from `pages`.
   */
  undocumentedDashboardNavLabels?: string[],
};
