export type { DashboardReferenceApp, DashboardReferencePage } from "./types";
export { DASHBOARD_REFERENCE_APPS } from "./definitions";

import { DASHBOARD_REFERENCE_APPS } from "./definitions";
import type { DashboardReferenceApp, DashboardReferencePage } from "./types";

export function getDashboardReferenceDocPath(appId: string, slug: string): string {
  return `guides/dashboard-references/${appId}/${slug}`;
}

export function listDashboardReferencePages(): Array<{
  app: DashboardReferenceApp,
  page: DashboardReferencePage,
  docPath: string,
}> {
  const result: Array<{
    app: DashboardReferenceApp,
    page: DashboardReferencePage,
    docPath: string,
  }> = [];
  for (const app of DASHBOARD_REFERENCE_APPS) {
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
