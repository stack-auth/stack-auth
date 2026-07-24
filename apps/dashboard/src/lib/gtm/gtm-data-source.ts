import { loadGtmDataset } from "./gtm-api";
import { buildGtmDemoDataset, GTM_DEMO_NOW_MILLIS } from "./gtm-demo-data";
import type { GtmDataset } from "./gtm-types";

export function getGtmDemoDataset(): GtmDataset {
  return buildGtmDemoDataset(GTM_DEMO_NOW_MILLIS);
}

export async function resolveGtmDataset(app: object, demo: boolean, projectId?: string): Promise<GtmDataset> {
  if (demo) return getGtmDemoDataset();
  return await loadGtmDataset(app, projectId);
}
