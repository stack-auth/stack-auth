import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { ensureDataWarehouseEntitlement, getDataWarehouse, getDataWarehouseNames } from "@/lib/data-warehouse";
import { getDestinationTableName } from "@/lib/data-sources/clickhouse-destination";
import { DATA_SOURCE_SSL_MODES, type DataSourceCredentials } from "@/lib/data-sources/postgres";
import { probeDataSource, type DataSourceProbeResult, type ProbedTable } from "@/lib/data-sources/probe";
import { runStreamSyncs, type StreamSyncPlan } from "@/lib/data-sources/sync";
import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient, retryTransaction } from "@/prisma-client";
import { Prisma, type DataSource, type DataSourceStream } from "@/generated/prisma/client";
import {
  getDefaultCursorColumn,
  getModeAvailability,
  type DataSourceSyncMode,
} from "@hexclave/shared/dist/data-sources/modes";
import { decryptWithKms, encryptWithKms } from "@hexclave/shared/dist/helpers/vault/server-side";
import { yupObject, yupString, yupValidate } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

const encryptedPasswordSchema = yupObject({
  edkBase64: yupString().defined(),
  ciphertextBase64: yupString().defined(),
}).defined();

const MODE_TO_PRISMA = {
  full_refresh: "FULL_REFRESH",
  cursor: "CURSOR",
  cdc: "CDC",
} as const;
const MODE_FROM_PRISMA = {
  FULL_REFRESH: "full_refresh",
  CURSOR: "cursor",
  CDC: "cdc",
} as const;

export type DataSourceWithStreams = DataSource & { streams: DataSourceStream[] };

async function decryptPassword(encrypted: DataSource["encryptedPassword"]): Promise<string> {
  const envelope = await yupValidate(encryptedPasswordSchema, encrypted);
  return await decryptWithKms(envelope);
}

export async function getCredentials(source: DataSource): Promise<DataSourceCredentials> {
  return {
    host: source.host,
    port: source.port,
    database: source.database,
    username: source.username,
    password: await decryptPassword(source.encryptedPassword),
    sslMode: source.sslMode,
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
  host: string,
  port: number,
  database: string,
  username: string,
  password: string,
  sslMode: string,
};

function assertValidSslMode(sslMode: string): void {
  if (!(DATA_SOURCE_SSL_MODES as readonly string[]).includes(sslMode)) {
    throw new StatusError(StatusError.BadRequest, `Unsupported SSL mode: ${sslMode}`);
  }
}

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
  assertValidSslMode(input.sslMode);

  const probe = await probeDataSource({ ...input, sslMode: input.sslMode });
  const encryptedPassword = await encryptWithKms(input.password);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const source = await prisma.dataSource.create({
    data: {
      tenancyId: tenancy.id,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      sslMode: input.sslMode,
      encryptedPassword,
      capabilities: probe.capabilities,
      status: "PENDING",
    },
    include: { streams: true },
  });
  return { source, probe };
}

export async function deleteDataSource(tenancy: Tenancy, dataSourceId: string): Promise<void> {
  const source = await getDataSourceOrThrow(tenancy, dataSourceId);
  const prisma = await getPrismaClientForTenancy(tenancy);

  // Drop the replication slot before forgetting it exists. A slot nobody reads
  // retains write-ahead log on the customer's server until their disk fills.
  if (source.replicationSlotName != null) {
    try {
      const { withDataSourceClient } = await import("@/lib/data-sources/postgres");
      const credentials = await getCredentials(source);
      await withDataSourceClient(credentials, async client => {
        await client.query(`SELECT pg_drop_replication_slot($1) WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = $1)`, [source.replicationSlotName]);
        if (source.publicationName != null) {
          await client.query(`DROP PUBLICATION IF EXISTS ${JSON.stringify(source.publicationName).replace(/"/g, '"')}`).catch(() => {});
        }
      }, { allowWrites: true });
    } catch (error) {
      // The source may be unreachable, which must not make it undeletable. The
      // slot is then the customer's to drop, and the error says so.
      captureError("data-source-slot-cleanup", error);
    }
  }

  // Destination tables are deliberately left in place: they are the customer's
  // data, in the customer's warehouse, and dropping them on a disconnect would
  // be a surprising amount of destruction for one click.
  await prisma.dataSource.delete({ where: { id: source.id } });
}

/** Re-reads capabilities and catalog, and persists the capability snapshot. */
export async function refreshDataSourceProbe(tenancy: Tenancy, dataSourceId: string): Promise<DataSourceProbeResult> {
  const source = await getDataSourceOrThrow(tenancy, dataSourceId);
  const credentials = await getCredentials(source);
  const probe = await probeDataSource(credentials);
  const prisma = await getPrismaClientForTenancy(tenancy);
  await prisma.dataSource.update({
    where: { id: source.id },
    data: { capabilities: probe.capabilities },
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
  const credentials = await getCredentials(source);
  const probe = await probeDataSource(credentials);
  const prisma = await getPrismaClientForTenancy(tenancy);

  const tablesByName = new Map(probe.tables.map(t => [`${t.schemaName}.${t.tableName}`, t]));
  const existingByName = new Map(source.streams.map(s => [`${s.schemaName}.${s.tableName}`, s]));

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
        destinationTable: getDestinationTableName(config.schemaName, config.tableName),
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
      data: { status: configs.length > 0 ? "ACTIVE" : "PENDING", capabilities: probe.capabilities },
    });
  });

  return await getDataSourceOrThrow(tenancy, dataSourceId);
}

export async function syncDataSource(tenancy: Tenancy, dataSourceId: string): Promise<DataSourceWithStreams> {
  const source = await getDataSourceOrThrow(tenancy, dataSourceId);
  if (source.streams.length === 0) return source;

  const prisma = await getPrismaClientForTenancy(tenancy);
  const databaseName = await getWarehouseDatabaseName(tenancy);
  const credentials = await getCredentials(source);
  const startedAt = new Date();

  await prisma.dataSource.update({ where: { id: source.id }, data: { lastSyncStartedAt: startedAt, error: null } });

  let probe: DataSourceProbeResult;
  try {
    probe = await probeDataSource(credentials);
  } catch (error) {
    // A failure to connect is about the source, not any one stream.
    const message = error instanceof Error ? error.message : String(error);
    await prisma.dataSource.update({
      where: { id: source.id },
      data: { status: "FAILED", error: message, lastSyncFinishedAt: new Date() },
    });
    return await getDataSourceOrThrow(tenancy, dataSourceId);
  }

  const tablesByName = new Map<string, ProbedTable>(probe.tables.map(t => [`${t.schemaName}.${t.tableName}`, t]));
  const plans: StreamSyncPlan[] = source.streams.map(stream => ({
    streamId: stream.id,
    schemaName: stream.schemaName,
    tableName: stream.tableName,
    mode: MODE_FROM_PRISMA[stream.mode],
    cursorColumn: stream.cursorColumn,
    primaryKeyColumns: stream.primaryKeyColumns,
    destinationTable: stream.destinationTable,
    syncCursor: stream.syncCursor as { mode: string, value: string } | null,
  }));

  const slotName = `hexclave_${source.id.replace(/-/g, "")}`;
  const clickhouse = getClickhouseAdminClient();
  let results;
  try {
    results = await runStreamSyncs({
      credentials,
      clickhouse,
      databaseName,
      tablesByName,
      slotName,
      publicationName: slotName,
      startedAt,
    }, plans);
  } finally {
    await clickhouse.close();
  }

  const usesCdc = plans.some(plan => plan.mode === "cdc");
  await retryTransaction(prisma, async tx => {
    for (const result of results) {
      await tx.dataSourceStream.update({
        where: { id: result.streamId },
        data: {
          status: result.error == null ? "ACTIVE" : "FAILED",
          error: result.error,
          syncCursor: result.syncCursor ?? undefined,
          rowsSynced: { increment: BigInt(result.rowsSynced) },
          lastSyncedAt: result.error == null ? new Date() : undefined,
        },
      });
    }
    await tx.dataSource.update({
      where: { id: source.id },
      data: {
        lastSyncFinishedAt: new Date(),
        status: "ACTIVE",
        ...(usesCdc ? { replicationSlotName: slotName, publicationName: slotName } : {}),
      },
    });
  });

  return await getDataSourceOrThrow(tenancy, dataSourceId);
}

/**
 * One pass of the scheduler: syncs every source whose interval has elapsed.
 * Returns whether it did anything, so the cron route can keep going until the
 * queue is empty or its time budget runs out.
 *
 * Sources are taken oldest-sync-first so that one source erroring quickly cannot
 * starve the others by being picked repeatedly.
 */
export async function runDueDataSourceSyncs(options: { deadlineMs: number }): Promise<{ didWork: boolean }> {
  const due = await globalPrismaClient.$queryRaw<{ id: string, tenancyId: string }[]>`
    SELECT "id", "tenancyId"
    FROM "DataSource"
    WHERE "status" = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM "DataSourceStream" s WHERE s."dataSourceId" = "DataSource"."id")
      AND (
        "lastSyncFinishedAt" IS NULL
        OR "lastSyncFinishedAt" < NOW() - make_interval(secs => "syncIntervalSeconds")
      )
    ORDER BY "lastSyncFinishedAt" ASC NULLS FIRST
    LIMIT 20
  `;
  if (due.length === 0) return { didWork: false };

  for (const row of due) {
    if (Date.now() >= options.deadlineMs) break;
    try {
      const tenancy = await getTenancy(row.tenancyId);
      if (tenancy == null) continue;
      await syncDataSource(tenancy, row.id);
    } catch (error) {
      // A source that cannot sync must not stop the sweep, and the failure is
      // already recorded on the row for the dashboard to show.
      captureError("data-source-scheduled-sync", error);
      await globalPrismaClient.dataSource.update({
        where: { id: row.id },
        data: { lastSyncFinishedAt: new Date(), status: "FAILED", error: error instanceof Error ? error.message : String(error) },
      }).catch(() => {
        // The row may have been deleted mid-sweep.
      });
    }
  }
  return { didWork: true };
}
