// The pre-provisioned tenant project pool.
//
// Google's multi-tenant guidance (https://docs.cloud.google.com/run/docs/securing/multi-tenant)
// recommends assigning pre-created projects to tenants on demand, because creating a project,
// attaching billing (a brand-new project is briefly unknown to Cloud Billing), and enabling its
// APIs can take fifteen minutes — which blew every request budget in the deploy-start path.
// The pool moves ALL of that work off the request: a fully provisioned project is claimed from
// the bucket in two conditional PUTs, and replenishment runs in the background.
//
// State lives in the bucket (Marshal's only store), next to the domain registry:
//   tenants/<ns>.json                 — the namespace → project assignment, the idempotency anchor
//   gcp-project-pool/<projectId>.json — pool membership and claimed-by state
// The lazy fallback preserves the pre-pool behavior (deterministic per-namespace project id,
// provisioned synchronously) when the pool is empty or disabled — so a misconfigured pool size
// degrades to today's latency, never to a failed deploy.

import { getConfig } from "./config.js";
import { createTenantProjectManager } from "./gcp/manager.js";
import { pooledProjectId, type TenantProject, TenantProjectManager } from "./gcp/projects.js";
import { setTimeout as delay } from "node:timers/promises";
import {
  assignTenantProject,
  claimPoolProject,
  listPoolProjects,
  readTenantProjectAssignment,
  registerPoolProject,
  unclaimPoolProject,
} from "./store.js";

// The claim and the assignment write must both land for a pooled project to be considered
// taken: if the assignment write loses (a concurrent request for the same namespace won it),
// the claim is put back so the project is not stranded as claimed-by-a-loser.
async function claimFromPool(ns: string, manager: TenantProjectManager): Promise<TenantProject | null> {
  for (const { projectId, entry } of await listPoolProjects()) {
    if (entry.state !== "ready") continue;
    if (!(await claimPoolProject(projectId, ns))) continue;
    const assignedProjectId = await assignTenantProject(ns, projectId);
    if (assignedProjectId === projectId) {
      return await manager.describeActiveProject(projectId);
    }
    // This request lost the assignment race for its own namespace: another request assigned
    // a different (claimed) project first. Put our claim back and use the winner's project.
    await unclaimPoolProject(projectId, ns);
    return await manager.describeActiveProject(assignedProjectId);
  }
  return null;
}

export async function tenantProjectForNamespace(ns: string, manager: TenantProjectManager): Promise<TenantProject> {
  const assigned = await readTenantProjectAssignment(ns);
  if (assigned !== null) return await manager.describeActiveProject(assigned);

  const claimed = await claimFromPool(ns, manager);
  if (claimed !== null) {
    schedulePoolReplenishment();
    return claimed;
  }

  // Empty (or disabled) pool: today's lazy path. The deterministic id keeps concurrent first
  // deploys for one namespace converging on the same project even without the pool.
  const project = await manager.ensureForNamespace(ns);
  await assignTenantProject(ns, project.projectId);
  return project;
}

// ---------------------------------------------------------------------------
// Background replenishment

let inFlightReplenishment: Promise<void> | null = null;

// Fire-and-forget on purpose: the caller (server startup, a pool claim) must never wait on,
// or fail because of, provisioning that can take fifteen minutes. A failure is logged and the
// next trigger retries; there is no scheduler, so an idle Marshal with an empty pool stays
// empty until the next deploy — acceptable, because the lazy fallback covers exactly that case.
export function schedulePoolReplenishment(): void {
  if (inFlightReplenishment !== null) return;
  inFlightReplenishment = runReplenishment();
}

// The single background entrypoint: a failure is logged and the next trigger (startup or a
// pool claim) retries. Never throws to its fire-and-forget callers.
async function runReplenishment(): Promise<void> {
  try {
    await replenishPool();
  } catch (error) {
    console.error("replenishing the tenant project pool failed", error);
  } finally {
    inFlightReplenishment = null;
  }
}

export async function replenishPool(): Promise<void> {
  const size = getConfig().gcp.projectPoolSize;
  if (size <= 0) return;
  const manager = createTenantProjectManager();
  // Provisioning one pooled project can take twenty minutes on its own (billing
  // propagation is the long pole), and it fails transiently — a run loops with a delay
  // between attempts until the pool is full or this budget expires; the next claim or
  // server start schedules a fresh run either way.
  const runStartedAt = performance.now();
  const runBudgetMillis = 45 * 60 * 1000;
  const attemptDelayMillis = 60 * 1000;
  for (;;) {
    const projects = await listPoolProjects();
    const ready = projects.filter(({ entry }) => entry.state === "ready").length;
    if (ready >= size) return;
    if (performance.now() - runStartedAt > runBudgetMillis) {
      console.error(`tenant project pool still short after ${Math.round(runBudgetMillis / 60000)} minutes (ready=${ready}, size=${size}); the next trigger retries`);
      return;
    }
    const projectId = pooledProjectId({ envId: getConfig().envId, projectPrefix: getConfig().gcp.projectPrefix });
    try {
      await manager.provisionPooledProject(projectId);
      const registered = await registerPoolProject(projectId);
      if (!registered) {
        // Another replica registered the same random id in the meantime (vanishingly
        // unlikely, but a collision must not leave a second project unknown to the pool).
        await manager.deleteDisposableProject(projectId);
      }
    } catch (error) {
      // One project's failure (most often billing propagation) must not kill the run:
      // log, leave the half-provisioned project behind — the project lifecycle cleanup is
      // the final backstop for orphans — and try again after the delay.
      console.error(`provisioning pooled project ${JSON.stringify(projectId)} failed; retrying`, error);
      await delay(attemptDelayMillis);
    }
  }
}

export function resetPoolForTests(): void {
  inFlightReplenishment = null;
}

export function waitForScheduledReplenishmentForTests(): Promise<void> {
  return inFlightReplenishment ?? Promise.resolve();
}
