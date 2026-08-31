import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient, PrismaClientTransaction } from "@/prisma-client";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { GROWTH_METRIC_IDS, GrowthMetricId } from "./action-item-types";

/**
 * CRUD + seeding logic behind the internal/growth/milestones/* admin routes, kept out of the route
 * files the same way lib/growth/dashboard.ts backs the run/status routes. Wire shapes here must
 * match the frozen milestoneSchema in the dashboard's growth-api.ts exactly (snake_case fields,
 * created_at_millis).
 */

export const GROWTH_MILESTONE_COMPARATORS = ["gte"] as const;
export const GROWTH_MILESTONE_SOURCES = ["default", "user", "agent"] as const;
export const GROWTH_MILESTONE_STATUSES = ["armed", "reached", "disabled"] as const;
export type GrowthMilestoneStatus = typeof GROWTH_MILESTONE_STATUSES[number];

function assertMilestoneComparator(value: string): typeof GROWTH_MILESTONE_COMPARATORS[number] {
  return GROWTH_MILESTONE_COMPARATORS.find((candidate) => candidate === value)
    ?? throwErr(new HexclaveAssertionError(`GrowthMilestone.comparator contained an unknown value "${value}" — only "gte" exists in v1 and writes are validated, so this should be impossible.`, { value }));
}

function assertMilestoneSource(value: string): typeof GROWTH_MILESTONE_SOURCES[number] {
  return GROWTH_MILESTONE_SOURCES.find((candidate) => candidate === value)
    ?? throwErr(new HexclaveAssertionError(`GrowthMilestone.source contained an unknown value "${value}" — sources are only ever written from the fixed set, so this should be impossible.`, { value }));
}

function assertMilestoneStatus(value: string): GrowthMilestoneStatus {
  return GROWTH_MILESTONE_STATUSES.find((candidate) => candidate === value)
    ?? throwErr(new HexclaveAssertionError(`GrowthMilestone.status contained an unknown value "${value}" — statuses are only ever written from the fixed set, so this should be impossible.`, { value }));
}

function assertGrowthMetricId(value: string): GrowthMetricId {
  return GROWTH_METRIC_IDS.find((candidate) => candidate === value)
    ?? throwErr(new HexclaveAssertionError(`GrowthMilestone.metricId contained an unknown value "${value}" — metric ids are validated at write time against the registry, so this should be impossible.`, { value }));
}

// Structural row type instead of the generated Prisma model type (same rationale as
// GrowthActionItemRow in actions.ts): documents exactly which columns the wire mapping reads.
type GrowthMilestoneRow = {
  id: string,
  metricId: string,
  comparator: string,
  threshold: number,
  source: string,
  status: string,
  createdAt: Date,
};

export function growthMilestoneToWire(milestone: GrowthMilestoneRow) {
  return {
    id: milestone.id,
    metric_id: assertGrowthMetricId(milestone.metricId),
    comparator: assertMilestoneComparator(milestone.comparator),
    threshold: milestone.threshold,
    source: assertMilestoneSource(milestone.source),
    status: assertMilestoneStatus(milestone.status),
    created_at_millis: milestone.createdAt.getTime(),
  };
}

// ---------------------------------------------------------------------------
// Default seeding
// ---------------------------------------------------------------------------

/**
 * The default milestone ladder every project starts with: 10 / 100 / 1000 total users, "gte", armed.
 * Pure so the ladder itself is unit-testable without a database (see milestones.test.ts).
 */
export function getDefaultGrowthMilestones(): { metricId: GrowthMetricId, threshold: number }[] {
  return [10, 100, 1000].map((threshold) => ({ metricId: "total_users", threshold }));
}

/**
 * Seeds the default milestones exactly once per branch, called from onboarding. Idempotency is
 * "skip if ANY milestone rows exist for the branch" rather than checking for the specific default
 * rows: onboarding is the only thing that runs before any milestone can exist, so any pre-existing
 * row means a previous (possibly partially failed) attempt already seeded — re-seeding on retry
 * must not duplicate the ladder, and merging into user-created rows is never needed.
 */
export async function seedDefaultGrowthMilestones(client: PrismaClientTransaction, options: { projectId: string, branchId: string }): Promise<void> {
  const existingCount = await client.growthMilestone.count({
    where: { projectId: options.projectId, branchId: options.branchId },
  });
  if (existingCount > 0) {
    return;
  }
  await client.growthMilestone.createMany({
    data: getDefaultGrowthMilestones().map((milestone) => ({
      projectId: options.projectId,
      branchId: options.branchId,
      metricId: milestone.metricId,
      threshold: milestone.threshold,
      source: "default",
      status: "armed",
    })),
  });
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

export async function listGrowthMilestonesBody(tenancy: Tenancy) {
  const milestones = await globalPrismaClient.growthMilestone.findMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId },
    // Oldest first so the seeded ladder renders in its natural 10/100/1000 order and user additions
    // append below it. No pagination: milestones are a hand-curated list, bounded in practice.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return { items: milestones.map(growthMilestoneToWire) };
}

export async function createGrowthUserMilestone(tenancy: Tenancy, options: { metricId: string, threshold: number }) {
  const metricId = GROWTH_METRIC_IDS.find((candidate) => candidate === options.metricId)
    ?? throwErr(new StatusError(400, `Unknown growth metric id: ${options.metricId}`));
  if (!Number.isFinite(options.threshold) || options.threshold <= 0) {
    throw new StatusError(400, "threshold must be a positive number.");
  }
  const milestone = await globalPrismaClient.growthMilestone.create({
    data: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      metricId,
      // comparator defaults to "gte" in the schema; source/status are forced here — the admin API
      // only ever creates armed user milestones ("reached" is engine-owned, "agent"/"default" have
      // their own creation paths).
      threshold: options.threshold,
      source: "user",
      status: "armed",
    },
  });
  return growthMilestoneToWire(milestone);
}

async function requireMilestoneInTenancy(tenancy: Tenancy, milestoneId: string) {
  const milestone = await globalPrismaClient.growthMilestone.findFirst({
    where: { id: milestoneId, projectId: tenancy.project.id, branchId: tenancy.branchId },
  });
  if (milestone == null) {
    // Same 404 whether the milestone doesn't exist or belongs to another project — no id probing.
    throw new StatusError(404, "Milestone not found.");
  }
  return milestone;
}

/**
 * Validates a user-requested status change. Pure so the transition table is unit-testable. Users
 * may only toggle armed <-> disabled: "reached" is written exclusively by the engine when a
 * threshold crossing is recorded, and it is final — re-arming a reached milestone would let it fire
 * (and trigger a run) a second time, which v1's one-shot model deliberately excludes.
 */
export function assertUserMilestoneStatusTransition(current: GrowthMilestoneStatus, requested: string): asserts requested is "armed" | "disabled" {
  if (requested !== "armed" && requested !== "disabled") {
    throw new StatusError(400, `Milestones cannot be set to "${requested}" — only "armed" and "disabled" can be set by users.`);
  }
  if (current === "reached") {
    throw new StatusError(400, "This milestone has been reached and can no longer be changed.");
  }
}

export async function updateGrowthMilestoneBody(tenancy: Tenancy, milestoneId: string, options: { status: string | undefined }) {
  const milestone = await requireMilestoneInTenancy(tenancy, milestoneId);
  if (options.status === undefined) {
    // PATCH {} is a read-back of the current item (the contract makes status optional).
    return growthMilestoneToWire(milestone);
  }
  const currentStatus = assertMilestoneStatus(milestone.status);
  assertUserMilestoneStatusTransition(currentStatus, options.status);
  if (currentStatus === options.status) {
    return growthMilestoneToWire(milestone);
  }
  // CAS on the observed status so a concurrent engine flip to "reached" between the read above and
  // this write cannot be overwritten (mirroring the activate/dismiss convergence in actions.ts).
  const updated = await globalPrismaClient.growthMilestone.updateMany({
    where: { id: milestone.id, status: currentStatus },
    data: { status: options.status },
  });
  if (updated.count === 0) {
    const reloaded = await requireMilestoneInTenancy(tenancy, milestoneId);
    const reloadedStatus = assertMilestoneStatus(reloaded.status);
    if (reloadedStatus === options.status) {
      return growthMilestoneToWire(reloaded);
    }
    throw new StatusError(400, `This milestone is ${reloadedStatus} and can no longer be changed.`);
  }
  return growthMilestoneToWire(await requireMilestoneInTenancy(tenancy, milestoneId));
}

export async function deleteGrowthMilestoneBody(tenancy: Tenancy, milestoneId: string): Promise<{ status: "deleted" }> {
  const milestone = await requireMilestoneInTenancy(tenancy, milestoneId);
  // Hard delete (per the frozen contract's literal "deleted" ack). GrowthMilestoneEvent rows cascade
  // with it — losing the crossing history of a deleted milestone is accepted in v1. Analysis runs
  // are unaffected: GrowthAnalysisRun.milestoneEventId is a plain column, not a foreign key, so a
  // milestone-triggered run survives with a dangling event id by design.
  await globalPrismaClient.growthMilestone.delete({ where: { id: milestone.id } });
  return { status: "deleted" };
}
