import type { Release } from "./types";

export const RELEASES: Release[] = [
  {
    id: "rel-147",
    version: "v1.0.47",
    title: "Enterprise Roles Update",
    status: "draft",
    commits: [
      { sha: "a1b2c3d", message: "Add organization_roles table", author: "maya" },
      { sha: "e4f5g6h", message: "Wire invitations to custom roles", author: "jordan" },
      { sha: "i7j8k9l", message: "Backfill default admin role", author: "maya" },
      { sha: "m0n1o2p", message: "Gate custom roles behind flag", author: "sam" },
      { sha: "q3r4s5t", message: "Fix SSO provisioning null email path", author: "jordan" },
      { sha: "u6v7w8x", message: "Update invite email copy", author: "priya" },
      { sha: "y9z0a1b", message: "Add role audit events", author: "maya" },
      { sha: "c2d3e4f", message: "Compat expand: add role_id nullable", author: "sam" },
      { sha: "g5h6i7j", message: "Compat expand: dual-write roles", author: "sam" },
      { sha: "k8l9m0n", message: "Defer drop of legacy_role", author: "sam" },
      { sha: "o1p2q3r", message: "Dashboard: roles settings page", author: "priya" },
      { sha: "s4t5u6v", message: "E2E: invite with custom role", author: "jordan" },
    ],
    migrationCount: 1,
    featureFlags: [
      { id: "ff-custom-roles", name: "custom_roles", description: "Enable custom organization roles" },
      { id: "ff-role-audit", name: "role_audit_events", description: "Emit audit events for role changes" },
    ],
    blastRadiusUsers: 84_000,
    blastRadiusArrUsd: 1_400_000,
    versionWindow: { from: "v1.0.46", to: "v1.0.47" },
    stages: [
      { id: "stage-1", label: "Internal orgs", segment: "Hexclave Internal", users: 86, orgs: 1, arrUsd: 0, status: "pending", healthGate: "waiting" },
      { id: "stage-2", label: "20% of free orgs", segment: "Free plan sample", users: 420, orgs: 48, arrUsd: 0, status: "pending", healthGate: "waiting" },
      { id: "stage-3", label: "Small paid orgs", segment: "Starter + Growth", users: 6_950, orgs: 312, arrUsd: 38_000, status: "pending", healthGate: "waiting" },
      { id: "stage-4", label: "Enterprise without custom roles", segment: "Enterprise (default roles)", users: 18_200, orgs: 14, arrUsd: 420_000, status: "pending", healthGate: "waiting" },
      { id: "stage-5", label: "Everyone", segment: "All remaining tenants", users: 58_344, orgs: 1_840, arrUsd: 942_000, status: "pending", healthGate: "waiting" },
    ],
    buildLog: [
      { id: "bl-1", step: "install", text: "Detected Next.js 15.2 · using cached node_modules", delayMs: 200, level: "info" },
      { id: "bl-2", step: "install", text: "pnpm install — 0 added, cache hit", delayMs: 400, level: "success" },
      { id: "bl-3", step: "check", text: "Running lint + typecheck gates…", delayMs: 300, level: "info" },
      { id: "bl-4", step: "check", text: "Checks passed (12s)", delayMs: 500, level: "success" },
      { id: "bl-5", step: "build", text: "Compiling application…", delayMs: 400, level: "info" },
      { id: "bl-6", step: "build", text: "Collecting page data · 48 routes", delayMs: 600, level: "info" },
      { id: "bl-7", step: "build", text: "Build complete · 41.2 MB output", delayMs: 500, level: "success" },
      { id: "bl-8", step: "deploy", text: "Uploading build artifacts…", delayMs: 400, level: "info" },
      { id: "bl-9", step: "deploy", text: "Skew protection enabled for v1.0.46 ↔ v1.0.47", delayMs: 300, level: "info" },
      { id: "bl-10", step: "deploy", text: "Ready — awaiting rollout start", delayMs: 200, level: "success" },
    ],
    framework: "Next.js",
    connectedRepo: "acme/app · main",
  },
  {
    id: "rel-146",
    version: "v1.0.46",
    title: "Invite reliability",
    status: "complete",
    commits: [
      { sha: "prev001", message: "Retry invite email delivery", author: "priya" },
      { sha: "prev002", message: "Harden SSO null-email path", author: "jordan" },
    ],
    migrationCount: 0,
    featureFlags: [],
    blastRadiusUsers: 84_000,
    blastRadiusArrUsd: 1_400_000,
    versionWindow: { from: "v1.0.46", to: "v1.0.46" },
    stages: [
      { id: "s146-1", label: "Everyone", segment: "All tenants", users: 84_000, orgs: 2_215, arrUsd: 1_400_000, status: "complete", healthGate: "passing" },
    ],
    buildLog: [],
    framework: "Next.js",
    connectedRepo: "acme/app · main",
  },
];

export function releaseById(id: string): Release {
  const release = RELEASES.find((r) => r.id === id);
  if (release == null) {
    throw new Error(`Unknown release id: ${id}`);
  }
  return release;
}

export const ACTIVE_RELEASE_ID = "rel-147";
