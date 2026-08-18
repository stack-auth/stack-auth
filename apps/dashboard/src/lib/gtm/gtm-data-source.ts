import { loadGtmDataset, type GtmDatasetTarget } from "./gtm-api";
import { buildGtmDemoDataset, GTM_DEMO_NOW_MILLIS } from "./gtm-demo-data";
import type { GtmDataset } from "./gtm-types";

export function getGtmDemoDataset(): GtmDataset {
  return buildGtmDemoDataset(GTM_DEMO_NOW_MILLIS);
}

export async function resolveGtmDataset(app: object, demo: boolean, target: GtmDatasetTarget): Promise<GtmDataset> {
  if (demo) return getGtmDemoDataset();
  return await loadGtmDataset(app, target);
}
