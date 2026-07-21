import { Prisma } from "@/generated/prisma/client";
import { createApiKeySet } from "@/lib/internal-api-keys";
import { getTenancy, Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import {
  WORKFLOW_RUN_MEMO_MAX_BYTES,
  WORKFLOW_SCHEDULE_TRIGGER_TYPE,
  WORKFLOW_STEP_MAX_ATTEMPTS,
  WORKFLOW_STEP_RETRY_BACKOFF_MS,
  type WorkflowDivergenceDiagnosticJson,
  type WorkflowManifestJson,
} from "@hexclave/shared/dist/interface/workflows";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { captureError, HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { deterministicWorkflowUuid, enqueueWorkflowEvent, enqueueWorkflowLifecycleEvent } from "./events";
import { areWorkflowsEnabled } from "./gate";
import { invokeWorkflowSandbox } from "./invoke";
import { listCronOccurrences, MAX_CATCHUP_WINDOW_MS, parseCronExpression } from "./cron";
import {
  WORKFLOWS_DEFAULT_LIMITS,
  WORKFLOWS_PROTOCOL_VERSION,
  type WorkflowSandboxEvent,
  type WorkflowSandboxInput,
  type WorkflowSandboxOutcome,
  type WorkflowSandboxStepBagEntry,
} from "./protocol";
import { getWorkflowsRuntimeEnv } from "./runtime-env";

// The workflow engine: tick-driven like the email queue. A cron route calls
// runWorkflowEngineStep() in a loop; each step (1) materializes due schedule
// occurrences into the event outbox, (2) processes unprocessed events into
// runs, (3) claims due runs with FOR UPDATE SKIP LOCKED and executes them in
// sandbox invocations, and (4) occasionally prunes retention. There is no
// locking around the tick itself — overlapping ticks are safe by
// construction: claims use SKIP LOCKED + leases, and everything in event
// processing is idempotent via deterministic ids (an event is only marked
// processed AFTER its runs exist, so a crash replays it and every insert
// no-ops).

const EVENT_BATCH_SIZE = 50;
// Kept small: the claim query's per-workflow concurrency filter only counts
// leases that exist BEFORE the batch, so one batch can overshoot the
// per-workflow cap by at most the batch size. The cap is flow control, not
// a hard isolation boundary — a small batch keeps the overshoot negligible.
const RUN_CLAIM_BATCH_SIZE = 5;
const PER_WORKFLOW_CONCURRENCY = 10;
// Lease must outlive the longest possible invocation (10min step cap +
// engine-side slack); an expired lease means the worker died and the run is
// re-claimable. Safe because of the idempotency floor.
const RUN_LEASE_MS = 12 * 60 * 1000;
// See the credential-minting comment in executeClaimedRun.
const WORKFLOW_RUN_CREDENTIAL_TTL_MS = 35 * 60 * 1000;
const INVOCATION_BACKSTOP_TIMEOUT_MS = WORKFLOWS_DEFAULT_LIMITS.maxStepTimeoutMs + 30 * 1000;
// How many steps a single claim may chain before handing the run back to
// the queue, so a hot run cannot starve others for a whole tick.
const MAX_CHAINED_STEPS_PER_CLAIM = 50;
const GENERIC_PLATFORM_ERROR_SUMMARY = "A platform error occurred while executing this workflow. The Hexclave team has been notified.";
// Sentinel step keys. "#" is reserved in user step ids (the runtime rejects
// it), so these can never collide with real steps. "#handler" marks failures
// thrown outside any step (handler top-level, module import, runKey fn);
// "#completion" carries the completing invocation's console output.
const HANDLER_STEP_KEY = "#handler";
const COMPLETION_STEP_KEY = "#completion";

function jitteredBackoffMs(attempt: number): number {
  // Backoff before retry N: 10s / 1m / 10m, jittered ±25%.
  const base = WORKFLOW_STEP_RETRY_BACKOFF_MS[Math.min(attempt - 1, WORKFLOW_STEP_RETRY_BACKOFF_MS.length - 1)];
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

const wallClockFormatterCache = new Map<string, Intl.DateTimeFormat>();
/** "2026-11-01 01:30" in the given timezone; the nominal identity of a schedule occurrence. */
function formatWallClockMinute(instant: Date, timezone: string): string {
  let formatter = wallClockFormatterCache.get(timezone);
  if (formatter == null) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    wallClockFormatterCache.set(timezone, formatter);
  }
  return formatter.format(instant);
}

function getWorkflowsSandboxApiUrl(): string {
  // Overridable because the sandbox may not share the backend's network
  // namespace: locally the Freestyle mock runs in Docker and reaches the
  // host via host.docker.internal, while in production the public API URL
  // works from anywhere.
  return getEnvVariable("HEXCLAVE_WORKFLOWS_SANDBOX_API_URL", "") || getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
}

// ─── Version loading (bundles are big; keep a tiny cache) ──────────────────

type VersionRow = {
  compiledBundle: string,
  manifest: WorkflowManifestJson,
  runtimeEnvVersion: string,
  version: number,
};

const versionCache = new Map<string, VersionRow>();
const VERSION_CACHE_MAX_ENTRIES = 20;

async function loadWorkflowVersion(tenancyId: string, workflowId: string, version: number): Promise<VersionRow | null> {
  const cacheKey = `${tenancyId}:${workflowId}:${version}`;
  const cached = versionCache.get(cacheKey);
  if (cached != null) return cached;
  const row = await globalPrismaClient.workflowVersion.findUnique({
    where: { tenancyId_workflowId_version: { tenancyId, workflowId, version } },
  });
  if (row == null) return null;
  const value: VersionRow = {
    compiledBundle: row.compiledBundle,
    manifest: row.manifest as WorkflowManifestJson,
    runtimeEnvVersion: row.runtimeEnvVersion,
    version: row.version,
  };
  // Versions are immutable, so eviction is purely about memory.
  if (versionCache.size >= VERSION_CACHE_MAX_ENTRIES) {
    const oldestKey = versionCache.keys().next().value;
    if (oldestKey != null) versionCache.delete(oldestKey);
  }
  versionCache.set(cacheKey, value);
  return value;
}

function getStdlibNodeModules(versionRow: VersionRow): Record<string, string> {
  const env = getWorkflowsRuntimeEnv(versionRow.runtimeEnvVersion);
  return Object.fromEntries(Object.entries(env.stdlibNodeModules).filter(([pkg]) => versionRow.manifest.uses_stdlib.includes(pkg)));
}

async function getEnabledTenancy(tenancyId: string, tenancyCache: Map<string, Tenancy | null>): Promise<Tenancy | null> {
  let tenancy = tenancyCache.get(tenancyId);
  if (tenancy === undefined) {
    tenancy = await getTenancy(tenancyId);
    tenancyCache.set(tenancyId, tenancy);
  }
  if (tenancy == null) return null;
  // The rollout gate, enforced at dispatch: disabled projects must not
  // execute anything even if rows somehow exist for them.
  if (!areWorkflowsEnabled(tenancy.project.id)) return null;
  return tenancy;
}

// ─── Schedule materialization ──────────────────────────────────────────────

type ScheduledDefinitionRow = {
  tenancyId: string,
  workflowId: string,
  latestVersion: number,
  manifest: WorkflowManifestJson,
};

async function materializeScheduleOccurrences(tenancyCache: Map<string, Tenancy | null>): Promise<boolean> {
  const definitions = await globalPrismaClient.$queryRaw<ScheduledDefinitionRow[]>(Prisma.sql`
    SELECT d."tenancyId", d."workflowId", d."latestVersion", v."manifest"
    FROM "WorkflowDefinition" d
    JOIN "WorkflowVersion" v
      ON v."tenancyId" = d."tenancyId" AND v."workflowId" = d."workflowId" AND v."version" = d."latestVersion"
    WHERE v."manifest"->'triggers' @> '[{"type":"schedule"}]'
  `);

  let didWork = false;
  for (const definition of definitions) {
    const tenancy = await getEnabledTenancy(definition.tenancyId, tenancyCache);
    if (tenancy == null) continue;

    for (const trigger of definition.manifest.triggers) {
      if (trigger.type !== "schedule") continue;
      const scheduleKey = `${trigger.cron}|${trigger.timezone}`;
      const cronResult = parseCronExpression(trigger.cron);
      if (cronResult.status === "error") {
        // Sync validates cron expressions, so this is a platform bug.
        captureError("workflow-schedule-invalid-cron", new HexclaveAssertionError(`Stored workflow schedule has invalid cron: ${cronResult.error}`, { definition }));
        continue;
      }

      const now = new Date();
      let cursor = await globalPrismaClient.workflowScheduleCursor.findUnique({
        where: { tenancyId_workflowId_scheduleKey: { tenancyId: definition.tenancyId, workflowId: definition.workflowId, scheduleKey } },
      });
      if (cursor == null) {
        // First sighting of this schedule: start the cursor now. There is no
        // retroactive materialization of occurrences from before the
        // schedule existed (or from before an edit — a changed cron/timezone
        // is a new scheduleKey and therefore a fresh cursor).
        await globalPrismaClient.workflowScheduleCursor.createMany({
          data: [{ tenancyId: definition.tenancyId, workflowId: definition.workflowId, scheduleKey, lastMaterializedAt: now }],
          skipDuplicates: true,
        });
        continue;
      }

      const windowStart = new Date(Math.max(cursor.lastMaterializedAt.getTime(), now.getTime() - MAX_CATCHUP_WINDOW_MS));
      const occurrences = listCronOccurrences(cronResult.data, trigger.timezone, windowStart, now);
      if (occurrences.length > 0) {
        // Deterministic per-occurrence event ids make this crash-safe
        // without a transaction: re-running after a crash between insert and
        // cursor update re-inserts the same ids, which no-op. Missed
        // occurrences CATCH UP (delayed, never skipped): each gets its
        // nominal scheduledAt, and the outbox processes in ascending
        // scheduledAt order.
        await globalPrismaClient.workflowEvent.createMany({
          data: occurrences.map((occurrence) => ({
            tenancyId: definition.tenancyId,
            // Keyed by the NOMINAL wall-clock occurrence, not the UTC
            // instant: during DST fall-back the repeated wall hour matches
            // at two UTC instants, and this collapses them into one
            // occurrence (skipDuplicates drops the second insert).
            id: deterministicWorkflowUuid(`schedule:${definition.tenancyId}:${definition.workflowId}:${scheduleKey}:${formatWallClockMinute(occurrence, trigger.timezone)}`),
            type: WORKFLOW_SCHEDULE_TRIGGER_TYPE,
            payload: {
              workflow_id: definition.workflowId,
              cron: trigger.cron,
              timezone: trigger.timezone,
              scheduled_at_millis: occurrence.getTime(),
            },
            scheduledAt: occurrence,
          })),
          skipDuplicates: true,
        });
        didWork = true;
      }
      await globalPrismaClient.workflowScheduleCursor.update({
        where: { tenancyId_workflowId_scheduleKey: { tenancyId: definition.tenancyId, workflowId: definition.workflowId, scheduleKey } },
        data: { lastMaterializedAt: now },
      });
    }
  }
  return didWork;
}

// ─── Event outbox processing (event -> run creation) ───────────────────────

type WorkflowEventRow = {
  tenancyId: string,
  id: string,
  type: string,
  payload: unknown,
  scheduledAt: Date,
};

type DefinitionWithManifest = {
  workflowId: string,
  latestVersion: number,
  manifest: WorkflowManifestJson,
};

async function listDefinitionsForTenancy(tenancyId: string, cache: Map<string, DefinitionWithManifest[]>): Promise<DefinitionWithManifest[]> {
  const cached = cache.get(tenancyId);
  if (cached != null) return cached;
  const rows = await globalPrismaClient.$queryRaw<DefinitionWithManifest[]>(Prisma.sql`
    SELECT d."workflowId", d."latestVersion", v."manifest"
    FROM "WorkflowDefinition" d
    JOIN "WorkflowVersion" v
      ON v."tenancyId" = d."tenancyId" AND v."workflowId" = d."workflowId" AND v."version" = d."latestVersion"
    WHERE d."tenancyId" = ${tenancyId}::uuid
  `);
  cache.set(tenancyId, rows);
  return rows;
}

function definitionMatchesEvent(definition: DefinitionWithManifest, event: WorkflowEventRow): boolean {
  if (event.type === WORKFLOW_SCHEDULE_TRIGGER_TYPE) {
    // Schedule occurrences are addressed to their owning workflow — they
    // must never fan out by type.
    const payload = event.payload as { workflow_id?: string } | null;
    return payload?.workflow_id === definition.workflowId && definition.manifest.triggers.some((t) => t.type === "schedule");
  }
  return definition.manifest.triggers.some((t) => t.type === "event" && t.event_type === event.type);
}

function eventToSandboxEvent(event: WorkflowEventRow): WorkflowSandboxEvent {
  return {
    id: event.id,
    type: event.type,
    tsMillis: event.scheduledAt.getTime(),
    data: event.payload,
  };
}

async function createRunForEvent(tenancy: Tenancy, event: WorkflowEventRow, definition: DefinitionWithManifest): Promise<void> {
  // Deterministic per (event, workflow): reprocessing after a crash (or a
  // concurrently overlapping tick) can never create a duplicate run.
  const runId = deterministicWorkflowUuid(`run:${tenancy.id}:${event.id}:${definition.workflowId}`);
  const existing = await globalPrismaClient.workflowRun.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: runId } },
    select: { id: true, runKey: true, version: true },
  });
  if (existing != null) {
    // This event was (at least partially) processed before — likely a crash
    // between the run insert and marking the event processed. The lifecycle
    // started event has a deterministic id, so re-enqueueing heals the case
    // where the crash also swallowed it, and no-ops otherwise.
    await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.started", run: { id: runId, workflowId: definition.workflowId, runKey: existing.runKey, version: existing.version, triggerType: event.type } });
    return;
  }

  const versionRow = await loadWorkflowVersion(tenancy.id, definition.workflowId, definition.latestVersion)
    ?? throwErr(`Workflow version ${definition.workflowId}@v${definition.latestVersion} missing while creating a run — versions are never deleted, so this should be impossible`);

  const triggerPayload = { ts_millis: event.scheduledAt.getTime(), data: event.payload };

  // runKey derivation happens at run CREATION, before any execution. It is a
  // pure function of the event, so the extra sandbox invocation is safe to
  // repeat on crash-replay.
  let runKey: string | null = null;
  if (versionRow.manifest.has_run_key) {
    const keyResult = await invokeWorkflowSandbox({
      compiledBundle: versionRow.compiledBundle,
      input: {
        protocolVersion: WORKFLOWS_PROTOCOL_VERSION,
        mode: "run-key",
        limits: WORKFLOWS_DEFAULT_LIMITS,
        event: eventToSandboxEvent(event),
      },
      nodeModules: getStdlibNodeModules(versionRow),
      timeoutMs: 60_000,
    });
    if (keyResult.status === "error") {
      // Platform failure: leave the event unprocessed (the throw aborts
      // marking it processed) so a later tick retries.
      throw new HexclaveAssertionError(`Workflow run-key invocation failed: ${keyResult.error.message}`, { tenancyId: tenancy.id, eventId: event.id, workflowId: definition.workflowId });
    }
    const outcome = keyResult.data;
    if (outcome.type === "handler-failed") {
      // The user's runKey function threw: record a FAILED run so the error
      // is visible in run history (user-error channel), and move on.
      await globalPrismaClient.$executeRaw(Prisma.sql`
        INSERT INTO "WorkflowRun" ("tenancyId", "id", "workflowId", "version", "runKey", "state", "triggerEventId", "triggerType", "triggerPayload", "failureKind", "errorSummary", "completedAt", "updatedAt")
        VALUES (${tenancy.id}::uuid, ${runId}::uuid, ${definition.workflowId}, ${versionRow.version}, NULL, 'FAILED', ${event.id}::uuid, ${event.type}, ${JSON.stringify(triggerPayload)}::jsonb, 'USER', ${`runKey function failed: ${outcome.error.name}: ${outcome.error.message}`}, NOW(), NOW())
        ON CONFLICT ("tenancyId", "id") DO NOTHING
      `);
      await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.failed", run: { id: runId, workflowId: definition.workflowId, runKey: null, version: versionRow.version, triggerType: event.type } });
      return;
    }
    if (outcome.type !== "run-key") {
      throw new HexclaveAssertionError(`Unexpected run-key outcome type ${outcome.type}`, { outcome });
    }
    runKey = outcome.runKey;
  }

  // The initial wakeAt is the event's scheduledAt (not "now") so that
  // schedule catch-up backlogs execute in ascending scheduledAt order — the
  // claim query orders by wakeAt.
  const insertRun = async (): Promise<boolean> => {
    const rows = await globalPrismaClient.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "WorkflowRun" ("tenancyId", "id", "workflowId", "version", "runKey", "state", "triggerEventId", "triggerType", "triggerPayload", "wakeAt", "updatedAt")
      VALUES (${tenancy.id}::uuid, ${runId}::uuid, ${definition.workflowId}, ${versionRow.version}, ${runKey}, 'QUEUED', ${event.id}::uuid, ${event.type}, ${JSON.stringify(triggerPayload)}::jsonb, ${event.scheduledAt}, NOW())
      ON CONFLICT ("tenancyId", "workflowId", "runKey", "isActive") DO NOTHING
      RETURNING "id"
    `);
    return rows.length > 0;
  };

  let inserted: boolean;
  try {
    inserted = await insertRun();
  } catch (error) {
    // A concurrent worker created the same deterministic run id between our
    // existence check and the insert — that's the pkey conflict (the
    // ON CONFLICT clause above only targets the runKey uniqueness index).
    if (error instanceof Error && error.message.includes("WorkflowRun_pkey")) return;
    throw error;
  }

  if (!inserted) {
    // The runKey uniqueness index rejected the insert: this key already has
    // an ACTIVE run. BEFORE applying onConflict semantics, check whether the
    // "conflicting" run is this event's own run, created by a concurrently
    // overlapping tick between our existence check and the insert. Postgres
    // reports the arbiter-index conflict without raising the pkey violation
    // in that case, so without this re-check a cancel-existing workflow
    // would cancel the legitimate run it itself just created.
    const concurrentlyCreated = await globalPrismaClient.workflowRun.findUnique({
      where: { tenancyId_id: { tenancyId: tenancy.id, id: runId } },
      select: { id: true },
    });
    if (concurrentlyCreated != null) return;
    switch (versionRow.manifest.on_conflict) {
      case "skip": {
        return;
      }
      case "error": {
        // Record the conflict as a FAILED run for auditability; terminal
        // runs have isActive NULL, so the key index does not object.
        await globalPrismaClient.$executeRaw(Prisma.sql`
          INSERT INTO "WorkflowRun" ("tenancyId", "id", "workflowId", "version", "runKey", "state", "triggerEventId", "triggerType", "triggerPayload", "failureKind", "errorSummary", "completedAt", "updatedAt")
          VALUES (${tenancy.id}::uuid, ${runId}::uuid, ${definition.workflowId}, ${versionRow.version}, ${runKey}, 'FAILED', ${event.id}::uuid, ${event.type}, ${JSON.stringify(triggerPayload)}::jsonb, 'USER', ${`runKey conflict: an active run already exists for key ${JSON.stringify(runKey)} (onConflict: "error")`}, NOW(), NOW())
          ON CONFLICT ("tenancyId", "id") DO NOTHING
        `);
        await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.failed", run: { id: runId, workflowId: definition.workflowId, runKey, version: versionRow.version, triggerType: event.type } });
        return;
      }
      case "cancel-existing": {
        // Restart semantics: cancel the active run for this key, then
        // insert. Bounded retry because another event may race us for the
        // freed key; losing that race twice in a row means the other event
        // won legitimately.
        for (let i = 0; i < 3; i++) {
          await cancelWorkflowRuns(tenancy, { workflowId: definition.workflowId, runKey: runKey ?? throwErr("cancel-existing conflict with null runKey should be impossible (null keys never conflict)") });
          let retryInserted: boolean;
          try {
            retryInserted = await insertRun();
          } catch (error) {
            // Same pkey race as the first insert: a concurrent worker owns
            // this deterministic run id, so the event is already handled.
            if (error instanceof Error && error.message.includes("WorkflowRun_pkey")) return;
            throw error;
          }
          if (retryInserted) {
            await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.started", run: { id: runId, workflowId: definition.workflowId, runKey, version: versionRow.version, triggerType: event.type } });
            return;
          }
        }
        captureError("workflow-cancel-existing-race", new HexclaveAssertionError("cancel-existing lost the runKey race 3 times in a row", { tenancyId: tenancy.id, eventId: event.id, workflowId: definition.workflowId, runKey }));
        return;
      }
    }
  }

  await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.started", run: { id: runId, workflowId: definition.workflowId, runKey, version: versionRow.version, triggerType: event.type } });
}

async function processWorkflowEvents(tenancyCache: Map<string, Tenancy | null>): Promise<boolean> {
  // No claim marker on purpose: events are only marked processed AFTER all
  // their runs exist, and run creation is idempotent (deterministic ids), so
  // crash-replays and overlapping ticks are safe — at-least-once with
  // no duplicate runs. The cost is occasional duplicate work under overlap.
  const events = await globalPrismaClient.$queryRaw<WorkflowEventRow[]>(Prisma.sql`
    SELECT "tenancyId", "id", "type", "payload", "scheduledAt"
    FROM "WorkflowEvent"
    WHERE "processedAt" IS NULL
    ORDER BY "scheduledAt" ASC
    LIMIT ${EVENT_BATCH_SIZE}
  `);
  if (events.length === 0) return false;

  const definitionCache = new Map<string, DefinitionWithManifest[]>();
  for (const event of events) {
    try {
      const tenancy = await getEnabledTenancy(event.tenancyId, tenancyCache);
      if (tenancy != null) {
        const definitions = await listDefinitionsForTenancy(event.tenancyId, definitionCache);
        for (const definition of definitions) {
          if (definitionMatchesEvent(definition, event)) {
            await createRunForEvent(tenancy, event, definition);
          }
        }
      }
      await globalPrismaClient.workflowEvent.update({
        where: { tenancyId_id: { tenancyId: event.tenancyId, id: event.id } },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      // Leave the event unprocessed; a later tick retries it. Head-of-line
      // events that fail forever keep being retried and reported — that's
      // deliberate (platform bugs must be fixed, not skipped), and they
      // don't block other events beyond shrinking the effective batch.
      captureError("workflow-event-processing", error);
    }
  }
  return true;
}

// ─── Run execution ─────────────────────────────────────────────────────────

type ClaimedRunRow = {
  tenancyId: string,
  id: string,
  workflowId: string,
  version: number,
  runKey: string | null,
  triggerEventId: string | null,
  triggerType: string,
  triggerPayload: unknown,
  currentStepAttempt: number,
  currentStepKey: string | null,
  memoTotalBytes: number,
  leaseToken: string,
  /** The state the run was claimed OUT OF — a SLEEPING claim means its durable timer just fired. */
  preClaimState: "QUEUED" | "SLEEPING" | "RUNNING",
  preClaimWakeAt: Date | null,
};

async function claimDueRuns(): Promise<ClaimedRunRow[]> {
  return await globalPrismaClient.$queryRaw<ClaimedRunRow[]>(Prisma.sql`
    WITH busy AS (
      SELECT "tenancyId", "workflowId", COUNT(*) AS "count"
      FROM "WorkflowRun"
      WHERE "state" = 'RUNNING' AND "leaseUntil" > NOW()
      GROUP BY "tenancyId", "workflowId"
    ),
    selected AS (
      SELECT r."tenancyId", r."id", r."state" AS "preClaimState", r."wakeAt" AS "preClaimWakeAt"
      FROM "WorkflowRun" r
      LEFT JOIN busy b ON b."tenancyId" = r."tenancyId" AND b."workflowId" = r."workflowId"
      WHERE (
        (r."state" = 'QUEUED' AND (r."wakeAt" IS NULL OR r."wakeAt" <= NOW()))
        OR (r."state" = 'SLEEPING' AND r."wakeAt" <= NOW())
        OR (r."state" = 'RUNNING' AND r."leaseUntil" <= NOW())
      )
      AND COALESCE(b."count", 0) < ${PER_WORKFLOW_CONCURRENCY}
      ORDER BY r."wakeAt" ASC NULLS FIRST
      LIMIT ${RUN_CLAIM_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "WorkflowRun" r
    SET "state" = 'RUNNING', "leaseUntil" = NOW() + make_interval(secs => ${RUN_LEASE_MS / 1000}), "leaseToken" = gen_random_uuid(), "wakeAt" = NULL, "updatedAt" = NOW()
    FROM selected
    WHERE r."tenancyId" = selected."tenancyId" AND r."id" = selected."id"
    RETURNING r."tenancyId", r."id", r."workflowId", r."version", r."runKey", r."triggerEventId", r."triggerType", r."triggerPayload", r."currentStepAttempt", r."currentStepKey", r."memoTotalBytes", r."leaseToken", selected."preClaimState"::text AS "preClaimState", selected."preClaimWakeAt"
  `);
}

async function loadStepBag(tenancyId: string, runId: string): Promise<Record<string, WorkflowSandboxStepBagEntry>> {
  const rows = await globalPrismaClient.workflowStepResult.findMany({
    where: { tenancyId, runId },
  });
  return Object.fromEntries(rows.map((row) => [row.stepKey, {
    kind: row.kind === "RUN" ? "run" as const : "sleep" as const,
    stepId: row.stepId,
    result: row.result,
  }]));
}

// Returns the byte size of the sleeps in the list. NOTE: crash-replays can
// re-count a sleep whose row already exists (skipDuplicates makes the insert
// a no-op but we still return its bytes) — the drift is tiny, bounded, and
// errs toward hitting the memo cap EARLIER, so it is deliberately accepted.
async function recordCompletedSleeps(tenancyId: string, runId: string, executedAtVersion: number, sleeps: { stepKey: string, stepId: string, untilMillis: number }[]): Promise<number> {
  if (sleeps.length === 0) return 0;
  let bytes = 0;
  await globalPrismaClient.workflowStepResult.createMany({
    data: sleeps.map((sleep) => {
      const result = { until: new Date(sleep.untilMillis).toISOString() };
      bytes += Buffer.byteLength(JSON.stringify(result), "utf8");
      return {
        tenancyId,
        runId,
        stepKey: sleep.stepKey,
        stepId: sleep.stepId,
        kind: "SLEEP" as const,
        result,
        resultSizeBytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
        attempts: 1,
        executedAtVersion,
      };
    }),
    // Crash-replays may re-record the same sleep; facts never change, so
    // keeping the first insert is correct.
    skipDuplicates: true,
  });
  return bytes;
}

async function recordStepAttempt(options: {
  tenancyId: string,
  runId: string,
  stepKey: string,
  stepId: string,
  attempt: number,
  outcome: "SUCCEEDED" | "FAILED",
  error?: { name: string, message: string, stack?: string },
  failureKind?: "USER" | "PLATFORM",
  logs: string | null,
  startedAt: Date,
}): Promise<void> {
  await globalPrismaClient.workflowStepAttempt.createMany({
    data: [{
      tenancyId: options.tenancyId,
      runId: options.runId,
      stepKey: options.stepKey,
      stepId: options.stepId,
      attempt: options.attempt,
      outcome: options.outcome,
      error: options.error,
      failureKind: options.failureKind,
      logs: options.logs,
      startedAt: options.startedAt,
      finishedAt: new Date(),
    }],
    skipDuplicates: true,
  });
}

/**
 * Guarded state transition: only applies while the run is still RUNNING
 * (i.e. it wasn't canceled — cancellation is race-safe against concurrently
 * executing runs precisely because every post-invocation transition checks
 * this) AND still holds the claimant's fencing token (a stale worker whose
 * lease expired mid-invocation cannot clobber the new claimant's state).
 * Returns whether the transition applied.
 */
async function transitionRunFromRunning(tenancyId: string, runId: string, leaseToken: string, set: Prisma.Sql): Promise<boolean> {
  const rows = await globalPrismaClient.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "WorkflowRun"
    SET ${set}, "updatedAt" = NOW()
    WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${runId}::uuid AND "state" = 'RUNNING' AND "leaseToken" = ${leaseToken}::uuid
    RETURNING "id"
  `);
  return rows.length > 0;
}

async function executeClaimedRun(run: ClaimedRunRow, tenancy: Tenancy, deadlineMs: number): Promise<void> {
  const versionRowInitial = await loadWorkflowVersion(run.tenancyId, run.workflowId, run.version);
  if (versionRowInitial == null) {
    captureError("workflow-run-version-missing", new HexclaveAssertionError("Workflow run pinned to a nonexistent version", { run }));
    await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'FAILED', "completedAt" = NOW(), "leaseUntil" = NULL, "failureKind" = 'PLATFORM', "errorSummary" = ${GENERIC_PLATFORM_ERROR_SUMMARY}`);
    return;
  }

  const secretsRows = await globalPrismaClient.workflowSecret.findMany({ where: { tenancyId: run.tenancyId } });
  const secrets = Object.fromEntries(secretsRows.map((row) => [row.key, row.value]));

  // Short-lived scoped server credentials, minted per claim. The expiry must
  // cover the longest possible CHAIN of steps under this claim (the lease is
  // renewed at every step boundary, but the credential is not re-minted):
  // tick budget (~13min of chaining) + one full step timeout + slack.
  // Expired keys are pruned by the retention sweep.
  const apiKey = await createApiKeySet({
    projectId: tenancy.project.id,
    description: `workflow-run:${run.id}`,
    expires_at_millis: Date.now() + WORKFLOW_RUN_CREDENTIAL_TTL_MS,
    has_publishable_client_key: false,
    has_secret_server_key: true,
    has_super_secret_admin_key: false,
  });
  const credentials = {
    apiUrl: getWorkflowsSandboxApiUrl(),
    projectId: tenancy.project.id,
    branchId: tenancy.branchId,
    secretServerKey: apiKey.secret_server_key ?? throwErr("createApiKeySet did not return a secret server key"),
  };

  const triggerPayload = run.triggerPayload as { ts_millis: number, data: unknown };
  const event: WorkflowSandboxEvent = {
    id: run.triggerEventId ?? throwErr("WorkflowRun has no triggerEventId — runs are always created from events, so this should be impossible"),
    type: run.triggerType,
    tsMillis: triggerPayload.ts_millis,
    data: triggerPayload.data,
  };

  if (run.preClaimState === "SLEEPING") {
    // The durable timer just fired: record the suspended sleep as a fact NOW,
    // at the wake boundary. This must not happen earlier (at suspension) —
    // upgrade divergence decisions rely on probing the target version and
    // seeing it request the still-unmemoized sleep — and it must not be left
    // to the replay: a relative step.sleep would recompute its wake-up time
    // from the CURRENT clock on every replay and re-arm forever.
    const sleepStepKey = run.currentStepKey ?? throwErr("SLEEPING run without currentStepKey — the sleeping transition always records the suspended step");
    const sleepUntil = run.preClaimWakeAt ?? throwErr("SLEEPING run without wakeAt — the sleeping transition always sets the timer");
    const sleepBytes = await recordCompletedSleeps(run.tenancyId, run.id, run.version, [{
      stepKey: sleepStepKey,
      stepId: sleepStepKey.split("#")[0],
      untilMillis: sleepUntil.getTime(),
    }]);
    run.memoTotalBytes += sleepBytes;
  }

  let currentStepAttempt = run.currentStepAttempt;
  let currentVersion = run.version;
  let versionRow = versionRowInitial;

  for (let chained = 0; chained < MAX_CHAINED_STEPS_PER_CLAIM; chained++) {
    if (chained > 0) {
      // An upgrade may have landed between steps (upgrades apply at step
      // boundaries); re-read the pinned version each iteration.
      const freshRun = await globalPrismaClient.workflowRun.findUnique({
        where: { tenancyId_id: { tenancyId: run.tenancyId, id: run.id } },
        select: { version: true, state: true, memoTotalBytes: true },
      });
      if (freshRun == null || freshRun.state !== "RUNNING") return;
      run.memoTotalBytes = freshRun.memoTotalBytes;
      if (freshRun.version !== currentVersion) {
        currentVersion = freshRun.version;
        versionRow = await loadWorkflowVersion(run.tenancyId, run.workflowId, currentVersion)
          ?? throwErr("Upgraded workflow run points at a nonexistent version");
      }
    }

    const bag = await loadStepBag(run.tenancyId, run.id);
    const input: WorkflowSandboxInput = {
      protocolVersion: WORKFLOWS_PROTOCOL_VERSION,
      mode: "execute",
      limits: WORKFLOWS_DEFAULT_LIMITS,
      event,
      steps: bag,
      run: { id: run.id, workflowId: run.workflowId, version: currentVersion },
      credentials,
      secrets,
    };

    const attemptStartedAt = new Date();
    const invocationResult = await invokeWorkflowSandbox({
      compiledBundle: versionRow.compiledBundle,
      input,
      nodeModules: getStdlibNodeModules(versionRow),
      timeoutMs: INVOCATION_BACKSTOP_TIMEOUT_MS,
    });

    const lifecycleRun = { id: run.id, workflowId: run.workflowId, runKey: run.runKey, version: currentVersion, triggerType: run.triggerType };

    if (invocationResult.status === "error") {
      // Platform channel: report to our monitoring with full detail, retry
      // with the normal backoff, and never show users more than a generic
      // platform-error state.
      captureError("workflow-invocation-failed", new HexclaveAssertionError(
        `Workflow sandbox invocation failed (${invocationResult.error.kind}): ${invocationResult.error.message}`,
        { tenancyId: run.tenancyId, runId: run.id, workflowId: run.workflowId },
      ));
      const attempt = currentStepAttempt + 1;
      await recordStepAttempt({
        tenancyId: run.tenancyId, runId: run.id, stepKey: HANDLER_STEP_KEY, stepId: HANDLER_STEP_KEY, attempt,
        outcome: "FAILED", error: { name: "PlatformError", message: GENERIC_PLATFORM_ERROR_SUMMARY }, failureKind: "PLATFORM", logs: null, startedAt: attemptStartedAt,
      });
      if (attempt >= WORKFLOW_STEP_MAX_ATTEMPTS) {
        const failed = await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'FAILED', "completedAt" = NOW(), "leaseUntil" = NULL, "failureKind" = 'PLATFORM', "errorSummary" = ${GENERIC_PLATFORM_ERROR_SUMMARY}, "currentStepAttempt" = ${attempt}`);
        if (failed) await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.failed", run: lifecycleRun });
      } else {
        await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'QUEUED', "wakeAt" = NOW() + make_interval(secs => ${jitteredBackoffMs(attempt) / 1000}), "leaseUntil" = NULL, "currentStepAttempt" = ${attempt}`);
      }
      return;
    }

    const outcome: WorkflowSandboxOutcome = invocationResult.data;
    switch (outcome.type) {
      case "step-completed": {
        const sleepBytes = await recordCompletedSleeps(run.tenancyId, run.id, currentVersion, outcome.completedSleeps);
        // Re-measure server-side rather than trusting the sandbox-reported
        // size: sandboxes run user code, and limits enforced off attacker-
        // controllable numbers are not limits.
        const measuredResultSizeBytes = Buffer.byteLength(JSON.stringify(outcome.result ?? null), "utf8");
        const newMemoTotal = run.memoTotalBytes + sleepBytes + measuredResultSizeBytes;
        if (measuredResultSizeBytes > WORKFLOWS_DEFAULT_LIMITS.stepResultMaxBytes) {
          const summary = `step "${outcome.stepId}" returned ${measuredResultSizeBytes} bytes, exceeding the ${WORKFLOWS_DEFAULT_LIMITS.stepResultMaxBytes}-byte step-result limit`;
          const failed = await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'FAILED', "completedAt" = NOW(), "leaseUntil" = NULL, "failureKind" = 'USER', "errorSummary" = ${summary}, "currentStepKey" = ${outcome.stepKey}`);
          if (failed) await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.failed", run: lifecycleRun });
          return;
        }
        if (newMemoTotal > WORKFLOW_RUN_MEMO_MAX_BYTES) {
          const summary = `Total memoized state would reach ${newMemoTotal} bytes, exceeding the ${WORKFLOW_RUN_MEMO_MAX_BYTES}-byte (4 MiB) per-run limit. Store large payloads externally and keep step results small.`;
          const failed = await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'FAILED', "completedAt" = NOW(), "leaseUntil" = NULL, "failureKind" = 'USER', "errorSummary" = ${summary}, "currentStepKey" = ${outcome.stepKey}`);
          if (failed) await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.failed", run: lifecycleRun });
          return;
        }
        await globalPrismaClient.workflowStepResult.createMany({
          data: [{
            tenancyId: run.tenancyId,
            runId: run.id,
            stepKey: outcome.stepKey,
            stepId: outcome.stepId,
            kind: "RUN",
            // `result` is JSON round-tripped by the runtime, so Prisma can
            // store it directly. Nulls are fine: kind RUN results are
            // whatever the step callback returned (undefined -> null).
            result: outcome.result as any,
            resultSizeBytes: measuredResultSizeBytes,
            attempts: currentStepAttempt + 1,
            executedAtVersion: currentVersion,
            elapsedMs: outcome.elapsedMs,
          }],
          skipDuplicates: true,
        });
        await recordStepAttempt({
          tenancyId: run.tenancyId, runId: run.id, stepKey: outcome.stepKey, stepId: outcome.stepId, attempt: currentStepAttempt + 1,
          outcome: "SUCCEEDED", logs: outcome.logs, startedAt: attemptStartedAt,
        });
        const continued = await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"memoTotalBytes" = ${newMemoTotal}, "currentStepAttempt" = 0, "currentStepKey" = NULL, "leaseUntil" = NOW() + make_interval(secs => ${RUN_LEASE_MS / 1000})`);
        if (!continued) return; // canceled mid-step; the recorded fact stays
        run.memoTotalBytes = newMemoTotal;
        currentStepAttempt = 0;
        if (Date.now() >= deadlineMs) {
          // Out of tick budget: hand the run back for the next tick.
          await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'QUEUED', "wakeAt" = NOW(), "leaseUntil" = NULL`);
          return;
        }
        continue;
      }
      case "sleeping": {
        if (!Number.isFinite(outcome.untilMillis) || Math.abs(outcome.untilMillis) > 8.64e15) {
          // The runtime validates this, but the value crosses a trust
          // boundary; an unrepresentable Date would crash the transition.
          const summary = `sleep "${outcome.stepId}" has an invalid wake-up time`;
          const failed = await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'FAILED', "completedAt" = NOW(), "leaseUntil" = NULL, "failureKind" = 'USER', "errorSummary" = ${summary}, "currentStepKey" = ${outcome.stepKey}`);
          if (failed) await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.failed", run: lifecycleRun });
          return;
        }
        const sleepBytes = await recordCompletedSleeps(run.tenancyId, run.id, currentVersion, outcome.completedSleeps);
        await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'SLEEPING', "wakeAt" = ${new Date(outcome.untilMillis)}, "leaseUntil" = NULL, "currentStepAttempt" = 0, "currentStepKey" = ${outcome.stepKey}, "memoTotalBytes" = ${run.memoTotalBytes + sleepBytes}`);
        return;
      }
      case "completed": {
        const sleepBytes = await recordCompletedSleeps(run.tenancyId, run.id, currentVersion, outcome.completedSleeps);
        if (outcome.logs != null) {
          // The completing invocation replays the whole handler, so its
          // console output is the run's full final trace — including logs
          // printed between the last step and the return, which no
          // step-attempt row would otherwise capture.
          await recordStepAttempt({
            tenancyId: run.tenancyId, runId: run.id, stepKey: COMPLETION_STEP_KEY, stepId: COMPLETION_STEP_KEY, attempt: currentStepAttempt + 1,
            outcome: "SUCCEEDED", logs: outcome.logs, startedAt: attemptStartedAt,
          });
        }
        const completed = await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'COMPLETED', "completedAt" = NOW(), "leaseUntil" = NULL, "wakeAt" = NULL, "currentStepKey" = NULL, "memoTotalBytes" = ${run.memoTotalBytes + sleepBytes}`);
        if (completed) await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.completed", run: lifecycleRun });
        return;
      }
      case "step-failed":
      case "handler-failed": {
        const failSleepBytes = await recordCompletedSleeps(run.tenancyId, run.id, currentVersion, outcome.completedSleeps);
        run.memoTotalBytes += failSleepBytes;
        const stepKey = outcome.type === "step-failed" ? outcome.stepKey : HANDLER_STEP_KEY;
        const stepId = outcome.type === "step-failed" ? outcome.stepId : HANDLER_STEP_KEY;
        const maxAttempts = outcome.type === "step-failed" ? outcome.maxAttempts : WORKFLOW_STEP_MAX_ATTEMPTS;
        const attempt = currentStepAttempt + 1;
        await recordStepAttempt({
          tenancyId: run.tenancyId, runId: run.id, stepKey, stepId, attempt,
          outcome: "FAILED", error: outcome.error, failureKind: "USER", logs: outcome.logs, startedAt: attemptStartedAt,
        });
        if (outcome.nonRetriable || attempt >= maxAttempts) {
          const summary = `${outcome.error.name}: ${outcome.error.message}` + (outcome.nonRetriable ? "" : ` (${attempt}/${maxAttempts} attempts)`);
          const failed = await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'FAILED', "completedAt" = NOW(), "leaseUntil" = NULL, "failureKind" = 'USER', "errorSummary" = ${summary}, "currentStepAttempt" = ${attempt}, "currentStepKey" = ${stepKey}, "memoTotalBytes" = ${run.memoTotalBytes}`);
          if (failed) await enqueueWorkflowLifecycleEvent(globalPrismaClient, { tenancy, type: "workflow.run.failed", run: lifecycleRun });
        } else {
          await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'QUEUED', "wakeAt" = NOW() + make_interval(secs => ${jitteredBackoffMs(attempt) / 1000}), "leaseUntil" = NULL, "currentStepAttempt" = ${attempt}, "currentStepKey" = ${stepKey}, "memoTotalBytes" = ${run.memoTotalBytes}`);
        }
        return;
      }
      default: {
        captureError("workflow-unexpected-outcome", new HexclaveAssertionError(`Unexpected execute outcome type ${(outcome as any).type}`, { runId: run.id }));
        await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'QUEUED', "wakeAt" = NOW() + make_interval(secs => 60), "leaseUntil" = NULL`);
        return;
      }
    }
  }

  // Chain cap reached: hand back to the queue.
  await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'QUEUED', "wakeAt" = NOW(), "leaseUntil" = NULL`);
}

async function executeDueRuns(tenancyCache: Map<string, Tenancy | null>, deadlineMs: number): Promise<boolean> {
  const claimed = await claimDueRuns();
  if (claimed.length === 0) return false;
  await Promise.all(claimed.map(async (run) => {
    try {
      const tenancy = await getEnabledTenancy(run.tenancyId, tenancyCache);
      if (tenancy == null) {
        // Disabled/deleted project: park the run as canceled (it should
        // never have been created; the gate refuses new state).
        await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'CANCELED', "completedAt" = NOW(), "leaseUntil" = NULL`);
        return;
      }
      await executeClaimedRun(run, tenancy, deadlineMs);
    } catch (error) {
      captureError("workflow-run-execution", error);
      // Give the lease back so the run retries promptly rather than waiting
      // out the full lease expiry.
      await transitionRunFromRunning(run.tenancyId, run.id, run.leaseToken, Prisma.sql`"state" = 'QUEUED', "wakeAt" = NOW() + make_interval(secs => 30), "leaseUntil" = NULL`);
    }
  }));
  return true;
}

// ─── Cancel / upgrade / retry (used by the API routes too) ─────────────────

export async function cancelWorkflowRuns(tenancy: Tenancy, filter: { workflowId: string, runKey?: string, runId?: string, state?: "queued" | "running" | "sleeping", version?: number }): Promise<{ canceledCount: number }> {
  // Single transactional UPDATE = atomic query-cancel, race-safe against
  // concurrently waking runs (the engine's post-invocation transitions are
  // guarded on state = 'RUNNING' and will see the cancellation).
  const stateFilter = filter.state != null ? Prisma.sql`AND "state" = ${filter.state.toUpperCase()}::"WorkflowRunState"` : Prisma.empty;
  const runKeyFilter = filter.runKey != null ? Prisma.sql`AND "runKey" = ${filter.runKey}` : Prisma.empty;
  const runIdFilter = filter.runId != null ? Prisma.sql`AND "id" = ${filter.runId}::uuid` : Prisma.empty;
  const versionFilter = filter.version != null ? Prisma.sql`AND "version" = ${filter.version}` : Prisma.empty;
  const rows = await globalPrismaClient.$queryRaw<{ id: string, runKey: string | null, version: number, triggerType: string }[]>(Prisma.sql`
    UPDATE "WorkflowRun"
    SET "state" = 'CANCELED', "completedAt" = NOW(), "wakeAt" = NULL, "leaseUntil" = NULL, "updatedAt" = NOW()
    WHERE "tenancyId" = ${tenancy.id}::uuid
      AND "workflowId" = ${filter.workflowId}
      AND "state" IN ('QUEUED', 'RUNNING', 'SLEEPING')
      ${stateFilter}
      ${runKeyFilter}
      ${runIdFilter}
      ${versionFilter}
    RETURNING "id", "runKey", "version", "triggerType"
  `);
  for (const row of rows) {
    await enqueueWorkflowLifecycleEvent(globalPrismaClient, {
      tenancy,
      type: "workflow.run.canceled",
      run: { id: row.id, workflowId: filter.workflowId, runKey: row.runKey, version: row.version, triggerType: row.triggerType },
    });
  }
  return { canceledCount: rows.length };
}

const UPGRADE_MAX_RUNS_PER_CALL = 1000;

export async function upgradeWorkflowRuns(tenancy: Tenancy, options: { workflowId: string, toVersion: number, runKey?: string, fromVersion?: number }): Promise<{
  upgradedCount: number,
  skipped: { runId: string, runKey: string | null, fromVersion: number, diagnostic: WorkflowDivergenceDiagnosticJson }[],
}> {
  const targetVersion = await loadWorkflowVersion(tenancy.id, options.workflowId, options.toVersion);
  // Request-input validation, thrown as a StatusError directly so routes
  // never have to pattern-match error messages.
  if (targetVersion == null) throw new StatusError(400, `Workflow version v${options.toVersion} does not exist for workflow ${options.workflowId}`);

  const candidates = await globalPrismaClient.workflowRun.findMany({
    where: {
      tenancyId: tenancy.id,
      workflowId: options.workflowId,
      state: { in: ["QUEUED", "RUNNING", "SLEEPING"] },
      version: { not: options.toVersion, ...(options.fromVersion != null ? { equals: options.fromVersion } : {}) },
      ...(options.runKey != null ? { runKey: options.runKey } : {}),
    },
    take: UPGRADE_MAX_RUNS_PER_CALL,
  });

  let upgradedCount = 0;
  const skipped: { runId: string, runKey: string | null, fromVersion: number, diagnostic: WorkflowDivergenceDiagnosticJson }[] = [];

  for (const candidate of candidates) {
    const skip = async (diagnostic: WorkflowDivergenceDiagnosticJson) => {
      skipped.push({ runId: candidate.id, runKey: candidate.runKey, fromVersion: candidate.version, diagnostic });
      // Persist the latest diagnostic for dashboard display; there is no
      // paused state — the run keeps executing its pinned version.
      await globalPrismaClient.$executeRaw(Prisma.sql`
        UPDATE "WorkflowRun" SET "lastUpgradeDivergence" = ${JSON.stringify(diagnostic)}::jsonb, "updatedAt" = NOW()
        WHERE "tenancyId" = ${tenancy.id}::uuid AND "id" = ${candidate.id}::uuid
      `);
    };

    if (candidate.state === "RUNNING" && candidate.leaseUntil != null && candidate.leaseUntil.getTime() > Date.now()) {
      // Mid-invocation: the step bag is changing underneath us, so any probe
      // decision would be stale by the time we commit it. Safe + reversible:
      // retry the upgrade once the step completes.
      await skip({
        reason: "run-busy",
        suspended_step_key: candidate.currentStepKey,
        found_step_key: null,
        consumed_step_keys: [],
        unconsumed_step_keys: [],
        details: "The run was executing a step for the whole upgrade window. Retry the upgrade once the current step completes.",
      });
      continue;
    }

    const bag = await loadStepBag(tenancy.id, candidate.id);
    const triggerPayload = candidate.triggerPayload as { ts_millis: number, data: unknown };
    const probeResult = await invokeWorkflowSandbox({
      compiledBundle: targetVersion.compiledBundle,
      input: {
        protocolVersion: WORKFLOWS_PROTOCOL_VERSION,
        mode: "probe",
        limits: WORKFLOWS_DEFAULT_LIMITS,
        event: {
          id: candidate.triggerEventId ?? throwErr("run without triggerEventId"),
          type: candidate.triggerType,
          tsMillis: triggerPayload.ts_millis,
          data: triggerPayload.data,
        },
        steps: bag,
      },
      nodeModules: getStdlibNodeModules(targetVersion),
      timeoutMs: 60_000,
    });

    if (probeResult.status === "error") {
      await skip({
        reason: "probe-failed",
        suspended_step_key: candidate.currentStepKey,
        found_step_key: null,
        consumed_step_keys: [],
        unconsumed_step_keys: [],
        details: `The upgrade probe could not run: ${probeResult.error.message}`,
      });
      continue;
    }
    const probe = probeResult.data;
    if (probe.type !== "probe") {
      throw new HexclaveAssertionError(`Unexpected probe outcome type ${probe.type}`, { runId: candidate.id });
    }
    if (probe.threwError != null) {
      await skip({
        reason: "probe-failed",
        suspended_step_key: candidate.currentStepKey,
        found_step_key: probe.firstRequest?.stepKey ?? null,
        consumed_step_keys: probe.consumedStepKeys,
        unconsumed_step_keys: Object.keys(bag).filter((key) => !probe.consumedStepKeys.includes(key)),
        details: `The target version's code threw while replaying this run's recorded facts: ${probe.threwError.name}: ${probe.threwError.message}`,
      });
      continue;
    }

    const unconsumedStepKeys = Object.keys(bag).filter((key) => !probe.consumedStepKeys.includes(key));
    // Mechanical divergence rules (see spec section 5):
    // 1. The target code requests an unknown step while recorded facts sit
    //    unconsumed — it took a different path through the facts.
    // 2. A SLEEPING run can only transfer to code that arrives at the SAME
    //    suspended sleep; anything else would require judgment about the
    //    pending timer that we refuse to make.
    // Completion (with all facts consumed) is always clean: no fact is
    // contradicted, the run simply ends on the target version.
    let diagnostic: WorkflowDivergenceDiagnosticJson | null = null;
    if (probe.firstRequest != null && unconsumedStepKeys.length > 0) {
      diagnostic = {
        reason: "unknown-step-with-unconsumed-facts",
        suspended_step_key: candidate.currentStepKey,
        found_step_key: probe.firstRequest.stepKey,
        consumed_step_keys: probe.consumedStepKeys,
        unconsumed_step_keys: unconsumedStepKeys,
        details: `v${options.toVersion} requests unknown step "${probe.firstRequest.stepKey}" while ${unconsumedStepKeys.length} recorded step(s) were never consumed`,
      };
    } else if (candidate.state === "SLEEPING") {
      const suspendedStepKey = candidate.currentStepKey;
      const arrivesAtSameSleep = probe.firstRequest != null && probe.firstRequest.kind === "sleep" && probe.firstRequest.stepKey === suspendedStepKey;
      if (!arrivesAtSameSleep) {
        diagnostic = {
          reason: "suspended-step-not-reached",
          suspended_step_key: suspendedStepKey,
          found_step_key: probe.firstRequest?.stepKey ?? null,
          consumed_step_keys: probe.consumedStepKeys,
          unconsumed_step_keys: unconsumedStepKeys,
          details: `The run is sleeping on "${suspendedStepKey}", but v${options.toVersion} ${probe.completed ? "completes" : `requests "${probe.firstRequest?.stepKey}"`} instead of reaching that sleep`,
        };
      }
    } else if (probe.completed && unconsumedStepKeys.length > 0) {
      diagnostic = {
        reason: "unknown-step-with-unconsumed-facts",
        suspended_step_key: candidate.currentStepKey,
        found_step_key: null,
        consumed_step_keys: probe.consumedStepKeys,
        unconsumed_step_keys: unconsumedStepKeys,
        details: `v${options.toVersion} completes the run while ${unconsumedStepKeys.length} recorded step(s) were never consumed — the code no longer takes the path these facts belong to`,
      };
    }

    if (diagnostic != null) {
      await skip(diagnostic);
      continue;
    }

    // Optimistic commit: the run must not have changed since we loaded it
    // (same version + same updatedAt). If it moved, report run-busy — the
    // caller can just retry.
    const committed = await globalPrismaClient.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "WorkflowRun"
      SET "version" = ${options.toVersion}, "lastUpgradeDivergence" = NULL, "updatedAt" = NOW()
      WHERE "tenancyId" = ${tenancy.id}::uuid AND "id" = ${candidate.id}::uuid
        AND "version" = ${candidate.version} AND "updatedAt" = ${candidate.updatedAt}
        AND "state" IN ('QUEUED', 'RUNNING', 'SLEEPING')
      RETURNING "id"
    `);
    if (committed.length === 0) {
      await skip({
        reason: "run-busy",
        suspended_step_key: candidate.currentStepKey,
        found_step_key: null,
        consumed_step_keys: probe.consumedStepKeys,
        unconsumed_step_keys: unconsumedStepKeys,
        details: "The run changed state while the upgrade was being decided. Retry the upgrade.",
      });
      continue;
    }
    upgradedCount++;
  }

  return { upgradedCount, skipped };
}

export async function retryFailedWorkflowRun(tenancy: Tenancy, runId: string): Promise<boolean> {
  // Manual re-run from the failed step with a fresh attempt budget. The
  // memoized bag is intact, so the replay resumes exactly where it failed;
  // the run stays pinned to its version.
  // The NOT EXISTS guard prevents reviving a keyed run whose key has since
  // been taken by a NEWER active run — flipping to QUEUED would set the
  // generated isActive column and violate the active-run uniqueness index
  // with an unhandled 500 instead of a clean error.
  const rows = await globalPrismaClient.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "WorkflowRun" r
    SET "state" = 'QUEUED', "wakeAt" = NOW(), "currentStepAttempt" = 0, "failureKind" = NULL, "errorSummary" = NULL, "completedAt" = NULL, "updatedAt" = NOW()
    WHERE r."tenancyId" = ${tenancy.id}::uuid AND r."id" = ${runId}::uuid AND r."state" = 'FAILED'
      AND NOT EXISTS (
        SELECT 1 FROM "WorkflowRun" other
        WHERE other."tenancyId" = r."tenancyId" AND other."workflowId" = r."workflowId"
          AND other."runKey" = r."runKey" AND other."isActive" = TRUE
      )
    RETURNING "id"
  `);
  return rows.length > 0;
}

// ─── Retention ─────────────────────────────────────────────────────────────

const RUN_RETENTION_DAYS = 90;

async function pruneWorkflowRetention(): Promise<void> {
  // Terminal runs: 90 days of history (step results/attempts cascade).
  await globalPrismaClient.$executeRaw(Prisma.sql`
    DELETE FROM "WorkflowRun"
    WHERE ("tenancyId", "id") IN (
      SELECT "tenancyId", "id" FROM "WorkflowRun"
      WHERE "state" IN ('COMPLETED', 'FAILED', 'CANCELED') AND "completedAt" < NOW() - make_interval(days => ${RUN_RETENTION_DAYS})
      LIMIT 500
    )
  `);
  await globalPrismaClient.$executeRaw(Prisma.sql`
    DELETE FROM "WorkflowEvent"
    WHERE ("tenancyId", "id") IN (
      SELECT "tenancyId", "id" FROM "WorkflowEvent"
      WHERE "processedAt" IS NOT NULL AND "createdAt" < NOW() - make_interval(days => 30)
      LIMIT 1000
    )
  `);
  await globalPrismaClient.$executeRaw(Prisma.sql`
    DELETE FROM "IdempotencyKeyRecord"
    WHERE ("tenancyId", "key") IN (
      SELECT "tenancyId", "key" FROM "IdempotencyKeyRecord"
      WHERE "createdAt" < NOW() - make_interval(days => 30)
      LIMIT 1000
    )
  `);
  // Per-run sandbox credentials expire with their lease; sweep the rows so
  // they don't pile up in the api-keys table forever.
  await globalPrismaClient.$executeRaw(Prisma.sql`
    DELETE FROM "ApiKeySet"
    WHERE "id" IN (
      SELECT "id" FROM "ApiKeySet"
      WHERE "description" LIKE 'workflow-run:%' AND "expiresAt" < NOW() - make_interval(hours => 1)
      LIMIT 500
    )
  `);
}

// ─── The tick ──────────────────────────────────────────────────────────────

let stepCounter = 0;

/**
 * One engine step. Returns whether any work was done, so the caller can
 * idle-wait longer between steps when the system is quiet.
 */
export async function runWorkflowEngineStep(options: { deadlineMs: number }): Promise<{ didWork: boolean }> {
  const tenancyCache = new Map<string, Tenancy | null>();
  let didWork = false;
  didWork = await materializeScheduleOccurrences(tenancyCache) || didWork;
  didWork = await processWorkflowEvents(tenancyCache) || didWork;
  didWork = await executeDueRuns(tenancyCache, options.deadlineMs) || didWork;
  // Retention pruning is cheap but pointless to run every second.
  if (stepCounter++ % 60 === 0) {
    await pruneWorkflowRetention();
  }
  return { didWork };
}
