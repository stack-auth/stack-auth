import type { ClickHouseClient } from "@clickhouse/client";
import type { Client } from "pg";
import {
  DELETED_COLUMN,
  ensureDestinationTable,
  insertRows,
  quoteClickhouseIdentifier,
} from "./clickhouse-destination";
import { decodePgoutputMessage, formatLsn, parseLsn, type PgoutputRelation, type PgoutputTuple } from "./pgoutput";
import { quotePgIdentifier, quotePgQualifiedName, withDataSourceClient, type DataSourceCredentials } from "./postgres";
import type { DataSourceColumn, ProbedTable } from "./probe";
import { buildDestinationRow, coerceTextValue, versionFromCursorValue } from "./rows";

/** Rows per round trip. Large enough to amortise latency, small enough to bound memory. */
const READ_BATCH_SIZE = 10_000;
/** Stops one enormous table from monopolising a sync run; the next run resumes where this left off. */
const MAX_BATCHES_PER_STREAM = 50;
/** WAL changes decoded per peek. Postgres always completes the transaction it is in, so this is a floor. */
const MAX_WAL_CHANGES_PER_SYNC = 20_000;

/**
 * Reading up to `now()` would race the commit of a transaction that set its
 * timestamp earlier: its rows would become visible after we had already moved
 * the watermark past them, and would never be read again. Staying behind by this
 * much shrinks that window to transactions that run longer than it.
 */
const CURSOR_SAFETY_LAG_SECONDS = 10;

export type StreamSyncPlan = {
  streamId: string,
  schemaName: string,
  tableName: string,
  mode: "full_refresh" | "cursor" | "cdc",
  cursorColumn: string | null,
  primaryKeyColumns: string[],
  destinationTable: string,
  syncCursor: { mode: string, value: string } | null,
};

export type StreamSyncResult = {
  streamId: string,
  rowsSynced: number,
  syncCursor: { mode: string, value: string } | null,
  error: string | null,
};

export type SyncContext = {
  credentials: DataSourceCredentials,
  clickhouse: ClickHouseClient,
  databaseName: string,
  /** Fresh catalog, keyed `schema.table`, so column lists match what we are about to read. */
  tablesByName: Map<string, ProbedTable>,
  slotName: string,
  publicationName: string,
  startedAt: Date,
};

function tableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

async function prepareDestination(context: SyncContext, plan: StreamSyncPlan, table: ProbedTable): Promise<void> {
  await ensureDestinationTable(context.clickhouse, {
    databaseName: context.databaseName,
    tableName: plan.destinationTable,
    columns: table.columns,
    primaryKeyColumns: plan.primaryKeyColumns,
  });
}

/** Streams a SELECT through a server-side cursor so memory stays bounded whatever the table size. */
async function forEachBatch(
  client: Client,
  query: string,
  params: unknown[],
  onBatch: (rows: Record<string, unknown>[]) => Promise<void>,
): Promise<number> {
  const cursorName = `hexclave_sync_${Math.random().toString(36).slice(2, 10)}`;
  let total = 0;
  await client.query("BEGIN");
  try {
    await client.query(`DECLARE ${quotePgIdentifier(cursorName)} NO SCROLL CURSOR FOR ${query}`, params);
    for (let batch = 0; batch < MAX_BATCHES_PER_STREAM; batch++) {
      const result = await client.query(`FETCH ${READ_BATCH_SIZE} FROM ${quotePgIdentifier(cursorName)}`);
      if (result.rows.length === 0) break;
      await onBatch(result.rows as Record<string, unknown>[]);
      total += result.rows.length;
      if (result.rows.length < READ_BATCH_SIZE) break;
    }
  } finally {
    await client.query("COMMIT").catch(() => {
      // A cursor left open is closed by the connection ending moments later.
    });
  }
  return total;
}

/**
 * Reload the table wholesale into a staging table, then swap it in atomically.
 * Readers see the old table until the exchange, and never a half-loaded one.
 */
async function syncFullRefresh(
  context: SyncContext,
  plan: StreamSyncPlan,
  table: ProbedTable,
  client: Client,
): Promise<StreamSyncResult> {
  const stagingTable = `${plan.destinationTable}__staging`;
  const version = BigInt(context.startedAt.getTime()) * 1000n;

  await prepareDestination(context, plan, table);
  await context.clickhouse.command({
    query: `DROP TABLE IF EXISTS ${quoteClickhouseIdentifier(context.databaseName)}.${quoteClickhouseIdentifier(stagingTable)}`,
  });
  await ensureDestinationTable(context.clickhouse, {
    databaseName: context.databaseName,
    tableName: stagingTable,
    columns: table.columns,
    primaryKeyColumns: plan.primaryKeyColumns,
  });

  const rowsSynced = await forEachBatch(
    client,
    `SELECT * FROM ${quotePgQualifiedName(plan.schemaName, plan.tableName)}`,
    [],
    async rows => {
      await insertRows(context.clickhouse, {
        databaseName: context.databaseName,
        tableName: stagingTable,
        rows: rows.map(values => buildDestinationRow({
          values, columns: table.columns, version, deleted: false, extractedAt: context.startedAt,
        })),
      });
    },
  );

  await context.clickhouse.command({
    query: `EXCHANGE TABLES ${quoteClickhouseIdentifier(context.databaseName)}.${quoteClickhouseIdentifier(stagingTable)}
            AND ${quoteClickhouseIdentifier(context.databaseName)}.${quoteClickhouseIdentifier(plan.destinationTable)}`,
  });
  await context.clickhouse.command({
    query: `DROP TABLE IF EXISTS ${quoteClickhouseIdentifier(context.databaseName)}.${quoteClickhouseIdentifier(stagingTable)}`,
  });

  return { streamId: plan.streamId, rowsSynced, syncCursor: null, error: null };
}

/** Reads rows whose cursor column advanced past the last watermark. */
async function syncCursor(
  context: SyncContext,
  plan: StreamSyncPlan,
  table: ProbedTable,
  client: Client,
): Promise<StreamSyncResult> {
  const cursorColumn = plan.cursorColumn;
  if (cursorColumn == null) {
    return { streamId: plan.streamId, rowsSynced: 0, syncCursor: plan.syncCursor, error: "No cursor column is configured for this table." };
  }
  const candidate = table.cursorCandidates.find(c => c.column === cursorColumn);
  if (!candidate) {
    return { streamId: plan.streamId, rowsSynced: 0, syncCursor: plan.syncCursor, error: `Column ${cursorColumn} is no longer usable as a cursor.` };
  }

  await prepareDestination(context, plan, table);

  const quotedCursor = quotePgIdentifier(cursorColumn);
  const isTemporal = /^(timestamp|date)/i.test(candidate.dataType);
  const conditions: string[] = [];
  const params: unknown[] = [];
  const previous = plan.syncCursor?.mode === "cursor" ? plan.syncCursor.value : null;
  if (previous != null) {
    // `>=` rather than `>` so rows sharing the watermark's exact value are not
    // skipped; the destination deduplicates the overlap by primary key.
    conditions.push(`${quotedCursor} >= $${params.length + 1}`);
    params.push(previous);
  }
  if (isTemporal) {
    conditions.push(`${quotedCursor} <= now() - interval '${CURSOR_SAFETY_LAG_SECONDS} seconds'`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let maxCursor: unknown = previous;
  const rowsSynced = await forEachBatch(
    client,
    `SELECT * FROM ${quotePgQualifiedName(plan.schemaName, plan.tableName)} ${where} ORDER BY ${quotedCursor} ASC`,
    params,
    async rows => {
      const destinationRows = rows.map(values => buildDestinationRow({
        values,
        columns: table.columns,
        version: versionFromCursorValue(values[cursorColumn]),
        deleted: false,
        extractedAt: context.startedAt,
      }));
      // The query is ORDER BY cursor ASC and batches arrive in order, so the last
      // row of the last batch is the maximum. Comparing values ourselves would
      // mean re-implementing Postgres' ordering per type — and comparing them as
      // strings, which is the obvious shortcut, puts "99" above "500".
      maxCursor = rows[rows.length - 1][cursorColumn];
      await insertRows(context.clickhouse, {
        databaseName: context.databaseName,
        tableName: plan.destinationTable,
        rows: destinationRows,
      });
    },
  );

  const nextValue = maxCursor instanceof Date ? maxCursor.toISOString() : maxCursor == null ? null : String(maxCursor);
  return {
    streamId: plan.streamId,
    rowsSynced,
    syncCursor: nextValue == null ? plan.syncCursor : { mode: "cursor", value: nextValue },
    error: null,
  };
}

/**
 * Creates the publication and replication slot the CDC streams share. One slot
 * per source: slots are per-database, and a slot per table would multiply the
 * WAL-retention risk for no benefit.
 */
async function ensureCdcInfrastructure(
  client: Client,
  context: SyncContext,
  plans: StreamSyncPlan[],
): Promise<void> {
  const tableList = plans
    .map(plan => quotePgQualifiedName(plan.schemaName, plan.tableName))
    .join(", ");

  const existingPublication = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = $1) AS exists`,
    [context.publicationName],
  );
  try {
    if (existingPublication.rows[0].exists) {
      // SET rather than ADD: a table the customer removed from the sync must stop
      // pinning WAL for changes nobody will read.
      await client.query(`ALTER PUBLICATION ${quotePgIdentifier(context.publicationName)} SET TABLE ${tableList}`);
    } else {
      await client.query(`CREATE PUBLICATION ${quotePgIdentifier(context.publicationName)} FOR TABLE ${tableList}`);
    }
  } catch (error) {
    // Publication DDL needs ownership of the tables. Rather than fail opaquely,
    // hand back the exact statement a DBA can run.
    throw new Error(
      `Could not manage the publication for change data capture (${error instanceof Error ? error.message : String(error)}). ` +
      `Run this on your database as a user that owns the tables, then sync again: ` +
      `CREATE PUBLICATION ${quotePgIdentifier(context.publicationName)} FOR TABLE ${tableList};`,
    );
  }

  const existingSlot = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = $1) AS exists`,
    [context.slotName],
  );
  if (!existingSlot.rows[0].exists) {
    await client.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [context.slotName]);
  }
}

/**
 * Initial load for a CDC stream. Written at version 0 so that any WAL change for
 * the same row — which necessarily has a non-zero LSN — wins during merges. That
 * is what makes it safe to create the slot first and snapshot afterwards: the
 * overlap produces duplicates, which deduplicate, rather than a gap, which would
 * be silent data loss.
 */
async function snapshotForCdc(
  context: SyncContext,
  plan: StreamSyncPlan,
  table: ProbedTable,
  client: Client,
): Promise<number> {
  await prepareDestination(context, plan, table);
  return await forEachBatch(
    client,
    `SELECT * FROM ${quotePgQualifiedName(plan.schemaName, plan.tableName)}`,
    [],
    async rows => {
      await insertRows(context.clickhouse, {
        databaseName: context.databaseName,
        tableName: plan.destinationTable,
        rows: rows.map(values => buildDestinationRow({
          values, columns: table.columns, version: 0n, deleted: false, extractedAt: context.startedAt,
        })),
      });
    },
  );
}

function tupleToValues(tuple: PgoutputTuple, relation: PgoutputRelation, table: ProbedTable): Record<string, unknown> {
  const typesByColumn = new Map(table.columns.map(c => [c.name, c.dataType]));
  const values: Record<string, unknown> = {};
  for (const column of relation.columns) {
    const raw = tuple[column.name];
    // Absent means an unchanged TOAST value; leaving the key out preserves it.
    if (raw === undefined) continue;
    values[column.name] = coerceTextValue(raw, typesByColumn.get(column.name) ?? "text");
  }
  return values;
}

/**
 * Reads the WAL accumulated since the last sync and applies it. Peek rather than
 * get: `pg_logical_slot_get_changes` consumes as it returns, so a failure between
 * reading and writing to ClickHouse would lose those changes permanently. We
 * advance the slot only once the destination write has succeeded.
 */
async function consumeWal(
  context: SyncContext,
  plans: StreamSyncPlan[],
  client: Client,
): Promise<{ rowsByStream: Map<string, number>, lastCommitLsn: bigint | null }> {
  const planByTable = new Map(plans.map(plan => [tableKey(plan.schemaName, plan.tableName), plan]));
  const changes = await client.query<{ lsn: string, data: Buffer }>(
    `SELECT lsn::text AS lsn, data
     FROM pg_logical_slot_peek_binary_changes($1, NULL, $2, 'proto_version', '1', 'publication_names', $3)`,
    [context.slotName, MAX_WAL_CHANGES_PER_SYNC, context.publicationName],
  );

  const relations = new Map<number, PgoutputRelation>();
  const rowsByDestination = new Map<string, Record<string, unknown>[]>();
  const rowsByStream = new Map<string, number>();
  let lastCommitLsn: bigint | null = null;
  let currentCommitLsn = 0n;

  for (const change of changes.rows) {
    const message = decodePgoutputMessage(change.data, relations);
    if (message.type === "begin") {
      // Every row in the transaction is versioned by where the transaction ends,
      // which is the order the rows actually became visible.
      currentCommitLsn = message.finalLsn;
      continue;
    }
    if (message.type === "commit") {
      lastCommitLsn = message.endLsn;
      continue;
    }
    if (message.type !== "insert" && message.type !== "update" && message.type !== "delete") continue;

    const relation = relations.get(message.relationId);
    if (!relation) continue;
    const plan = planByTable.get(tableKey(relation.schemaName, relation.tableName));
    if (!plan) continue;
    const table = context.tablesByName.get(tableKey(plan.schemaName, plan.tableName));
    if (!table) continue;

    const deleted = message.type === "delete";
    const tuple = deleted ? message.keyRow : message.row;
    const row = buildDestinationRow({
      values: tupleToValues(tuple, relation, table),
      columns: table.columns,
      version: currentCommitLsn,
      deleted,
      extractedAt: context.startedAt,
    });
    if (!rowsByDestination.has(plan.destinationTable)) rowsByDestination.set(plan.destinationTable, []);
    rowsByDestination.get(plan.destinationTable)!.push(row);
    rowsByStream.set(plan.streamId, (rowsByStream.get(plan.streamId) ?? 0) + 1);
  }

  for (const [destinationTable, rows] of rowsByDestination) {
    await insertRows(context.clickhouse, { databaseName: context.databaseName, tableName: destinationTable, rows });
  }

  return { rowsByStream, lastCommitLsn };
}

async function syncCdcStreams(
  context: SyncContext,
  plans: StreamSyncPlan[],
  client: Client,
): Promise<StreamSyncResult[]> {
  await ensureCdcInfrastructure(client, context, plans);

  const results = new Map<string, StreamSyncResult>();
  for (const plan of plans) {
    results.set(plan.streamId, { streamId: plan.streamId, rowsSynced: 0, syncCursor: plan.syncCursor, error: null });
  }

  // Snapshot anything that has never been loaded. Done after the slot exists, so
  // changes made during the snapshot are captured by the WAL as well.
  for (const plan of plans) {
    if (plan.syncCursor?.mode === "lsn") continue;
    const table = context.tablesByName.get(tableKey(plan.schemaName, plan.tableName));
    if (!table) continue;
    const rowsSynced = await snapshotForCdc(context, plan, table, client);
    results.set(plan.streamId, {
      streamId: plan.streamId,
      rowsSynced,
      syncCursor: { mode: "lsn", value: "0/0" },
      error: null,
    });
  }

  const { rowsByStream, lastCommitLsn } = await consumeWal(context, plans, client);
  if (lastCommitLsn != null) {
    const lsnText = formatLsn(lastCommitLsn);
    await client.query(`SELECT pg_replication_slot_advance($1, $2::pg_lsn)`, [context.slotName, lsnText]);
    for (const plan of plans) {
      const existing = results.get(plan.streamId)!;
      results.set(plan.streamId, {
        ...existing,
        rowsSynced: existing.rowsSynced + (rowsByStream.get(plan.streamId) ?? 0),
        syncCursor: { mode: "lsn", value: lsnText },
      });
    }
  }
  return [...results.values()];
}

/**
 * Runs every configured stream. One stream failing must not stop the others:
 * a permissions change on one table is not a reason to stop syncing the rest.
 */
export async function runStreamSyncs(context: SyncContext, plans: StreamSyncPlan[]): Promise<StreamSyncResult[]> {
  const results: StreamSyncResult[] = [];
  const cdcPlans = plans.filter(plan => plan.mode === "cdc");
  const pullPlans = plans.filter(plan => plan.mode !== "cdc");

  if (pullPlans.length > 0) {
    await withDataSourceClient(context.credentials, async client => {
      for (const plan of pullPlans) {
        const table = context.tablesByName.get(tableKey(plan.schemaName, plan.tableName));
        if (!table) {
          results.push({ streamId: plan.streamId, rowsSynced: 0, syncCursor: plan.syncCursor, error: "The table no longer exists, or our role can no longer read it." });
          continue;
        }
        try {
          results.push(plan.mode === "full_refresh"
            ? await syncFullRefresh(context, plan, table, client)
            : await syncCursor(context, plan, table, client));
        } catch (error) {
          results.push({
            streamId: plan.streamId,
            rowsSynced: 0,
            syncCursor: plan.syncCursor,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
  }

  if (cdcPlans.length > 0) {
    try {
      // Slot management is refused inside a read-only transaction, so the CDC
      // connection opts out of it. Everything it runs is still only reads plus
      // the slot calls themselves.
      const cdcResults = await withDataSourceClient(
        context.credentials,
        async client => await syncCdcStreams(context, cdcPlans, client),
        { allowWrites: true },
      );
      results.push(...cdcResults);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const plan of cdcPlans) {
        results.push({ streamId: plan.streamId, rowsSynced: 0, syncCursor: plan.syncCursor, error: message });
      }
    }
  }

  return results;
}

export { DELETED_COLUMN };
