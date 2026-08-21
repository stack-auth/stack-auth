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
/**
 * Stops one enormous table from monopolising a sync run. Only safe for cursor
 * mode, which resumes from its watermark next run — a full refresh or a CDC
 * snapshot that stopped early would publish a partial table, so those read to
 * exhaustion instead.
 */
const MAX_BATCHES_PER_CURSOR_SYNC = 50;
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
  syncCursor: SyncCursorState | null,
  /**
   * True until the stream has synced once in its current configuration. A mode or
   * cursor change resets it, because the destination's existing rows were versioned
   * on a scale the new mode cannot beat — full-refresh versions are epoch
   * microseconds, CDC versions are LSNs, and no real LSN ever reaches 1.7e15 — so
   * carrying them over would freeze the table forever.
   */
  isPending: boolean,
};

export type SyncCursorState = {
  mode: string,
  value: string,
  /** JSON-encoded primary key of the last row read, for total-order resumption. */
  key?: string,
};

export type StreamSyncResult = {
  streamId: string,
  rowsSynced: number,
  syncCursor: SyncCursorState | null,
  error: string | null,
  /** The source truncated this table; only a fresh snapshot can represent that. */
  needsResnapshot?: boolean,
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
  if (plan.isPending) {
    // Rebuilt from scratch rather than merged into: see StreamSyncPlan.isPending.
    await context.clickhouse.command({
      query: `DROP TABLE IF EXISTS ${quoteClickhouseIdentifier(context.databaseName)}.${quoteClickhouseIdentifier(plan.destinationTable)}`,
    });
  }
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
  options: { maxBatches: number },
): Promise<number> {
  const cursorName = `hexclave_sync_${Math.random().toString(36).slice(2, 10)}`;
  let total = 0;
  await client.query("BEGIN");
  try {
    await client.query(`DECLARE ${quotePgIdentifier(cursorName)} NO SCROLL CURSOR FOR ${query}`, params);
    for (let batch = 0; batch < options.maxBatches; batch++) {
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
    // Unbounded: the mode is already restricted to tables under
    // FULL_REFRESH_MAX_ROWS, and a partial load would be swapped in as if complete.
    { maxBatches: Number.POSITIVE_INFINITY },
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
  const previousKey = plan.syncCursor?.mode === "cursor" ? plan.syncCursor.key ?? null : null;

  // With a primary key, (cursor, key) is a total order, so the read can resume
  // strictly after the last row seen. That both removes the duplicate re-read of
  // the boundary and — the reason it matters — stops a group of rows sharing one
  // cursor value from livelocking: a bulk backfill that stamps 600k rows with the
  // same updated_at would otherwise re-read the same first batch forever.
  const useKeyset = plan.primaryKeyColumns.length > 0;
  const orderColumns = useKeyset
    ? [quotedCursor, ...plan.primaryKeyColumns.map(quotePgIdentifier)]
    : [quotedCursor];

  if (previous != null) {
    if (useKeyset && previousKey != null) {
      const keyValues = JSON.parse(previousKey) as unknown[];
      const placeholders = [previous, ...keyValues].map(value => {
        params.push(value);
        return `$${params.length}`;
      });
      conditions.push(`(${orderColumns.join(", ")}) > (${placeholders.join(", ")})`);
    } else {
      // No key to break ties with, so the watermark is re-read inclusively and the
      // overlap is tolerated rather than risking a skip.
      conditions.push(`${quotedCursor} >= $${params.length + 1}`);
      params.push(previous);
    }
  }
  if (isTemporal) {
    conditions.push(`${quotedCursor} <= now() - interval '${CURSOR_SAFETY_LAG_SECONDS} seconds'`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let maxCursor: unknown = previous;
  let maxKey: string | null = previousKey;
  const rowsSynced = await forEachBatch(
    client,
    `SELECT * FROM ${quotePgQualifiedName(plan.schemaName, plan.tableName)} ${where} ORDER BY ${orderColumns.map(c => `${c} ASC`).join(", ")}`,
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
      const last = rows[rows.length - 1];
      maxCursor = last[cursorColumn];
      maxKey = useKeyset ? JSON.stringify(plan.primaryKeyColumns.map(column => last[column])) : null;
      await insertRows(context.clickhouse, {
        databaseName: context.databaseName,
        tableName: plan.destinationTable,
        rows: destinationRows,
      });
    },
    { maxBatches: MAX_BATCHES_PER_CURSOR_SYNC },
  );

  const nextValue = maxCursor instanceof Date ? maxCursor.toISOString() : maxCursor == null ? null : String(maxCursor);
  return {
    streamId: plan.streamId,
    rowsSynced,
    syncCursor: nextValue == null ? plan.syncCursor : { mode: "cursor", value: nextValue, key: maxKey ?? undefined },
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
): Promise<{ slotWasCreated: boolean }> {
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
  if (existingSlot.rows[0].exists) {
    return { slotWasCreated: false };
  }
  await client.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [context.slotName]);
  return { slotWasCreated: true };
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
    // Unbounded: the LSN cursor is written once the snapshot returns, so stopping
    // early would mark rows as loaded that never were.
    { maxBatches: Number.POSITIVE_INFINITY },
  );
}

/**
 * Re-reads rows whose WAL entry withheld an unchanged TOAST value.
 *
 * Postgres omits large unchanged column values from the WAL, so an UPDATE that
 * touched only `title` sends nothing for a multi-kilobyte `body`. There is no way
 * to express "leave this column alone" in a MergeTree insert — an omitted field
 * takes the column default and a NULL erases it — and the new row carries a higher
 * version, so it wins the merge either way. The only correct fix is to fetch the
 * current row and write it whole.
 */
async function refetchRowsByKey(
  client: Client,
  plan: StreamSyncPlan,
  keys: Record<string, unknown>[],
): Promise<Map<string, Record<string, unknown>>> {
  const byKey = new Map<string, Record<string, unknown>>();
  if (keys.length === 0 || plan.primaryKeyColumns.length === 0) return byKey;

  const keyColumns = plan.primaryKeyColumns;
  const quotedKeys = keyColumns.map(quotePgIdentifier).join(", ");
  const params: unknown[] = [];
  const tuples = keys.map(key => {
    const placeholders = keyColumns.map(column => {
      params.push(key[column]);
      return `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const result = await client.query(
    `SELECT * FROM ${quotePgQualifiedName(plan.schemaName, plan.tableName)}
     WHERE (${quotedKeys}) IN (${tuples.join(", ")})`,
    params,
  );
  for (const row of result.rows as Record<string, unknown>[]) {
    byKey.set(keyColumns.map(column => String(row[column])).join("\u0000"), row);
  }
  return byKey;
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
): Promise<{ rowsByStream: Map<string, number>, lastCommitLsn: bigint | null, truncatedStreams: Set<string> }> {
  const planByTable = new Map(plans.map(plan => [tableKey(plan.schemaName, plan.tableName), plan]));
  const changes = await client.query<{ lsn: string, data: Buffer }>(
    `SELECT lsn::text AS lsn, data
     FROM pg_logical_slot_peek_binary_changes($1, NULL, $2, 'proto_version', '1', 'publication_names', $3)`,
    [context.slotName, MAX_WAL_CHANGES_PER_SYNC, context.publicationName],
  );

  const relations = new Map<number, PgoutputRelation>();
  const rowsByDestination = new Map<string, Record<string, unknown>[]>();
  const rowsByStream = new Map<string, number>();
  // Rows whose WAL entry withheld an unchanged TOAST value, to be re-read whole.
  const toastedByStream = new Map<string, { plan: StreamSyncPlan, rows: Record<string, unknown>[] }>();
  let lastCommitLsn: bigint | null = null;
  let currentCommitLsn = 0n;
  const truncatedStreams = new Set<string>();

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
    if (message.type === "truncate") {
      // There is no tombstone that expresses "every row is gone", and leaving them
      // in place would silently diverge from the source. The stream is flagged for
      // a rebuild instead.
      for (const relationId of message.relationIds) {
        const truncated = relations.get(relationId);
        if (truncated == null) continue;
        const truncatedPlan = planByTable.get(tableKey(truncated.schemaName, truncated.tableName));
        if (truncatedPlan != null) truncatedStreams.add(truncatedPlan.streamId);
      }
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
    if (!rowsByDestination.has(plan.destinationTable)) rowsByDestination.set(plan.destinationTable, []);
    const destinationRows = rowsByDestination.get(plan.destinationTable)!;

    // An UPDATE that moves the primary key sends the old key alongside the new
    // row. Without a tombstone for it the pre-update row stays in the warehouse
    // forever, under a key the source no longer has.
    if (message.type === "update" && message.keyRow != null) {
      const oldKey = tupleToValues(message.keyRow, relation, table);
      const movedKey = plan.primaryKeyColumns.some(
        column => oldKey[column] !== undefined && String(oldKey[column]) !== String(message.row[column]),
      );
      if (movedKey) {
        destinationRows.push(buildDestinationRow({
          values: oldKey, columns: table.columns, version: currentCommitLsn, deleted: true, extractedAt: context.startedAt,
        }));
      }
    }

    const values = tupleToValues(tuple, relation, table);
    const row = buildDestinationRow({
      values,
      columns: table.columns,
      version: currentCommitLsn,
      deleted,
      extractedAt: context.startedAt,
    });
    destinationRows.push(row);
    rowsByStream.set(plan.streamId, (rowsByStream.get(plan.streamId) ?? 0) + 1);

    // 'u' in the tuple means an unchanged TOAST value the server did not send.
    if (!deleted && relation.columns.some(column => tuple[column.name] === undefined)) {
      if (!toastedByStream.has(plan.streamId)) toastedByStream.set(plan.streamId, { plan, rows: [] });
      toastedByStream.get(plan.streamId)!.rows.push(values);
    }
  }

  // Written after the WAL rows, at the same commit version, so the complete row
  // is what a merge keeps: ReplacingMergeTree takes the last inserted row when
  // versions tie.
  for (const { plan, rows } of toastedByStream.values()) {
    const table = context.tablesByName.get(tableKey(plan.schemaName, plan.tableName));
    if (table == null) continue;
    const complete = await refetchRowsByKey(client, plan, rows);
    const destinationRows = rowsByDestination.get(plan.destinationTable) ?? [];
    for (const partial of rows) {
      const key = plan.primaryKeyColumns.map(column => String(partial[column])).join("\u0000");
      const full = complete.get(key);
      // Absent means the row was deleted again later in the same batch; the
      // tombstone we already queued is the correct final state.
      if (full == null) continue;
      destinationRows.push(buildDestinationRow({
        values: full, columns: table.columns, version: currentCommitLsn, deleted: false, extractedAt: context.startedAt,
      }));
    }
    rowsByDestination.set(plan.destinationTable, destinationRows);
  }

  for (const [destinationTable, rows] of rowsByDestination) {
    await insertRows(context.clickhouse, { databaseName: context.databaseName, tableName: destinationTable, rows });
  }

  return { rowsByStream, lastCommitLsn, truncatedStreams };
}

async function syncCdcStreams(
  context: SyncContext,
  plans: StreamSyncPlan[],
  client: Client,
): Promise<StreamSyncResult[]> {
  const { slotWasCreated } = await ensureCdcInfrastructure(client, context, plans);

  // Every sync, not just the snapshot: the WAL carries no DDL, so a column the
  // customer added since the stream started only reaches the destination table
  // through this. Without it ClickHouse silently drops the unknown field and the
  // new column stays empty forever.
  for (const plan of plans) {
    const table = context.tablesByName.get(tableKey(plan.schemaName, plan.tableName));
    if (table != null) await prepareDestination(context, plan, table);
  }

  const results = new Map<string, StreamSyncResult>();
  for (const plan of plans) {
    results.set(plan.streamId, { streamId: plan.streamId, rowsSynced: 0, syncCursor: plan.syncCursor, error: null });
  }

  // Snapshot anything that has never been loaded. Done after the slot exists, so
  // changes made during the snapshot are captured by the WAL as well.
  for (const plan of plans) {
    // A slot we had to create while a stream already held an LSN means the old
    // slot is gone — dropped, failed over, or restored from a backup. A new slot
    // starts at the current WAL position, so everything in between is missing and
    // only a fresh snapshot can recover it.
    const lostSlot = slotWasCreated && plan.syncCursor?.mode === "lsn";
    if (plan.syncCursor?.mode === "lsn" && !lostSlot) continue;
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

  const { rowsByStream, lastCommitLsn, truncatedStreams } = await consumeWal(context, plans, client);
  if (lastCommitLsn != null) {
    const lsnText = formatLsn(lastCommitLsn);
    await client.query(`SELECT pg_replication_slot_advance($1, $2::pg_lsn)`, [context.slotName, lsnText]);
    for (const plan of plans) {
      const existing = results.get(plan.streamId)!;
      results.set(plan.streamId, {
        ...existing,
        rowsSynced: existing.rowsSynced + (rowsByStream.get(plan.streamId) ?? 0),
        syncCursor: { mode: "lsn", value: lsnText },
        needsResnapshot: truncatedStreams.has(plan.streamId),
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
