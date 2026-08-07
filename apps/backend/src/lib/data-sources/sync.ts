/**
 * The sync runner: a resumable state machine, not a long-running job.
 *
 * There is no hosted worker. Production schedules everything through Vercel
 * crons that call internal endpoints once a minute, so a sync must persist its
 * position, do a BOUNDED slice of work per tick, and return well inside the
 * serverless timeout. That constraint shapes everything here:
 *
 *   - a run's remaining work lives in `DataSourceSyncRun.state` as plain JSON,
 *     so any tick on any instance can pick it up;
 *   - a tick claims a run with a short lease (`claimedUntil`) taken under
 *     FOR UPDATE SKIP LOCKED, so two overlapping cron invocations cannot
 *     double-import the same slice;
 *   - budgets are records/requests/deadline, whichever binds first, and the
 *     runtime hands back the exact paginator position it stopped at.
 *
 * Modelled on the same shape as the email queue and the workflow engine, which
 * already run under these crons.
 */
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { Prisma } from "@/generated/prisma/client";
import { captureError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import type { Json } from "@hexclave/shared/dist/utils/json";
import { markImportedRowsDeleted, writeImportedRows } from "./clickhouse";
import { decryptCredentials } from "./credentials";
import { getRunnableConnector } from "./catalogue";
import type { RuntimeSyncMode } from "./catalogue/capabilities";
import { detectSchemaDrift, summarizeRecordSchema } from "./discover";
import { assertBudgetAllows, getImportedRowsBudget } from "./quota";
import { ConnectorRequestError, pullSlice, type StreamSliceState } from "./runtime";

/**
 * Per-tick budgets. Deliberately conservative: a tick that returns in seconds
 * and gets picked up again a minute later is strictly better than one that
 * risks being killed mid-slice, because a killed tick loses the records it read
 * but has not yet written.
 */
const MAX_RECORDS_PER_TICK = 5_000;
const MAX_REQUESTS_PER_TICK = 25;
const TICK_DEADLINE_MS = 45_000;
/** How long a claim is held before another tick may steal a stalled run. */
const RUN_LEASE_MS = 5 * 60 * 1000;
const RUN_CLAIM_BATCH_SIZE = 5;
/** A run that has consumed this many ticks is stuck and is failed, not retried forever. */
const MAX_TICKS_PER_RUN = 240;

/**
 * The run's resumable position.
 *
 * `pending` shrinks as streams finish, so a run is done exactly when it is
 * empty. Keeping the list in state rather than re-deriving it from the stream
 * table means a stream enabled mid-run joins the NEXT run rather than being
 * half-imported into this one.
 */
export type SyncRunState = {
  pending?: string[],
  current?: { stream: string, slice: StreamSliceState } | null,
  /** Streams whose rows must be tombstoned before their first slice lands. */
  pendingFullRefreshReset?: string[],
  perStreamRows?: Record<string, number>,
};

type ClaimedRunRow = {
  tenancyId: string,
  id: string,
  dataSourceId: string,
  // Read back straight from SQL, where a JSONB column can legitimately be null.
  state: SyncRunState | null,
  ticks: number,
};

export function getScheduleIntervalMinutes(scheduleKind: string, scheduleValue: string | null): number | null {
  if (scheduleKind !== "interval") return null;
  const minutes = Number(scheduleValue);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

/**
 * Next run time for a source. Cron expressions are resolved to the next minute
 * boundary matching the expression; interval schedules just add their period.
 */
export function computeNextSyncAt(
  scheduleKind: string,
  scheduleValue: string | null,
  from: Date,
): Date | null {
  if (scheduleKind === "interval") {
    const minutes = getScheduleIntervalMinutes(scheduleKind, scheduleValue);
    return minutes == null ? null : new Date(from.getTime() + minutes * 60_000);
  }
  if (scheduleKind === "cron" && scheduleValue != null) {
    return getNextCronOccurrence(scheduleValue, from);
  }
  return null;
}

/**
 * Minimal 5-field cron evaluation, by forward scan.
 *
 * A scan is used rather than arithmetic because it is obviously correct for
 * the awkward cases (day-of-month and day-of-week both restricted, month
 * lengths, DST) and the search space is bounded: a valid expression matches
 * within roughly a year, and an expression that does not is rejected rather
 * than silently never firing.
 */
export function getNextCronOccurrence(expression: string, from: Date): Date | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const matchers = fields.map(parseCronField);
  if (matchers.some(matcher => matcher == null)) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = matchers as Array<Set<number>>;

  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  // One year of minutes is the bound: every valid 5-field expression recurs at
  // least annually.
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dayMatches = dayOfMonth.has(candidate.getUTCDate()) && dayOfWeek.has(candidate.getUTCDay());
    if (
      minute.has(candidate.getUTCMinutes())
      && hour.has(candidate.getUTCHours())
      && month.has(candidate.getUTCMonth() + 1)
      && dayMatches
    ) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}

const CRON_FIELD_RANGES: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

function parseCronField(field: string, index?: number): Set<number> | null {
  const [min, max] = CRON_FIELD_RANGES[index ?? 0];
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const segments = part.split("/");
    const rangePart = segments[0];
    const stepPart = segments.at(1);
    const step = stepPart == null ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) return null;
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      const bounds = rangePart.split("-");
      start = Number(bounds[0]);
      end = bounds.length > 1 ? Number(bounds[1]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
      if (start < min || end > max || start > end) return null;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size > 0 ? values : null;
}

/** Creates a run, or returns the one already in flight for this source. */
export async function enqueueSyncRun(options: {
  tenancy: Tenancy,
  dataSourceId: string,
  trigger: "manual" | "schedule",
}): Promise<{ runId: string, alreadyRunning: boolean }> {
  return await retryTransaction(globalPrismaClient, async (tx) => {
    const source = await tx.dataSource.findUnique({
      where: { tenancyId_id: { tenancyId: options.tenancy.id, id: options.dataSourceId } },
      include: { streams: true },
    });
    if (source == null) {
      throw new StatusError(StatusError.NotFound, "Data source not found.");
    }

    const inFlight = await tx.dataSourceSyncRun.findFirst({
      where: { tenancyId: options.tenancy.id, dataSourceId: options.dataSourceId, status: "RUNNING" },
    });
    if (inFlight != null) {
      return { runId: inFlight.id, alreadyRunning: true };
    }

    const enabled = source.streams.filter(stream => stream.enabled);
    if (enabled.length === 0) {
      throw new StatusError(StatusError.BadRequest, "Enable at least one stream before syncing.");
    }

    // A full-refresh stream must forget what it imported last time, or removed
    // records would linger forever. The reset is deferred to the moment the
    // first slice of that stream lands, so a run that never starts cannot
    // destroy data that is still the best copy available.
    const fullRefreshStreams = enabled
      .filter(stream => stream.syncMode !== "incremental")
      .map(stream => stream.streamName);

    const state: SyncRunState = {
      pending: enabled.map(stream => stream.streamName),
      current: null,
      pendingFullRefreshReset: fullRefreshStreams,
      perStreamRows: {},
    };

    const run = await tx.dataSourceSyncRun.create({
      data: {
        tenancyId: options.tenancy.id,
        dataSourceId: options.dataSourceId,
        trigger: options.trigger,
        status: "RUNNING",
        state: state as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.dataSource.update({
      where: { tenancyId_id: { tenancyId: options.tenancy.id, id: options.dataSourceId } },
      data: { status: "SYNCING", lastError: null },
    });
    return { runId: run.id, alreadyRunning: false };
  });
}

/** Creates runs for every source whose schedule has come due. */
async function enqueueDueScheduledSyncs(): Promise<number> {
  const due = await globalPrismaClient.dataSource.findMany({
    where: {
      nextSyncAt: { lte: new Date() },
      status: { not: "PAUSED" },
      scheduleKind: { in: ["interval", "cron"] },
    },
    take: RUN_CLAIM_BATCH_SIZE,
  });

  let enqueued = 0;
  for (const source of due) {
    // Advance the schedule FIRST. If enqueueing then fails, the source waits
    // for its next slot instead of being retried every single tick.
    const next = computeNextSyncAt(source.scheduleKind, source.scheduleValue, new Date());
    await globalPrismaClient.dataSource.update({
      where: { tenancyId_id: { tenancyId: source.tenancyId, id: source.id } },
      data: { nextSyncAt: next },
    });

    const tenancy = await getTenancy(source.tenancyId);
    if (tenancy == null) continue;
    const result = await Result.fromPromise(enqueueSyncRun({
      tenancy,
      dataSourceId: source.id,
      trigger: "schedule",
    }));
    if (result.status === "ok" && !result.data.alreadyRunning) enqueued += 1;
  }
  return enqueued;
}

async function claimRuns(): Promise<ClaimedRunRow[]> {
  return await globalPrismaClient.$queryRaw<ClaimedRunRow[]>(Prisma.sql`
    WITH selected AS (
      SELECT r."tenancyId", r."id"
      FROM "DataSourceSyncRun" r
      WHERE r."status" = 'RUNNING'
        AND (r."claimedUntil" IS NULL OR r."claimedUntil" <= NOW())
      ORDER BY r."createdAt" ASC
      LIMIT ${RUN_CLAIM_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "DataSourceSyncRun" r
    SET "claimedUntil" = NOW() + make_interval(secs => ${RUN_LEASE_MS / 1000}),
        "ticks" = r."ticks" + 1,
        "updatedAt" = NOW()
    FROM selected
    WHERE r."tenancyId" = selected."tenancyId" AND r."id" = selected."id"
    RETURNING r."tenancyId", r."id", r."dataSourceId", r."state", r."ticks"
  `);
}

async function finishRun(options: {
  tenancyId: string,
  runId: string,
  dataSourceId: string,
  status: "SUCCEEDED" | "FAILED",
  error?: string,
}): Promise<void> {
  await globalPrismaClient.dataSourceSyncRun.update({
    where: { tenancyId_id: { tenancyId: options.tenancyId, id: options.runId } },
    data: {
      status: options.status,
      finishedAt: new Date(),
      claimedUntil: null,
      error: options.error ?? null,
    },
  });
  await globalPrismaClient.dataSource.update({
    where: { tenancyId_id: { tenancyId: options.tenancyId, id: options.dataSourceId } },
    data: {
      status: options.status === "SUCCEEDED" ? "HEALTHY" : "FAILED",
      lastError: options.error ?? null,
      ...options.status === "SUCCEEDED" ? { lastSyncedAt: new Date() } : {},
    },
  });
}

/**
 * Advances one claimed run by a single slice.
 *
 * Ordering inside a slice matters: rows are written to ClickHouse BEFORE the
 * cursor is persisted, so a crash between the two re-imports a slice rather
 * than skipping it. Imports are keyed on (source, stream, pk) into a
 * ReplacingMergeTree, so a repeat is a no-op — at-least-once delivery lands as
 * exactly-once storage.
 */
async function advanceRun(claimed: ClaimedRunRow): Promise<void> {
  const tenancy = await getTenancy(claimed.tenancyId);
  if (tenancy == null) {
    await finishRun({
      tenancyId: claimed.tenancyId, runId: claimed.id, dataSourceId: claimed.dataSourceId,
      status: "FAILED", error: "Tenancy no longer exists.",
    });
    return;
  }

  if (claimed.ticks > MAX_TICKS_PER_RUN) {
    await finishRun({
      tenancyId: claimed.tenancyId, runId: claimed.id, dataSourceId: claimed.dataSourceId,
      status: "FAILED",
      error: `Sync exceeded ${MAX_TICKS_PER_RUN} ticks without finishing and was stopped.`,
    });
    return;
  }

  const source = await globalPrismaClient.dataSource.findUnique({
    where: { tenancyId_id: { tenancyId: claimed.tenancyId, id: claimed.dataSourceId } },
    include: { streams: true },
  });
  if (source == null) {
    await finishRun({
      tenancyId: claimed.tenancyId, runId: claimed.id, dataSourceId: claimed.dataSourceId,
      status: "FAILED", error: "Data source was deleted.",
    });
    return;
  }

  const manifest = getRunnableConnector(source.connectorId);
  if (manifest == null) {
    await finishRun({
      tenancyId: claimed.tenancyId, runId: claimed.id, dataSourceId: claimed.dataSourceId,
      status: "FAILED",
      error: `Connector "${source.connectorId}" is no longer available in this Hexclave version.`,
    });
    return;
  }

  const state: SyncRunState = claimed.state ?? {};
  const pending = state.pending ?? [];
  const currentStreamName = state.current?.stream ?? pending.at(0);

  if (currentStreamName == null) {
    await finishRun({
      tenancyId: claimed.tenancyId, runId: claimed.id, dataSourceId: claimed.dataSourceId,
      status: "SUCCEEDED",
    });
    return;
  }

  const streamRow = source.streams.find(row => row.streamName === currentStreamName);
  const streamManifest = manifest.streams.find(entry => entry.name === currentStreamName);
  if (streamRow == null || !streamRow.enabled || streamManifest == null) {
    // The stream was disabled or withdrawn mid-run: drop it and carry on rather
    // than failing an otherwise healthy sync.
    await persistState(claimed, {
      ...state,
      pending: pending.filter(name => name !== currentStreamName),
      current: null,
    });
    return;
  }

  const secrets = await decryptCredentials(source.encryptedCredentials);
  const config = (source.config ?? {}) as Record<string, string>;
  const syncMode: RuntimeSyncMode = streamRow.syncMode === "incremental" ? "incremental" : "full_refresh";

  const slice = state.current?.slice ?? {
    cursor: syncMode === "incremental" ? (streamRow.cursorValue ?? undefined) : undefined,
  };

  const budget = await getImportedRowsBudget(tenancy);

  const result = await pullSlice({
    manifest,
    stream: streamManifest,
    syncMode,
    cursorField: streamRow.cursorField,
    primaryKey: streamRow.primaryKeyFields.length > 0 ? streamRow.primaryKeyFields : null,
    config,
    secrets,
    state: slice,
    maxRecords: Math.min(MAX_RECORDS_PER_TICK, Math.max(1, budget.remaining)),
    maxRequests: MAX_REQUESTS_PER_TICK,
    deadlineMs: performance.now() + TICK_DEADLINE_MS,
  });

  assertBudgetAllows(budget, result.records.length);

  // Deferred full-refresh reset: tombstone the previous generation only now
  // that a replacement slice is actually in hand.
  const resetPending = state.pendingFullRefreshReset ?? [];
  if (resetPending.includes(currentStreamName)) {
    await markImportedRowsDeleted({ tenancy, sourceId: source.id, stream: currentStreamName });
  }

  await writeImportedRows({
    tenancy,
    sourceId: source.id,
    stream: currentStreamName,
    records: result.records,
  });

  const rowsSoFar = (state.perStreamRows?.[currentStreamName] ?? 0) + result.records.length;

  // Schema drift: compare what just arrived against what discovery recorded.
  if (result.records.length > 0) {
    const observed = summarizeRecordSchema(result.records.map(record => record.data));
    const drift = detectSchemaDrift(streamRow.discoveredSchema as Json | null, observed);
    if (drift != null) {
      await globalPrismaClient.dataSourceStream.update({
        where: { tenancyId_id: { tenancyId: claimed.tenancyId, id: streamRow.id } },
        data: { pendingDrift: drift as unknown as Prisma.InputJsonValue },
      });
    }
  }

  await globalPrismaClient.dataSourceStream.update({
    where: { tenancyId_id: { tenancyId: claimed.tenancyId, id: streamRow.id } },
    data: {
      lastRowCount: BigInt(rowsSoFar),
      // The cursor only moves when the stream drained; `pullSlice` enforces the
      // same rule on the value it hands back.
      ...result.done && result.state.cursor != null ? { cursorValue: result.state.cursor } : {},
    },
  });

  await globalPrismaClient.dataSourceSyncRun.update({
    where: { tenancyId_id: { tenancyId: claimed.tenancyId, id: claimed.id } },
    data: { rowsSynced: { increment: result.records.length } },
  });

  const nextState: SyncRunState = result.done
    ? {
      ...state,
      pending: pending.filter(name => name !== currentStreamName),
      current: null,
      pendingFullRefreshReset: resetPending.filter(name => name !== currentStreamName),
      perStreamRows: { ...state.perStreamRows, [currentStreamName]: rowsSoFar },
    }
    : {
      ...state,
      pending,
      current: { stream: currentStreamName, slice: result.state },
      pendingFullRefreshReset: resetPending.filter(name => name !== currentStreamName),
      perStreamRows: { ...state.perStreamRows, [currentStreamName]: rowsSoFar },
    };

  if ((nextState.pending ?? []).length === 0 && nextState.current == null) {
    await persistState(claimed, nextState);
    await finishRun({
      tenancyId: claimed.tenancyId, runId: claimed.id, dataSourceId: claimed.dataSourceId,
      status: "SUCCEEDED",
    });
    return;
  }

  await persistState(claimed, nextState);
}

async function persistState(claimed: ClaimedRunRow, state: SyncRunState): Promise<void> {
  await globalPrismaClient.dataSourceSyncRun.update({
    where: { tenancyId_id: { tenancyId: claimed.tenancyId, id: claimed.id } },
    data: {
      state: state as unknown as Prisma.InputJsonValue,
      // Release the lease so the next tick can pick the run straight up rather
      // than waiting out the full lease window.
      claimedUntil: null,
    },
  });
}

/**
 * One cron tick: promote due schedules, then advance whatever runs it can claim.
 *
 * Returns whether it did anything, so the calling route can decide to loop
 * again within its own budget instead of idling until the next minute.
 */
export async function runDataSourcesSyncStep(): Promise<{ didWork: boolean }> {
  const enqueued = await enqueueDueScheduledSyncs();
  const claimed = await claimRuns();

  for (const run of claimed) {
    const result = await Result.fromPromise(advanceRun(run));
    if (result.status === "error") {
      const error = result.error;
      // A revoked or rotated key must surface loudly: silent stale data is the
      // failure mode that erodes trust in an importer.
      const message = error instanceof ConnectorRequestError
        ? `${error.isAuthFailure ? "Authentication failed" : `Provider returned HTTP ${error.status}`}: ${error.providerMessage}`
        : error instanceof StatusError
          ? error.message
          : "Sync failed unexpectedly.";
      if (!(error instanceof ConnectorRequestError) && !(error instanceof StatusError)) {
        captureError("data-sources-sync-step", error);
      }
      await Result.fromPromise(finishRun({
        tenancyId: run.tenancyId, runId: run.id, dataSourceId: run.dataSourceId,
        status: "FAILED", error: message,
      }));
    }
  }

  return { didWork: enqueued > 0 || claimed.length > 0 };
}

import.meta.vitest?.describe("sync scheduling", () => {
  import.meta.vitest?.test("interval schedules advance by their period", ({ expect }) => {
    const from = new Date("2026-08-06T12:00:00Z");
    expect(computeNextSyncAt("interval", "60", from)?.toISOString()).toBe("2026-08-06T13:00:00.000Z");
    expect(computeNextSyncAt("manual", null, from)).toBeNull();
    expect(computeNextSyncAt("interval", "0", from)).toBeNull();
  });

  import.meta.vitest?.test("cron expressions resolve to the next matching minute", ({ expect }) => {
    const from = new Date("2026-08-06T12:30:00Z");
    expect(getNextCronOccurrence("0 * * * *", from)?.toISOString()).toBe("2026-08-06T13:00:00.000Z");
    expect(getNextCronOccurrence("*/15 * * * *", from)?.toISOString()).toBe("2026-08-06T12:45:00.000Z");
    expect(getNextCronOccurrence("0 0 1 * *", from)?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  import.meta.vitest?.test("malformed cron expressions are rejected, not silently never fired", ({ expect }) => {
    const from = new Date("2026-08-06T12:00:00Z");
    expect(getNextCronOccurrence("not a cron", from)).toBeNull();
    expect(getNextCronOccurrence("0 0 1 *", from)).toBeNull();
    expect(getNextCronOccurrence("99 * * * *", from)).toBeNull();
  });
});
