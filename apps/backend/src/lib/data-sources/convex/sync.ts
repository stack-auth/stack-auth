import { ensureDestinationTable, insertRows, quoteClickhouseIdentifier } from "../clickhouse-destination";
import { buildDestinationRow } from "../rows";
import type { ProbedTable, StreamSyncPlan, StreamSyncResult, SyncContext, SyncOutcome } from "../types";
import { convexRequest, toConvexCredentials, type ConvexCredentials } from "./client";
import { toBigInt } from "./json";
import { componentToSchemaName } from "./probe";
import { toDestinationValues } from "./values";

/**
 * Pages read in one sync run.
 *
 * Convex's feed is unbounded — `pagination.hasMore` is true even once there is
 * nothing left — so the loop ends when the deployment says `upToDate`. This cap
 * exists only so that a deployment producing changes faster than we can drain it
 * cannot hold a sync run open forever; the cursor is saved either way, and the
 * next run picks up where this one stopped.
 */
const MAX_PAGES_PER_SYNC = 500;

/** Rows buffered before a flush to ClickHouse, so memory stays bounded on a large snapshot. */
const INSERT_BATCH_ROWS = 20_000;

type ConvexSyncPage = {
  /**
   * `snapshotting` while the initial copy is still being emitted, `stale` while
   * catching up on changes since it, and `upToDate` once the pages returned so
   * far amount to a consistent view.
   */
  status: { type: "snapshotting" | "stale" | "upToDate", snapshotTs?: unknown },
  /** Tables whose contents were replaced wholesale; everything held for them is now wrong. */
  truncates: { component: string, table: string }[],
  values: {
    component: string,
    table: string,
    /** Nanosecond mutation timestamp. A string once the parser has protected it from rounding. */
    ts: unknown,
    deleted: boolean,
    value: Record<string, unknown>,
  }[],
  pagination: { hasMore: boolean, nextCursor: string },
};

function tableKey(schemaName: string, tableName: string): string {
  return `${schemaName}.${tableName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSyncPage(value: unknown): value is ConvexSyncPage {
  if (!isRecord(value)) return false;
  if (!isRecord(value.status) || typeof value.status.type !== "string") return false;
  if (!Array.isArray(value.values) || !Array.isArray(value.truncates)) return false;
  return isRecord(value.pagination) && typeof value.pagination.nextCursor === "string";
}

/**
 * Convex's cursor covers the whole deployment rather than one table, so it lives
 * on the source. A stream-level cursor could not express "all tables are at this
 * point", and holding one per stream would mean re-reading the same feed once
 * per table.
 */
type ConvexSourceCursor = { mode: "convex", value: string };

function readSourceCursor(sourceCursor: unknown): string | null {
  if (typeof sourceCursor !== "object" || sourceCursor === null) return null;
  const cursor = sourceCursor as Partial<ConvexSourceCursor>;
  return cursor.mode === "convex" && typeof cursor.value === "string" ? cursor.value : null;
}

/**
 * Buffers rows per destination table and flushes when one grows large enough.
 *
 * Rows for many tables arrive interleaved in a single page, so they cannot be
 * written as they are read without one round trip per row.
 */
class DestinationBuffer {
  private readonly rowsByTable = new Map<string, Record<string, unknown>[]>();

  constructor(private readonly context: SyncContext) {}

  async add(destinationTable: string, row: Record<string, unknown>): Promise<void> {
    const rows = this.rowsByTable.get(destinationTable) ?? [];
    rows.push(row);
    this.rowsByTable.set(destinationTable, rows);
    if (rows.length >= INSERT_BATCH_ROWS) await this.flushTable(destinationTable);
  }

  async flush(): Promise<void> {
    for (const destinationTable of [...this.rowsByTable.keys()]) {
      await this.flushTable(destinationTable);
    }
  }

  private async flushTable(destinationTable: string): Promise<void> {
    const rows = this.rowsByTable.get(destinationTable);
    if (rows == null || rows.length === 0) return;
    this.rowsByTable.set(destinationTable, []);
    await insertRows(this.context.clickhouse, {
      databaseName: this.context.databaseName,
      tableName: destinationTable,
      rows,
    });
  }
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

/**
 * Drops and recreates a destination table mid-sync, in response to a truncate.
 *
 * Convex emits a truncate for every table at the start of a fresh snapshot, so
 * this is the ordinary first-sync path as much as it is the response to a table
 * the customer actually cleared. Buffered rows are flushed first: a truncate
 * applies to everything before it, and dropping the table with rows still
 * pending would write them into the new one.
 */
async function applyTruncate(
  context: SyncContext,
  plan: StreamSyncPlan,
  table: ProbedTable,
  buffer: DestinationBuffer,
): Promise<void> {
  await buffer.flush();
  await context.clickhouse.command({
    query: `DROP TABLE IF EXISTS ${quoteClickhouseIdentifier(context.databaseName)}.${quoteClickhouseIdentifier(plan.destinationTable)}`,
  });
  await ensureDestinationTable(context.clickhouse, {
    databaseName: context.databaseName,
    tableName: plan.destinationTable,
    columns: table.columns,
    primaryKeyColumns: plan.primaryKeyColumns,
  });
}

async function fetchPage(credentials: ConvexCredentials, cursor: string | null): Promise<ConvexSyncPage> {
  const response = await convexRequest(credentials, "/api/v1/data/sync", {
    method: "POST",
    body: cursor == null ? {} : { cursor },
  });
  if (!isSyncPage(response)) {
    throw new Error("Convex returned a change feed page we could not read.");
  }
  return response;
}

/**
 * Fetches the first page, falling back to a full re-snapshot if the stored
 * cursor is no longer usable.
 *
 * Convex keeps roughly a month of history, so a source that was paused, failing,
 * or simply never scheduled for long enough comes back to a cursor the
 * deployment has forgotten. Starting over is the only way forward, and it is
 * safe: the snapshot truncates and rebuilds every table it covers.
 *
 * The original error is what surfaces if the retry fails too, so a rejected
 * deploy key still reads as a rejected deploy key rather than as a bad cursor.
 */
async function fetchFirstPage(credentials: ConvexCredentials, cursor: string | null): Promise<ConvexSyncPage> {
  if (cursor == null) return await fetchPage(credentials, null);
  try {
    return await fetchPage(credentials, cursor);
  } catch (error) {
    try {
      return await fetchPage(credentials, null);
    } catch {
      throw error;
    }
  }
}

/**
 * Reads the deployment's change feed and applies it to every configured stream.
 *
 * Unlike the Postgres driver there is one feed for the whole deployment, so this
 * is a single pass whatever the number of streams — and rows for tables the
 * customer did not select are read and discarded, because the feed cannot be
 * filtered server-side.
 */
export async function runConvexStreamSyncs(context: SyncContext, plans: StreamSyncPlan[]): Promise<SyncOutcome> {
  const credentials = await toConvexCredentials(context.connection);
  const planByTable = new Map(plans.map(plan => [tableKey(plan.schemaName, plan.tableName), plan]));

  const results = new Map<string, StreamSyncResult>(plans.map(plan => [plan.streamId, {
    streamId: plan.streamId,
    rowsSynced: 0,
    // Convex resumes at the source, so a stream never carries a cursor of its
    // own. Writing one would leave a resume point that means nothing.
    syncCursor: null,
    error: null,
  }]));

  // A stream configured but never synced is rebuilt before anything is read, the
  // same as on the Postgres path. A table missing from the catalog is reported
  // per stream rather than failing the run: one deleted table should not stop
  // the rest of the deployment syncing.
  const runnablePlans: StreamSyncPlan[] = [];
  for (const plan of plans) {
    const table = context.tablesByName.get(tableKey(plan.schemaName, plan.tableName));
    if (table == null) {
      results.set(plan.streamId, {
        streamId: plan.streamId,
        rowsSynced: 0,
        syncCursor: null,
        error: "The table no longer exists in this Convex deployment.",
      });
      continue;
    }
    await prepareDestination(context, plan, table);
    runnablePlans.push(plan);
  }
  if (runnablePlans.length === 0) {
    return { streams: [...results.values()] };
  }

  // A stream that has never synced needs the deployment's existing documents,
  // and Convex's feed has no way to snapshot one table on its own — a stored
  // cursor only ever yields changes from that point on. So adding a table to an
  // established source rewinds the whole feed: every table is re-read and
  // rebuilt from the truncates that a fresh snapshot emits. Duplicates for the
  // tables that were already current fold away on their `_id`, and the
  // alternative is a new table that silently never receives its history.
  const startFromScratch = runnablePlans.some(plan => plan.isPending);
  let cursor = startFromScratch ? null : readSourceCursor(context.sourceCursor);
  const buffer = new DestinationBuffer(context);

  for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
    const body = page === 0 ? await fetchFirstPage(credentials, cursor) : await fetchPage(credentials, cursor);

    for (const truncate of body.truncates) {
      const plan = planByTable.get(tableKey(componentToSchemaName(truncate.component), truncate.table));
      if (plan == null) continue;
      const table = context.tablesByName.get(tableKey(plan.schemaName, plan.tableName));
      if (table == null) continue;
      await applyTruncate(context, plan, table, buffer);
    }

    for (const change of body.values) {
      const plan = planByTable.get(tableKey(componentToSchemaName(change.component), change.table));
      if (plan == null) continue;
      const table = context.tablesByName.get(tableKey(plan.schemaName, plan.tableName));
      if (table == null) continue;

      // The nanosecond mutation timestamp is the version. It is already
      // monotonic per document and comparable across the deployment, so unlike
      // the Postgres paths there is nothing to derive or offset.
      await buffer.add(plan.destinationTable, buildDestinationRow({
        // A deletion carries only `_id`; the remaining columns are simply absent,
        // and buildDestinationRow leaves them out rather than nulling them.
        values: toDestinationValues(change.value),
        columns: table.columns,
        version: toBigInt(change.ts, "document timestamp"),
        deleted: change.deleted,
        extractedAt: context.startedAt,
      }));
      const existing = results.get(plan.streamId)!;
      results.set(plan.streamId, { ...existing, rowsSynced: existing.rowsSynced + 1 });
    }

    // Advanced only after the rows from this page are in hand. The write below
    // still has to succeed before it is persisted, which is what keeps the whole
    // path at-least-once rather than at-most-once.
    cursor = body.pagination.nextCursor;

    // `upToDate` means the pages so far are consistent as of the deployment's
    // snapshot timestamp — not that every write made a moment ago is included.
    // Convex takes a few seconds to make a fresh commit visible to the feed, so
    // a sync that runs immediately after one can legitimately return nothing and
    // pick it up on the next run. That is a property of the source, and the
    // stored cursor is what makes it harmless.
    if (body.status.type === "upToDate") break;
  }

  // Every row for this run, written before the cursor that covers them is saved
  // by the caller. A failure here throws, the cursor is not persisted, and the
  // next run re-reads the same pages — duplicates that ReplacingMergeTree folds
  // away, rather than a gap it could never recover.
  await buffer.flush();

  // `needsResnapshot` is deliberately never set. It asks the caller to rebuild on
  // the *next* run, which is the right answer for Postgres, where a TRUNCATE in
  // the WAL cannot be acted on mid-stream. Convex hands us the truncate before
  // the rows that follow it, so the rebuild has already happened above — asking
  // for another one would discard everything this run just loaded.
  return {
    streams: [...results.values()],
    sourceCursor: cursor == null ? null : { mode: "convex", value: cursor } satisfies ConvexSourceCursor,
  };
}
