import type { ExperimentRun, Prisma } from "@/generated/prisma/client";
import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient, isPrismaError, retryTransaction } from "@/prisma-client";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { type ExperimentConfig, computeExperimentConfigRevisionHash, validateExperimentConfig } from "./experiment-config";

/**
 * Lifecycle management for experiment runs.
 *
 * State machine: DRAFT -> RUNNING <-> PAUSED -> COMPLETED (COMPLETED also
 * reachable directly from RUNNING; COMPLETED is terminal). Every transition is
 * a compare-and-swap (`updateMany` filtered on the expected current state), so
 * two concurrent transition calls can never both succeed — the loser observes
 * `count: 0` and gets a 409. On top of that, the ExperimentRun_active_run_key
 * partial unique index guarantees at most one RUNNING/PAUSED run per
 * project+branch+experiment even across independent create/start code paths.
 *
 * Immutability: configSnapshot / configRevisionHash / revisionNumber are
 * written exactly once (at creation, or replaced while still in DRAFT at
 * start) and no code path updates them afterwards. "Editing" an active run
 * means completing it and creating a successor row with revisionNumber + 1
 * in a single transaction (createNewRevision).
 */

export type ExperimentActor =
  | { type: "user", userId: string }
  | { type: "admin_key" }
  | { type: "system" };

export const EXPERIMENT_RUN_RESOURCE_TYPE = "experiment_run";

export function experimentRunNotFoundError(): StatusError {
  return new StatusError(StatusError.NotFound, "Experiment run not found");
}

function invalidTransitionError(action: string): StatusError {
  // 409 rather than 400: the request was well-formed, the run just isn't in a
  // state that allows this transition (possibly because a concurrent request
  // won the race).
  return new StatusError(StatusError.Conflict, `Experiment run cannot be ${action} in its current state`);
}

// The one-active-run constraint is a raw partial unique index (not in the
// Prisma schema), so we can only match on the P2002 code, not on
// isPrismaUniqueConstraintViolation's model/target metadata.
function isUniqueConstraintViolation(error: unknown): boolean {
  return isPrismaError(error, "UNIQUE_CONSTRAINT_VIOLATION");
}

type PrismaClientLike = typeof globalPrismaClient | Prisma.TransactionClient;

export async function logFeatureFlagAudit(prisma: PrismaClientLike, options: {
  tenancy: Tenancy,
  resourceType: string,
  resourceId: string,
  action: string,
  actor: ExperimentActor,
  source: string,
  beforeState?: Prisma.InputJsonValue,
  afterState?: Prisma.InputJsonValue,
  metadata?: Prisma.InputJsonValue,
}): Promise<void> {
  await prisma.featureFlagAuditLog.create({
    data: {
      projectId: options.tenancy.project.id,
      branchId: options.tenancy.branchId,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      action: options.action,
      actorType: options.actor.type,
      actorId: options.actor.type === "user" ? options.actor.userId : null,
      source: options.source,
      ...options.beforeState !== undefined ? { beforeState: options.beforeState } : {},
      ...options.afterState !== undefined ? { afterState: options.afterState } : {},
      ...options.metadata !== undefined ? { metadata: options.metadata } : {},
    },
  });
}

function runAuditState(run: ExperimentRun): Prisma.InputJsonValue {
  return {
    state: run.state,
    revision_number: run.revisionNumber,
    config_revision_hash: run.configRevisionHash,
  };
}

export async function listExperimentRuns(options: {
  tenancy: Tenancy,
  experimentId: string,
}): Promise<ExperimentRun[]> {
  return await globalPrismaClient.experimentRun.findMany({
    where: {
      projectId: options.tenancy.project.id,
      branchId: options.tenancy.branchId,
      experimentId: options.experimentId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getExperimentRun(options: {
  tenancy: Tenancy,
  experimentId: string,
  runId: string,
}): Promise<ExperimentRun> {
  const run = await globalPrismaClient.experimentRun.findUnique({ where: { id: options.runId } });
  // Tenancy scoping: a run id from another project/branch/experiment must be
  // indistinguishable from a nonexistent one.
  if (run == null || run.projectId !== options.tenancy.project.id || run.branchId !== options.tenancy.branchId || run.experimentId !== options.experimentId) {
    throw experimentRunNotFoundError();
  }
  return run;
}

export async function createExperimentRun(options: {
  tenancy: Tenancy,
  experimentId: string,
  config: unknown,
  actor: ExperimentActor,
  source: string,
}): Promise<ExperimentRun> {
  const config = await validateExperimentConfig(options.config);
  const configRevisionHash = computeExperimentConfigRevisionHash(config);
  const latestRun = await globalPrismaClient.experimentRun.findFirst({
    where: {
      projectId: options.tenancy.project.id,
      branchId: options.tenancy.branchId,
      experimentId: options.experimentId,
    },
    orderBy: { revisionNumber: "desc" },
    select: { revisionNumber: true },
  });
  const run = await retryTransaction(globalPrismaClient, async (tx) => {
    const created = await tx.experimentRun.create({
      data: {
        id: generateUuid(),
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
        experimentId: options.experimentId,
        // Concurrent creates may produce duplicate revision numbers for DRAFT
        // runs; that's fine — revision numbers only become meaningful (and
        // strictly increasing) along the RUNNING chain created by
        // createNewRevision, which recomputes from the completed predecessor.
        revisionNumber: (latestRun?.revisionNumber ?? 0) + 1,
        configRevisionHash,
        // Prisma JSON columns accept the validated plain-JSON config; the type
        // system can't see through `unknown`-typed metric fields, so serialize
        // through JSON to guarantee a plain value.
        configSnapshot: JSON.parse(JSON.stringify(config)),
        state: "DRAFT",
        scheduledStartAt: config.schedule?.start_at_millis != null ? new Date(config.schedule.start_at_millis) : null,
        scheduledEndAt: config.schedule?.end_at_millis != null ? new Date(config.schedule.end_at_millis) : null,
        createdByUserId: options.actor.type === "user" ? options.actor.userId : null,
      },
    });
    await logFeatureFlagAudit(tx, {
      tenancy: options.tenancy,
      resourceType: EXPERIMENT_RUN_RESOURCE_TYPE,
      resourceId: created.id,
      action: "created",
      actor: options.actor,
      source: options.source,
      afterState: runAuditState(created),
    });
    return created;
  });
  return run;
}

async function transitionExperimentRun(options: {
  tenancy: Tenancy,
  experimentId: string,
  runId: string,
  actor: ExperimentActor,
  source: string,
  action: "started" | "paused" | "resumed" | "completed",
  fromStates: ("DRAFT" | "RUNNING" | "PAUSED")[],
  toState: "RUNNING" | "PAUSED" | "COMPLETED",
  extraData: Prisma.ExperimentRunUpdateManyMutationInput,
}): Promise<ExperimentRun> {
  const before = await getExperimentRun(options);
  let updatedCount: number;
  try {
    const updated = await globalPrismaClient.experimentRun.updateMany({
      where: { id: options.runId, state: { in: options.fromStates } },
      data: { state: options.toState, ...options.extraData },
    });
    updatedCount = updated.count;
  } catch (error) {
    // Starting/resuming can violate the one-active-run partial unique index if
    // another run for the same experiment is already RUNNING/PAUSED.
    if (isUniqueConstraintViolation(error)) {
      throw new StatusError(StatusError.Conflict, "Another run of this experiment is already active");
    }
    throw error;
  }
  if (updatedCount === 0) {
    throw invalidTransitionError(options.action);
  }
  if (updatedCount > 1) {
    throw new HexclaveAssertionError(`Transition matched ${updatedCount} runs for id ${options.runId}; id is the primary key so this should be impossible`);
  }
  const after = await globalPrismaClient.experimentRun.findUnique({ where: { id: options.runId } })
    ?? throwErr(`Experiment run ${options.runId} disappeared right after a successful transition`);
  await logFeatureFlagAudit(globalPrismaClient, {
    tenancy: options.tenancy,
    resourceType: EXPERIMENT_RUN_RESOURCE_TYPE,
    resourceId: options.runId,
    action: options.action,
    actor: options.actor,
    source: options.source,
    beforeState: runAuditState(before),
    afterState: runAuditState(after),
  });
  return after;
}

/**
 * Starts a DRAFT run. If `config` is passed, the snapshot and allocation are
 * re-frozen from it at this moment (the draft snapshot is provisional; what
 * matters — and becomes immutable — is what was live when traffic started).
 */
export async function startExperimentRun(options: {
  tenancy: Tenancy,
  experimentId: string,
  runId: string,
  actor: ExperimentActor,
  source: string,
  config?: unknown,
}): Promise<ExperimentRun> {
  let snapshotUpdate: Prisma.ExperimentRunUpdateManyMutationInput = {};
  if (options.config !== undefined) {
    const config = await validateExperimentConfig(options.config);
    snapshotUpdate = {
      configRevisionHash: computeExperimentConfigRevisionHash(config),
      configSnapshot: JSON.parse(JSON.stringify(config)),
      scheduledEndAt: config.schedule?.end_at_millis != null ? new Date(config.schedule.end_at_millis) : null,
    };
  }
  return await transitionExperimentRun({
    ...options,
    action: "started",
    fromStates: ["DRAFT"],
    toState: "RUNNING",
    extraData: { startedAt: new Date(), ...snapshotUpdate },
  });
}

export async function pauseExperimentRun(options: {
  tenancy: Tenancy,
  experimentId: string,
  runId: string,
  actor: ExperimentActor,
  source: string,
}): Promise<ExperimentRun> {
  return await transitionExperimentRun({
    ...options,
    action: "paused",
    fromStates: ["RUNNING"],
    toState: "PAUSED",
    extraData: { pausedAt: new Date() },
  });
}

export async function resumeExperimentRun(options: {
  tenancy: Tenancy,
  experimentId: string,
  runId: string,
  actor: ExperimentActor,
  source: string,
}): Promise<ExperimentRun> {
  return await transitionExperimentRun({
    ...options,
    action: "resumed",
    fromStates: ["PAUSED"],
    toState: "RUNNING",
    extraData: {},
  });
}

export async function completeExperimentRun(options: {
  tenancy: Tenancy,
  experimentId: string,
  runId: string,
  actor: ExperimentActor,
  source: string,
}): Promise<ExperimentRun> {
  return await transitionExperimentRun({
    ...options,
    action: "completed",
    fromStates: ["RUNNING", "PAUSED"],
    toState: "COMPLETED",
    extraData: { completedAt: new Date() },
  });
}

/**
 * "Edits" an active (RUNNING or PAUSED) run: completes it and creates an
 * immediately-RUNNING successor with the new config and revisionNumber + 1,
 * atomically. Exposures/results of the old revision stay attached to the old
 * run row; the new revision starts collecting from zero (subjects are
 * per-revision by design — a config change invalidates cross-revision
 * comparability).
 */
export async function createNewRevision(options: {
  tenancy: Tenancy,
  experimentId: string,
  runId: string,
  config: unknown,
  actor: ExperimentActor,
  source: string,
}): Promise<ExperimentRun> {
  const config = await validateExperimentConfig(options.config);
  const configRevisionHash = computeExperimentConfigRevisionHash(config);
  const before = await getExperimentRun(options);
  try {
    return await retryTransaction(globalPrismaClient, async (tx) => {
      const completed = await tx.experimentRun.updateMany({
        where: { id: options.runId, state: { in: ["RUNNING", "PAUSED"] } },
        data: { state: "COMPLETED", completedAt: new Date() },
      });
      if (completed.count === 0) {
        throw invalidTransitionError("revised");
      }
      const successor = await tx.experimentRun.create({
        data: {
          id: generateUuid(),
          projectId: options.tenancy.project.id,
          branchId: options.tenancy.branchId,
          experimentId: options.experimentId,
          revisionNumber: before.revisionNumber + 1,
          configRevisionHash,
          configSnapshot: JSON.parse(JSON.stringify(config)),
          state: "RUNNING",
          startedAt: new Date(),
          scheduledEndAt: config.schedule?.end_at_millis != null ? new Date(config.schedule.end_at_millis) : null,
          createdByUserId: options.actor.type === "user" ? options.actor.userId : null,
        },
      });
      await logFeatureFlagAudit(tx, {
        tenancy: options.tenancy,
        resourceType: EXPERIMENT_RUN_RESOURCE_TYPE,
        resourceId: options.runId,
        action: "completed",
        actor: options.actor,
        source: options.source,
        beforeState: runAuditState(before),
        metadata: { reason: "superseded_by_new_revision", successor_run_id: successor.id },
      });
      await logFeatureFlagAudit(tx, {
        tenancy: options.tenancy,
        resourceType: EXPERIMENT_RUN_RESOURCE_TYPE,
        resourceId: successor.id,
        action: "revision_created",
        actor: options.actor,
        source: options.source,
        afterState: runAuditState(successor),
        metadata: { predecessor_run_id: options.runId },
      });
      return successor;
    });
  } catch (error) {
    // Two concurrent revisions of the same run: the loser's updateMany matches
    // 0 rows (already COMPLETED) and throws inside the tx, or its insert
    // violates the one-active-run index — both surface as 409.
    if (isUniqueConstraintViolation(error)) {
      throw new StatusError(StatusError.Conflict, "Another run of this experiment is already active");
    }
    throw error;
  }
}

export type ScheduleProcessorResult = {
  started: number,
  completed: number,
};

/**
 * Processes scheduled runs across all projects: starts DRAFT runs whose
 * scheduledStartAt has passed, and completes RUNNING/PAUSED runs whose
 * scheduledEndAt has passed. Idempotent and concurrency-safe by construction:
 * every mutation is a per-row CAS on the expected state, so overlapping
 * processor invocations (or a processor racing a manual transition) simply
 * no-op on rows the other side already handled, and a start that would violate
 * the one-active-run index skips that run and reports it via the audit log
 * only when it actually transitioned.
 */
export async function processScheduledExperimentRuns(options: {
  now: Date,
  batchLimit: number,
}): Promise<ScheduleProcessorResult> {
  let started = 0;
  let completed = 0;

  const dueStarts = await globalPrismaClient.experimentRun.findMany({
    where: { state: "DRAFT", scheduledStartAt: { not: null, lte: options.now } },
    orderBy: { scheduledStartAt: "asc" },
    take: options.batchLimit,
    select: { id: true, projectId: true, branchId: true, experimentId: true, revisionNumber: true, configRevisionHash: true },
  });
  for (const run of dueStarts) {
    try {
      const updated = await globalPrismaClient.experimentRun.updateMany({
        where: { id: run.id, state: "DRAFT" },
        data: { state: "RUNNING", startedAt: new Date() },
      });
      if (updated.count === 0) continue;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // Another run of the experiment is active; leave this one in DRAFT so
        // it starts on a later tick once the active run finishes.
        continue;
      }
      throw error;
    }
    started++;
    await globalPrismaClient.featureFlagAuditLog.create({
      data: {
        projectId: run.projectId,
        branchId: run.branchId,
        resourceType: EXPERIMENT_RUN_RESOURCE_TYPE,
        resourceId: run.id,
        action: "started",
        actorType: "system",
        actorId: null,
        source: "schedule_processor",
        afterState: { state: "RUNNING", revision_number: run.revisionNumber, config_revision_hash: run.configRevisionHash },
      },
    });
  }

  const dueEnds = await globalPrismaClient.experimentRun.findMany({
    where: { state: { in: ["RUNNING", "PAUSED"] }, scheduledEndAt: { not: null, lte: options.now } },
    orderBy: { scheduledEndAt: "asc" },
    take: options.batchLimit,
    select: { id: true, projectId: true, branchId: true, experimentId: true, revisionNumber: true, configRevisionHash: true },
  });
  for (const run of dueEnds) {
    const updated = await globalPrismaClient.experimentRun.updateMany({
      where: { id: run.id, state: { in: ["RUNNING", "PAUSED"] } },
      data: { state: "COMPLETED", completedAt: new Date() },
    });
    if (updated.count === 0) continue;
    completed++;
    await globalPrismaClient.featureFlagAuditLog.create({
      data: {
        projectId: run.projectId,
        branchId: run.branchId,
        resourceType: EXPERIMENT_RUN_RESOURCE_TYPE,
        resourceId: run.id,
        action: "completed",
        actorType: "system",
        actorId: null,
        source: "schedule_processor",
        afterState: { state: "COMPLETED", revision_number: run.revisionNumber, config_revision_hash: run.configRevisionHash },
      },
    });
  }

  return { started, completed };
}
