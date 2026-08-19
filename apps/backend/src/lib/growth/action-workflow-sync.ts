import { WorkflowRunState } from "@/generated/prisma/enums";
import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import type { WorkflowTriggerJson } from "@hexclave/shared/dist/interface/workflows";
import { captureError, HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import type { GrowthWatchedMetric } from "./action-item-types";
// From action-item-wire.ts, NOT ./actions: actions.ts is where the ad-campaign write seam lands with
// the ad platform integration, and that seam must stay unreachable from this module — see
// action-item-wire.ts's module comment. This file is reachable from the growth-server cron/webhook
// routes via watchdog.ts -> dashboard.ts.
import { growthManifestTriggersIncludeActivationEvent, parseStoredGrowthWorkflowManifestTriggers, parseWatchedMetrics } from "./action-item-wire";

/**
 * The watchdog's action-item ↔ workflow completion sweep: decides when an ACTIVE workflow-bearing
 * GrowthActionItem is done and flips it to completed. Two completion models, classified from the
 * manifest stored on the item (never from live workflow state, which the customer may have edited):
 *
 * - One-shot (the workflow triggers on the item's own activation event): the item is done when the
 *   workflow's run completed. A FAILED run leaves the item active — the wire surfaces
 *   last_run_state so the dashboard can show the failure, and there is deliberately no
 *   auto-dismiss (locked decision: growth workflows tolerate customer interference; the item's
 *   fate stays a human call).
 * - Recurring/reactive (schedules or platform events): the workflow keeps running indefinitely;
 *   the ITEM completes once its metric watch window has fully elapsed since activation.
 *
 * A deleted WorkflowDefinition transitions nothing: the wire derives a "deleted" status and the
 * customer decides whether to dismiss the item.
 */

export type GrowthActionWorkflowClassification = "one-shot" | "recurring-or-reactive";

/** Pure classification from the stored manifest (workflow id + trigger list). */
export function classifyGrowthActionWorkflow(manifest: { workflowId: string, triggers: WorkflowTriggerJson[] }): GrowthActionWorkflowClassification {
  return growthManifestTriggersIncludeActivationEvent(manifest.triggers, manifest.workflowId) ? "one-shot" : "recurring-or-reactive";
}

/** Whether the item's longest metric watch window has fully elapsed since activation. */
export function hasGrowthWatchWindowElapsed(item: { watched: GrowthWatchedMetric[], activatedAt: Date }, now: Date): boolean {
  // Same `1` floor as getGrowthActionMetricsBody's maxWindowDays: an (impossible per write-time
  // validation) empty watch list still gets a 1-day window instead of completing instantly.
  const maxWindowDays = item.watched.reduce((acc, entry) => Math.max(acc, entry.windowDays), 1);
  return now.getTime() >= item.activatedAt.getTime() + maxWindowDays * 86_400_000;
}

/**
 * Pure run-state pick for one-shot items: the completedAt to stamp on the item, or null when the
 * item should stay active. `completedAt ?? now` covers a (theoretically impossible) COMPLETED run
 * without a completion timestamp — better a slightly-late timestamp than a wedged item.
 */
export function resolveGrowthOneShotCompletion(latestRun: { state: WorkflowRunState, completedAt: Date | null } | null, now: Date): Date | null {
  if (latestRun == null) return null; // event still in the outbox, or the definition never matched — keep waiting
  if (latestRun.state !== WorkflowRunState.COMPLETED) return null;
  return latestRun.completedAt ?? now;
}

export async function syncGrowthActionWorkflows(options: {
  now: Date,
  deadlineMs: number,
  /** Tenancy resolution is injected from the watchdog so its growth-app gating and per-sweep cache apply here too. */
  findTenancy: (projectId: string, branchId: string) => Promise<Tenancy | null>,
}): Promise<{ transitioned: number }> {
  // Bounded by the number of concurrently-active workflow-bearing recommendations across all
  // customers — a human activated each one, so this stays small.
  const items = await globalPrismaClient.growthActionItem.findMany({
    where: { status: "active", workflowDeployedAt: { not: null } },
    select: {
      id: true,
      projectId: true,
      branchId: true,
      workflowId: true,
      workflowManifest: true,
      watchedMetrics: true,
      activatedAt: true,
    },
  });
  let transitioned = 0;
  for (const item of items) {
    if (Date.now() >= options.deadlineMs) break;
    try {
      const workflowId = item.workflowId ?? throwErr(new HexclaveAssertionError(`GrowthActionItem ${item.id} has workflowDeployedAt but no workflowId — deployment only ever happens on workflow-bearing items.`, { itemId: item.id }));
      const tenancy = await options.findTenancy(item.projectId, item.branchId);
      if (tenancy == null) continue;
      const definition = await globalPrismaClient.workflowDefinition.findUnique({
        where: { tenancyId_workflowId: { tenancyId: tenancy.id, workflowId } },
        select: { workflowId: true },
      });
      // Customer deleted the workflow: nothing to transition (derived "deleted" wire status, no
      // auto-dismiss — see module comment).
      if (definition == null) continue;
      const triggers = parseStoredGrowthWorkflowManifestTriggers(item.workflowManifest ?? throwErr(new HexclaveAssertionError(`GrowthActionItem ${item.id} has workflowDeployedAt but no workflowManifest — the workflow columns are all-or-nothing at write time.`, { itemId: item.id })));
      let completedAt: Date | null;
      if (classifyGrowthActionWorkflow({ workflowId, triggers }) === "one-shot") {
        // Latest run overall, not runKey-filtered: the authoring rules mandate
        // runKey "activation" + onConflict "skip", so at most one activation run exists — but the
        // customer may have edited the source, and "newest run" stays a correct doneness signal
        // either way.
        const latestRun = await globalPrismaClient.workflowRun.findFirst({
          where: { tenancyId: tenancy.id, workflowId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { state: true, completedAt: true },
        });
        completedAt = resolveGrowthOneShotCompletion(latestRun, options.now);
      } else {
        const activatedAt = item.activatedAt ?? throwErr(new HexclaveAssertionError(`Active GrowthActionItem ${item.id} has no activatedAt — activation always stamps it.`, { itemId: item.id }));
        completedAt = hasGrowthWatchWindowElapsed({ watched: parseWatchedMetrics(item.watchedMetrics), activatedAt }, options.now) ? options.now : null;
      }
      if (completedAt == null) continue;
      // CAS so a concurrent dismiss (or a racing sweep) can't be overwritten.
      const updated = await globalPrismaClient.growthActionItem.updateMany({
        where: { id: item.id, status: "active" },
        data: { status: "completed", completedAt },
      });
      transitioned += updated.count;
    } catch (error) {
      // One broken item must not wedge the sweep for everyone else.
      captureError("growth-action-workflow-sync", new HexclaveAssertionError(`Growth action-workflow sweep failed for action item ${item.id}`, { cause: error, itemId: item.id }));
    }
  }
  return { transitioned };
}
