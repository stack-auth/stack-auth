import type { ContinuumMapEdge, ContinuumMapNode, ContinuumRegion } from "./types";

export const REGIONS: ContinuumRegion[] = [
  { id: "us-east", label: "US East", provider: "AWS", x: 210, y: 150 },
  { id: "us-west", label: "US West", provider: "GCP", x: 140, y: 160 },
  { id: "us-central", label: "US Central", provider: "GCP", x: 175, y: 155 },
  { id: "eu-west", label: "EU West", provider: "AWS", x: 400, y: 125 },
  { id: "ca-central", label: "Canada", provider: "Azure", x: 200, y: 110 },
  { id: "eastus", label: "Azure East", provider: "Azure", x: 225, y: 145 },
];

/** Block size used by the HTML canvas nodes. Positions are block centers. */
export const NODE_SIZE = { width: 188, height: 78 } as const;

/**
 * Railway/n8n-style layout: customers across the top, cells under them,
 * shared release + database in the middle, clouds along the bottom.
 */
export const MAP_NODES: ContinuumMapNode[] = [
  { id: "n-atlas", label: "Atlas Health", kind: "customer", x: 160, y: 90, health: "healthy", subtitle: "$84k ARR" },
  { id: "n-northstar", label: "Northstar Legal", kind: "customer", x: 420, y: 90, health: "healthy", subtitle: "$62k ARR" },
  { id: "n-lumen", label: "Lumen Finance", kind: "customer", x: 680, y: 90, health: "healthy", subtitle: "$38k ARR" },
  { id: "n-cell-atlas", label: "Atlas cell", kind: "cell", x: 160, y: 230, health: "healthy", subtitle: "v1.0.46 · AWS" },
  { id: "n-cell-northstar", label: "Northstar cell", kind: "cell", x: 420, y: 230, health: "healthy", subtitle: "v1.0.46 · AWS" },
  { id: "n-cell-lumen", label: "Lumen cell", kind: "cell", x: 680, y: 230, health: "healthy", subtitle: "v1.0.46 · AWS" },
  { id: "n-release", label: "v1.0.47", kind: "release", x: 420, y: 380, health: "healthy", subtitle: "Enterprise Roles" },
  { id: "n-db", label: "Production DB", kind: "database", x: 420, y: 520, health: "healthy", subtitle: "both versions ok" },
  { id: "n-aws", label: "AWS", kind: "provider", x: 200, y: 660, health: "healthy", subtitle: "us-east" },
  { id: "n-gcp", label: "GCP", kind: "provider", x: 420, y: 660, health: "healthy", subtitle: "us-central" },
  { id: "n-azure", label: "Azure", kind: "provider", x: 640, y: 660, health: "healthy", subtitle: "eastus" },
];

export const MAP_EDGES: ContinuumMapEdge[] = [
  { id: "e-atlas-cell", source: "n-atlas", target: "n-cell-atlas", kind: "traffic", health: "healthy" },
  { id: "e-ns-cell", source: "n-northstar", target: "n-cell-northstar", kind: "traffic", health: "healthy" },
  { id: "e-lumen-cell", source: "n-lumen", target: "n-cell-lumen", kind: "traffic", health: "healthy" },
  { id: "e-cell-a-rel", source: "n-cell-atlas", target: "n-release", kind: "traffic", health: "healthy" },
  { id: "e-cell-n-rel", source: "n-cell-northstar", target: "n-release", kind: "traffic", health: "healthy" },
  { id: "e-cell-l-rel", source: "n-cell-lumen", target: "n-release", kind: "traffic", health: "healthy" },
  { id: "e-rel-db", source: "n-release", target: "n-db", kind: "traffic", health: "healthy" },
  { id: "e-db-aws", source: "n-db", target: "n-aws", kind: "replication", health: "healthy", label: "primary" },
  { id: "e-db-gcp", source: "n-db", target: "n-gcp", kind: "replication", health: "healthy", label: "standby" },
  { id: "e-failover", source: "n-cell-atlas", target: "n-gcp", kind: "failover", health: "healthy", label: "warm standby" },
];

export const VIEWBOX = { width: 860, height: 760 } as const;

export const CANVAS_BRANCHES = [
  { id: "production", label: "production" },
  { id: "feat-pricing", label: "feat-pricing" },
  { id: "dev/maya", label: "dev/maya" },
  { id: "clone/5gb-sample", label: "clone/5gb-sample" },
] as const;
