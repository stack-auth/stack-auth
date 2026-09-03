import { createClickhouseWarehouseClient } from "@/lib/clickhouse";
import { getDestinationTableName } from "@/lib/data-sources/clickhouse-destination";
import { tableKey } from "@/lib/data-sources/destination";
import { MODE_FROM_PRISMA, MODE_TO_PRISMA, TYPE_FROM_PRISMA, TYPE_TO_PRISMA } from "@/lib/data-sources/enums";
import { getDriver } from "@/lib/data-sources/drivers";
import type {
  DataSourceConnection,
  DataSourceProbeResult,
  ProbedTable,
  StreamSyncPlan,
  SyncCursorState,
} from "@/lib/data-sources/types";
import { ensureDataWarehouseEntitlement, getDataWarehouse, getDataWarehouseNames, getDataWarehouseQueryAuth } from "@/lib/data-warehouse";
import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient, retryTransaction } from "@/prisma-client";
import { Prisma, type DataSource, type DataSourceStream } from "@/generated/prisma/client";
import {
  getDefaultCursorColumn,
  getModeAvailability,
  type DataSourceSyncMode,
  type DataSourceType,
} from "@hexclave/shared/dist/data-sources/modes";
import { decryptWithKms, encryptWithKms } from "@hexclave/shared/dist/helpers/vault/server-side";
import { yupObject, yupString, yupValidate } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

const encryptedSecretSchema = yupObject({
  edkBase64: yupString().defined(),
  ciphertextBase64: yupString().defined(),
}).defined();

/** How long a claimed sync may run before the scheduler assumes it died. */
const SYNC_CLAIM_LEASE_SECONDS = 900;

/**
 * How long a driver is actually allowed to run, as a fraction of the lease.
 *
 * The margin is what stops a run from finishing after its lease expired, when a
 * second worker may already have claimed the source. The lease fences the
 * metadata transaction, but both workers write to the customer's warehouse, and
 * those writes cannot be rolled back.
 */
const SYNC_DEADLINE_FRACTION = 0.8;

export type DataSourceWithStreams = DataSource & { streams: DataSourceStream[] };

/**
 * The connection a driver works from: the stored config plus the one decrypted
 * secret. Assembled here so no driver has to know how secrets are sealed, and so
 * a secret is only ever in memory for the length of one operation.
 */
export async function getConnection(source: DataSource): Promise<DataSourceConnection> {
  const envelope = await yupValidate(encryptedSecretSchema, source.encryptedSecret);
  return {
    type: TYPE_FROM_PRISMA[source.type],
    config: (source.config ?? {}) as Record<string, unknown>,
    secret: await decryptWithKms(envelope),
  };
}

/**
 * Sources write into the project's own warehouse database, so there has to be
 * one. Failing here rather than at sync time keeps the customer from configuring
 * streams that could never have run.
 */
async function getWarehouseDatabaseName(tenancy: Tenancy): Promise<string> {
  const warehouse = await getDataWarehouse(tenancy);
  if (warehouse == null || warehouse.status !== "READY") {
    throw new StatusError(
      StatusError.BadRequest,
      "This project does not have a data warehouse yet. Provision one before connecting a source.",
    );
  }
  return warehouse.databaseName || getDataWarehouseNames(tenancy.project.id).databaseName;
}

export async function listDataSources(tenancy: Tenancy): Promise<DataSourceWithStreams[]> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  return await prisma.dataSource.findMany({
    where: { tenancyId: tenancy.id },
    include: { streams: { orderBy: [{ schemaName: "asc" }, { tableName: "asc" }] } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getDataSourceOrThrow(tenancy: Tenancy, dataSourceId: string): Promise<DataSourceWithStreams> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const source = await prisma.dataSource.findFirst({
    where: { id: dataSourceId, tenancyId: tenancy.id },
    include: { streams: { orderBy: [{ schemaName: "asc" }, { tableName: "asc" }] } },
  });
  if (source == null) throw new StatusError(StatusError.NotFound, "No such data source.");
  return source;
}

export type CreateDataSourceInput = {
  type: DataSourceType,
  config: Record<string, unknown>,
  secret: string,
};

/**
 * Probes first, and only stores the source if the probe succeeded. A source row
 * that has never once connected is worse than no row: it shows up in the list
 * looking configured.
 */
export async function createDataSource(
  tenancy: Tenancy,
  input: CreateDataSourceInput,
): Promise<{ source: DataSourceWithStreams, probe: DataSourceProbeResult }> {
  await ensureDataWarehouseEntitlement(tenancy);
  await getWarehouseDatabaseName(tenancy);

  const connection: DataSourceConnection = { type: input.type, config: input.config, secret: input.secret };
  const probe = await getDriver(input.type).probe(connection, { verifyAccess: true });
  const encryptedSecret = await encryptWithKms(input.secret);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const source = await prisma.dataSource.create({
    data: {
      tenancyId: tenancy.id,
      type: TYPE_TO_PRISMA[input.type],
      config: input.config as Prisma.InputJsonValue,
      encryptedSecret,
      capabilities: probe.capabilities as unknown as Prisma.InputJsonValue,
      status: "PENDING",
    },
    include: { streams: true },
  });
  return { source, probe };
}

/**
 * Releases whatever the driver created on the customer's system. Kept in one
 * idempotent path so that configuration changes and source deletion cannot
 * disagree about which objects Hexclave owns.
 */
async function teardownDriverResources(source: DataSource): Promise<void> {
  const driver = getDriver(TYPE_FROM_PRISMA[source.type]);
  if (driver.teardown == null) return;
  await driver.teardown({ connection: await getConnection(source), dataSourceId: source.id });
}

/**
 * Deliberately not gated on the data-warehouse entitlement, unlike every other
 * outbound path. A project that lost the entitlement must still be able to
 * disconnect: refusing would strand a WAL-retaining replication slot on the
 * customer's own server with no way to remove it.
 */
export async function deleteDataSource(tenancy: Tenancy, dataSourceId: string): Promise<void> {
  const source = await getDataSourceOrThrow(tenancy, dataSourceId);
  const prisma = await getPrismaClientForTenancy(tenancy);

  // Attempted before forgetting the source exists: a Postgres replication slot
  // nobody reads retains write-ahead log on the customer's server until their
  // disk fills. Attempted unconditionally rather than only when we recorded one,
  // because a sync that created a slot and then timed out leaves no record.
  try {
    await teardownDriverResources(source);
  } catch (error) {
    // The source may be unreachable, which must not make it undeletable. Anything
    // left behind is then the customer's to drop, and this records why.
    captureError("data-source-teardown", error);
  }

  // Destination tables are deliberately left in place: they are the customer's
  // data, in the customer's warehouse, and dropping them on a disconnect would
  // be a surprising amount of destruction for one click.
  await prisma.dataSource.delete({ where: { id: source.id } });
}

/** Re-reads capabilities and catalog, and persists the capability snapshot. */
export async function refreshDataSourceProbe(tenancy: Tenancy, dataSourceId: string): Promise<DataSourceProbeResult> {
  // Gated like the other outbound paths: this opens a connection to the
  // customer's system, so a project that has lost the entitlement must not keep
  // being able to trigger it.
  await ensureDataWarehouseEntitlement(tenancy);
  const source = await getDataSourceOrThrow(tenancy, dataSourceId);
  const probe = await getDriver(TYPE_FROM_PRISMA[source.type]).probe(await getConnection(source));
  const prisma = await getPrismaClientForTenancy(tenancy);
  await prisma.dataSource.update({
    where: { id: source.id },
    data: { capabilities: probe.capabilities as unknown as Prisma.InputJsonValue },
  });
  return probe;
}

export type StreamConfigInput = {
  schemaName: string,
  tableName: string,
  mode: DataSourceSyncMode,
  cursorColumn: string | null,
};

/**
 * Replaces the stream configuration wholesale. Modes are re-validated against a
 * fresh probe rather than trusted from the client: the dashboard's view of what
 * is available can be minutes old, and CDC on a table that lost its primary key
 * would silently produce an append-only mess.
 */
export async function setDataSourceStreams(
  tenancy: Tenancy,
  dataSourceId: string,
  configs: StreamConfigInput[],
): Promise<DataSourceWithStreams> {
  await ensureDataWarehouseEntitlement(tenancy);
  const source = await getDataSourceOrThrow(tenancy, dataSourceId);
  const driver = getDriver(TYPE_FROM_PRISMA[source.type]);
  const probe = await driver.probe(await getConnection(source));
  const prisma = await getPrismaClientForTenancy(tenancy);

  const tablesByName = new Map(probe.tables.map(t => [tableKey(t.schemaName, t.tableName), t]));
  const existingByName = new Map(source.streams.map(s => [`${s.schemaName}.${s.tableName}`, s]));
  const previousModes = source.streams.map(stream => MODE_FROM_PRISMA[stream.mode]);
  const nextModes = configs.map(config => config.mode);
  const shouldTeardown = driver.shouldTeardownOnReconfigure?.({ previousModes, nextModes }) ?? false;

  for (const config of configs) {
    const key = `${config.schemaName}.${config.tableName}`;
    const table = tablesByName.get(key);
    if (table == null) {
      throw new StatusError(StatusError.BadRequest, `The source has no readable table ${key}.`);
    }
    const availability = getModeAvailability(table, probe.capabilities)[config.mode];
    if (!availability.available) {
      throw new StatusError(StatusError.BadRequest, `${config.mode} is not available for ${key}: ${availability.reason}.`);
    }
    if (config.mode === "cursor") {
      const cursorColumn = config.cursorColumn ?? getDefaultCursorColumn(table);
      if (cursorColumn == null || !table.cursorCandidates.some(c => c.column === cursorColumn)) {
        throw new StatusError(StatusError.BadRequest, `${cursorColumn ?? "No column"} cannot be used as a cursor for ${key}.`);
      }
    }
  }

  // Every stream change takes the sync lease. Otherwise a worker using the old
  // configuration can finish after this transaction and overwrite its PENDING
  // rebuild marker, old cursor, or even a newly selected mode. If the worker's
  // lease has expired, this claim also changes its fence token so its completion
  // transaction rolls back instead of publishing stale stream state.
  const configurationClaimStartedAt = new Date();
  const claimed = await prisma.$executeRaw`
    UPDATE "DataSource"
    SET "lastSyncStartedAt" = ${configurationClaimStartedAt}
    WHERE "id" = ${source.id}::uuid
      AND (
        "lastSyncStartedAt" IS NULL
        OR "lastSyncStartedAt" <= "lastSyncFinishedAt"
        OR "lastSyncStartedAt" < NOW() - make_interval(secs => ${SYNC_CLAIM_LEASE_SECONDS})
      )
  `;
  if (claimed === 0) {
    throw new StatusError(StatusError.Conflict, "Wait for the running sync to finish before changing the stream configuration.");
  }

  try {
    if (shouldTeardown) {
      // Unlike source deletion, a configuration update must fail loudly here.
      // Otherwise it can succeed while leaving an unconsumed, WAL-retaining slot.
      await teardownDriverResources(source);
    }

    const keep = new Set(configs.map(c => `${c.schemaName}.${c.tableName}`));
    await retryTransaction(prisma, async tx => {
      for (const stream of source.streams) {
        if (!keep.has(`${stream.schemaName}.${stream.tableName}`)) {
          await tx.dataSourceStream.delete({ where: { id: stream.id } });
        }
      }
      for (const config of configs) {
        const key = `${config.schemaName}.${config.tableName}`;
        const table = tablesByName.get(key)!;
        const existing = existingByName.get(key);
        const cursorColumn = config.mode === "cursor"
          ? (config.cursorColumn ?? getDefaultCursorColumn(table))
          : null;
        // Any change of mode or cursor invalidates the resume point: the new mode
        // cannot interpret the old one's cursor, and reusing it would skip rows.
        const modeChanged = existing != null && (
          MODE_FROM_PRISMA[existing.mode] !== config.mode || existing.cursorColumn !== cursorColumn
        );
        const data = {
          mode: MODE_TO_PRISMA[config.mode],
          cursorColumn,
          primaryKeyColumns: table.primaryKeyColumns,
          destinationTable: existing?.destinationTable
            ?? getDestinationTableName(source.id, config.schemaName, config.tableName),
          ...(modeChanged || existing == null
            // Prisma distinguishes "set the column to JSON null" from "SQL NULL";
            // clearing a resume point means the latter.
            ? { syncCursor: Prisma.DbNull, status: "PENDING" as const, error: null, rowsSynced: 0n }
            : {}),
        };
        if (existing == null) {
          await tx.dataSourceStream.create({
            data: { dataSourceId: source.id, schemaName: config.schemaName, tableName: config.tableName, ...data },
          });
        } else {
          await tx.dataSourceStream.update({ where: { id: existing.id }, data });
        }
      }
      await tx.dataSource.update({
        where: { id: source.id },
        data: {
          status: configs.length > 0 ? "ACTIVE" : "PENDING",
          capabilities: probe.capabilities as unknown as Prisma.InputJsonValue,
        },
      });
    });
  } finally {
    // Never restore the previous start token: a worker whose old lease expired
    // could otherwise finish later and regain permission to overwrite state.
    // Referencing the current finish column also avoids regressing this marker if
    // a sync completed while the fresh capability probe above was still running.
    await prisma.$executeRaw`
      UPDATE "DataSource"
      SET "lastSyncStartedAt" = "lastSyncFinishedAt"
      WHERE "id" = ${source.id}::uuid
        AND "lastSyncStartedAt" = ${configurationClaimStartedAt}
    `;
  }

  return await getDataSourceOrThrow(tenancy, dataSourceId);
}

async function syncClaimedDataSource(
  tenancy: Tenancy,
  source: DataSourceWithStreams,
  startedAt: Date,
): Promise<DataSourceWithStreams> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  if (source.streams.length === 0) {
    await prisma.dataSource.updateMany({
      where: { id: source.id, lastSyncStartedAt: startedAt },
      data: { lastSyncFinishedAt: new Date() },
    });
    return await getDataSourceOrThrow(tenancy, source.id);
  }

  const databaseName = await getWarehouseDatabaseName(tenancy);
  const driver = getDriver(TYPE_FROM_PRISMA[source.type]);
  const connection = await getConnection(source);

  let probe: DataSourceProbeResult;
  try {
    probe = await driver.probe(connection);
  } catch (error) {
    // A failure to connect is about the source, not any one stream.
    // Recorded, but the source stays ACTIVE: the scheduler only picks up ACTIVE
    // rows, so parking it on FAILED would make one DNS blip stop syncing forever.
    const message = error instanceof Error ? error.message : String(error);
    await prisma.dataSource.updateMany({
      where: { id: source.id, lastSyncStartedAt: startedAt },
      data: { error: message, lastSyncFinishedAt: new Date() },
    });
    return await getDataSourceOrThrow(tenancy, source.id);
  }

  const tablesByName = new Map<string, ProbedTable>(probe.tables.map(t => [tableKey(t.schemaName, t.tableName), t]));
  const plans: StreamSyncPlan[] = source.streams.map(stream => ({
    streamId: stream.id,
    schemaName: stream.schemaName,
    tableName: stream.tableName,
    mode: MODE_FROM_PRISMA[stream.mode],
    cursorColumn: stream.cursorColumn,
    primaryKeyColumns: stream.primaryKeyColumns,
    destinationTable: stream.destinationTable,
    syncCursor: stream.syncCursor as SyncCursorState | null,
    isPending: stream.status === "PENDING",
  }));

  // Connects as the project's own warehouse user rather than the ClickHouse
  // admin, so the tenancy boundary is enforced by ClickHouse privileges and the
  // per-project quota — not by the correctness of an interpolated database name.
  const warehouseAuth = await getDataWarehouseQueryAuth(tenancy);
  if (warehouseAuth == null) {
    throw new StatusError(StatusError.BadRequest, "This project's data warehouse is not ready.");
  }
  const clickhouse = createClickhouseWarehouseClient(warehouseAuth, databaseName);
  let outcome;
  try {
    outcome = await driver.runStreamSyncs({
      connection,
      clickhouse,
      databaseName,
      tablesByName,
      sourceCursor: source.syncCursor,
      startedAt,
      dataSourceId: source.id,
      deadlineMs: startedAt.getTime() + SYNC_CLAIM_LEASE_SECONDS * 1000 * SYNC_DEADLINE_FRACTION,
    }, plans);
  } finally {
    await clickhouse.close();
  }

  const results = outcome.streams;
  await retryTransaction(prisma, async tx => {
    for (const result of results) {
      // A truncated source table cannot be represented incrementally, so the
      // stream goes back to PENDING and the next sync rebuilds it from scratch.
      const resnapshot = result.needsResnapshot === true;
      // An initial load that ran out of budget stays PENDING: its destination
      // holds only part of the table, and calling that ACTIVE would tell the
      // customer a partial table is complete.
      const incomplete = result.loadIncomplete === true;
      await tx.dataSourceStream.update({
        where: { id: result.streamId },
        data: {
          status: result.error != null ? "FAILED" : resnapshot || incomplete ? "PENDING" : "ACTIVE",
          error: result.error,
          syncCursor: resnapshot ? Prisma.DbNull : result.syncCursor ?? undefined,
          rowsSynced: { increment: BigInt(result.rowsSynced) },
          lastSyncedAt: result.error == null && !incomplete ? new Date() : undefined,
        },
      });
    }
    const failed = results.filter(result => result.error != null);
    const completed = await tx.dataSource.updateMany({
      where: { id: source.id, lastSyncStartedAt: startedAt },
      data: {
        lastSyncFinishedAt: new Date(),
        status: "ACTIVE",
        // Surfaced at the source level only when nothing succeeded; a single bad
        // table is already reported on its own stream.
        error: failed.length === results.length ? failed[0]?.error ?? null : null,
        // A driver that resumes per stream returns no source cursor, and its
        // stored value is then left exactly as it was.
        ...(outcome.sourceCursor === undefined
          ? {}
          : { syncCursor: (outcome.sourceCursor ?? Prisma.DbNull) as Prisma.InputJsonValue }),
      },
    });
    if (completed.count === 0) {
      // All stream updates above roll back with this transaction. A newer lease is
      // now authoritative, so this worker must not publish any of its stale state.
      throw new StatusError(StatusError.Conflict, "This sync's lease expired before it could finish.");
    }
  });

  return await getDataSourceOrThrow(tenancy, source.id);
}

export async function syncDataSource(tenancy: Tenancy, dataSourceId: string): Promise<DataSourceWithStreams> {
  await ensureDataWarehouseEntitlement(tenancy);
  const source = await getDataSourceOrThrow(tenancy, dataSourceId);
  if (source.streams.length === 0) return source;

  const prisma = await getPrismaClientForTenancy(tenancy);
  const startedAt = new Date();
  const claimed = await prisma.$executeRaw`
    UPDATE "DataSource"
    SET "lastSyncStartedAt" = ${startedAt}, "error" = NULL
    WHERE "id" = ${source.id}::uuid
      AND (
        "lastSyncStartedAt" IS NULL
        OR "lastSyncStartedAt" <= "lastSyncFinishedAt"
        OR "lastSyncStartedAt" < NOW() - make_interval(secs => ${SYNC_CLAIM_LEASE_SECONDS})
      )
  `;
  if (claimed === 0) {
    throw new StatusError(StatusError.Conflict, "A sync is already running for this source.");
  }

  try {
    // Configuration may have changed between the initial read and our claim.
    // Once the lease is ours, re-read so execution cannot resurrect a removed CDC
    // stream (and its replication slot) from a stale plan.
    const claimedSource = await getDataSourceOrThrow(tenancy, dataSourceId);
    return await syncClaimedDataSource(tenancy, claimedSource, startedAt);
  } catch (error) {
    await prisma.dataSource.updateMany({
      where: { id: source.id, lastSyncStartedAt: startedAt },
      data: { lastSyncFinishedAt: new Date(), error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

/**
 * One step of the scheduler: claims and syncs the oldest source whose interval
 * has elapsed. Returns whether it did anything, so the cron route can keep going
 * until the queue is empty or its time budget runs out.
 *
 * Sources are taken oldest-sync-first so that one source erroring quickly cannot
 * starve the others by being picked repeatedly.
 */
export async function runDueDataSourceSyncs(options: { deadlineMs: number }): Promise<{ didWork: boolean }> {
  if (Date.now() >= options.deadlineMs) return { didWork: false };

  // Claims in the same statement that selects. The cron fires every minute while
  // a sweep may run for minutes, so without a claim every overlapping invocation
  // would pick the same rows and sync one source several times at once —
  // causing concurrent slot reads and duplicate inserts.
  const due = await globalPrismaClient.$queryRaw<{ id: string, tenancyId: string, lastSyncStartedAt: Date }[]>`
    UPDATE "DataSource"
    SET "lastSyncStartedAt" = NOW(), "error" = NULL
    WHERE "id" = (
      SELECT "id" FROM "DataSource"
      WHERE "status" = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM "DataSourceStream" s WHERE s."dataSourceId" = "DataSource"."id")
        AND (
          "lastSyncFinishedAt" IS NULL
          OR "lastSyncFinishedAt" < NOW() - make_interval(secs => "syncIntervalSeconds")
        )
        -- The lease: a claim older than this belonged to an invocation that died,
        -- so the row becomes eligible again rather than being stuck forever.
        AND (
          "lastSyncStartedAt" IS NULL
          OR "lastSyncStartedAt" <= "lastSyncFinishedAt"
          OR "lastSyncStartedAt" < NOW() - make_interval(secs => ${SYNC_CLAIM_LEASE_SECONDS})
        )
      ORDER BY "lastSyncFinishedAt" ASC NULLS FIRST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "tenancyId", "lastSyncStartedAt"
  `;
  if (due.length === 0) return { didWork: false };

  for (const row of due) {
    try {
      const tenancy = await getTenancy(row.tenancyId);
      if (tenancy == null) throw new Error(`No tenancy exists for data source ${row.id}.`);
      await ensureDataWarehouseEntitlement(tenancy);
      const source = await getDataSourceOrThrow(tenancy, row.id);
      await syncClaimedDataSource(tenancy, source, row.lastSyncStartedAt);
    } catch (error) {
      // A source that cannot sync must not stop the sweep, and the failure is
      // already recorded on the row for the dashboard to show.
      captureError("data-source-scheduled-sync", error);
      // lastSyncFinishedAt is set so the interval applies to the retry too; the
      // status stays ACTIVE so a transient failure does not park the source.
      await globalPrismaClient.dataSource.updateMany({
        where: { id: row.id, lastSyncStartedAt: row.lastSyncStartedAt },
        data: { lastSyncFinishedAt: new Date(), error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  return { didWork: true };
}
