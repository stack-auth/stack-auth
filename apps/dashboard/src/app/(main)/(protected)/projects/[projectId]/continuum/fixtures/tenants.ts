import type { Tenant, TenantCell } from "./types";

export const TENANTS: Tenant[] = [
  { id: "t-atlas", name: "Atlas Health", plan: "enterprise", arrUsd: 84_000, userCount: 12_400, residency: "US" },
  { id: "t-northstar", name: "Northstar Legal", plan: "enterprise", arrUsd: 62_000, userCount: 8_200, residency: "US" },
  { id: "t-lumen", name: "Lumen Finance", plan: "enterprise", arrUsd: 38_000, userCount: 5_100, residency: "EU" },
  { id: "t-bright", name: "Brightpath Schools", plan: "growth", arrUsd: 18_400, userCount: 3_200, residency: "US" },
  { id: "t-orbit", name: "Orbit Retail", plan: "growth", arrUsd: 12_200, userCount: 2_800, residency: "US" },
  { id: "t-cascade", name: "Cascade Labs", plan: "starter", arrUsd: 4_800, userCount: 640, residency: "US" },
  { id: "t-pine", name: "Pine & Co", plan: "starter", arrUsd: 2_400, userCount: 310, residency: "CA" },
  { id: "t-free-1", name: "Hobby Desk", plan: "free", arrUsd: 0, userCount: 12, residency: "US" },
  { id: "t-free-2", name: "Weekend Builders", plan: "free", arrUsd: 0, userCount: 8, residency: "EU" },
  { id: "t-internal", name: "Hexclave Internal", plan: "enterprise", arrUsd: 0, userCount: 86, residency: "US" },
];

export const CELLS: TenantCell[] = [
  {
    id: "cell-atlas",
    tenantId: "t-atlas",
    state: "healthy",
    releaseVersion: "v1.0.46",
    dbBranchId: "db-prod",
    regionId: "us-east",
    provider: "AWS",
    recovery: { mode: "warm-standby", standbyProvider: "GCP", standbyRegion: "us-central", rpoSeconds: 5, rtoSeconds: 30 },
    replicationLagMs: 42,
    lastHealthyAt: "2026-07-10T17:40:00.000Z",
  },
  {
    id: "cell-northstar",
    tenantId: "t-northstar",
    state: "healthy",
    releaseVersion: "v1.0.46",
    dbBranchId: "db-prod",
    regionId: "us-east",
    provider: "AWS",
    recovery: { mode: "warm-standby", standbyProvider: "Azure", standbyRegion: "eastus", rpoSeconds: 5, rtoSeconds: 45 },
    replicationLagMs: 38,
    lastHealthyAt: "2026-07-10T17:40:00.000Z",
  },
  {
    id: "cell-lumen",
    tenantId: "t-lumen",
    state: "healthy",
    releaseVersion: "v1.0.46",
    dbBranchId: "db-prod-eu",
    regionId: "eu-west",
    provider: "AWS",
    recovery: { mode: "warm-standby", standbyProvider: "GCP", standbyRegion: "europe-west", rpoSeconds: 8, rtoSeconds: 40 },
    replicationLagMs: 55,
    lastHealthyAt: "2026-07-10T17:39:00.000Z",
  },
  {
    id: "cell-bright",
    tenantId: "t-bright",
    state: "healthy",
    releaseVersion: "v1.0.47",
    dbBranchId: "db-prod",
    regionId: "us-west",
    provider: "GCP",
    recovery: { mode: "cold", standbyProvider: "AWS", standbyRegion: "us-west", rpoSeconds: 300, rtoSeconds: 900 },
    replicationLagMs: 0,
    lastHealthyAt: "2026-07-10T17:41:00.000Z",
  },
  {
    id: "cell-orbit",
    tenantId: "t-orbit",
    state: "healthy",
    releaseVersion: "v1.0.47",
    dbBranchId: "db-prod",
    regionId: "us-east",
    provider: "AWS",
    recovery: { mode: "cold", standbyProvider: "AWS", standbyRegion: "us-west", rpoSeconds: 300, rtoSeconds: 900 },
    replicationLagMs: 0,
    lastHealthyAt: "2026-07-10T17:41:00.000Z",
  },
  {
    id: "cell-cascade",
    tenantId: "t-cascade",
    state: "healthy",
    releaseVersion: "v1.0.47",
    dbBranchId: "db-prod",
    regionId: "us-east",
    provider: "AWS",
    recovery: { mode: "cold", standbyProvider: "AWS", standbyRegion: "us-east", rpoSeconds: 600, rtoSeconds: 1_800 },
    replicationLagMs: 0,
    lastHealthyAt: "2026-07-10T17:41:00.000Z",
  },
  {
    id: "cell-pine",
    tenantId: "t-pine",
    state: "healthy",
    releaseVersion: "v1.0.47",
    dbBranchId: "db-prod",
    regionId: "ca-central",
    provider: "Azure",
    recovery: { mode: "cold", standbyProvider: "Azure", standbyRegion: "canadaeast", rpoSeconds: 600, rtoSeconds: 1_800 },
    replicationLagMs: 0,
    lastHealthyAt: "2026-07-10T17:40:00.000Z",
  },
  {
    id: "cell-free-1",
    tenantId: "t-free-1",
    state: "healthy",
    releaseVersion: "v1.0.47",
    dbBranchId: "db-prod",
    regionId: "us-east",
    provider: "AWS",
    recovery: { mode: "cold", standbyProvider: "AWS", standbyRegion: "us-east", rpoSeconds: 3_600, rtoSeconds: 7_200 },
    replicationLagMs: 0,
    lastHealthyAt: "2026-07-10T17:41:00.000Z",
  },
  {
    id: "cell-free-2",
    tenantId: "t-free-2",
    state: "healthy",
    releaseVersion: "v1.0.47",
    dbBranchId: "db-prod-eu",
    regionId: "eu-west",
    provider: "AWS",
    recovery: { mode: "cold", standbyProvider: "AWS", standbyRegion: "eu-west", rpoSeconds: 3_600, rtoSeconds: 7_200 },
    replicationLagMs: 0,
    lastHealthyAt: "2026-07-10T17:41:00.000Z",
  },
  {
    id: "cell-internal",
    tenantId: "t-internal",
    state: "healthy",
    releaseVersion: "v1.0.47",
    dbBranchId: "db-prod",
    regionId: "us-east",
    provider: "AWS",
    recovery: { mode: "active-active", standbyProvider: "GCP", standbyRegion: "us-central", rpoSeconds: 0, rtoSeconds: 0 },
    replicationLagMs: 12,
    lastHealthyAt: "2026-07-10T17:42:00.000Z",
  },
];

export function tenantById(id: string): Tenant {
  const tenant = TENANTS.find((t) => t.id === id);
  if (tenant == null) {
    throw new Error(`Unknown tenant id: ${id}`);
  }
  return tenant;
}

export function cellById(id: string): TenantCell {
  const cell = CELLS.find((c) => c.id === id);
  if (cell == null) {
    throw new Error(`Unknown cell id: ${id}`);
  }
  return cell;
}

export function cellsWithTenants() {
  return CELLS.map((cell) => ({ cell, tenant: tenantById(cell.tenantId) }));
}

export const OVERVIEW_METRICS = {
  revenueExposedUsd: 184_000,
  cellsHealthy: 10,
  cellsTotal: 10,
  recoveryFreshnessSeconds: 42,
  activeVersionWindow: { from: "v1.0.46", to: "v1.0.47" },
} as const;
