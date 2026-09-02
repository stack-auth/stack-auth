import type { ClickHouseClient } from "@clickhouse/client";
import type { DataSourceCapabilities, DataSourceTableInfo, DataSourceType } from "@hexclave/shared/dist/data-sources/modes";

/**
 * One destination column, as the source described it.
 *
 * `clickhouseType` is resolved by the driver rather than by the destination
 * writer. Postgres and Convex describe types in vocabularies that have nothing
 * in common — `timestamp(3) without time zone` versus a JSON Schema node — and a
 * single mapping function trying to serve both would have to guess which it was
 * looking at. Each driver knows, so each driver decides, and everything
 * downstream of here handles ClickHouse types only.
 */
export type DataSourceColumn = {
  name: string,
  /** The source's own name for the type. Shown to the customer; never parsed outside its driver. */
  dataType: string,
  nullable: boolean,
  clickhouseType: string,
};

export type ProbedTable = DataSourceTableInfo & {
  columns: DataSourceColumn[],
};

export type DataSourceProbeResult = {
  capabilities: DataSourceCapabilities,
  tables: ProbedTable[],
};

/**
 * A source's connection settings, split into the part that can be shown back to
 * the customer and the one secret that cannot. Both are opaque outside the
 * driver that wrote them.
 */
export type DataSourceConnection = {
  type: DataSourceType,
  config: Record<string, unknown>,
  secret: string,
};

export type SyncCursorState = {
  mode: string,
  value: string,
  /** JSON-encoded primary key of the last row read, for total-order resumption. */
  key?: string,
};

export type StreamSyncPlan = {
  streamId: string,
  schemaName: string,
  tableName: string,
  mode: "cursor" | "cdc",
  cursorColumn: string | null,
  primaryKeyColumns: string[],
  destinationTable: string,
  syncCursor: SyncCursorState | null,
  /**
   * True until the stream has synced once in its current configuration. A mode or
   * cursor change resets it, because the destination's existing rows were versioned
   * on a scale the new mode cannot beat — cursor versions are epoch microseconds,
   * CDC versions are LSNs, and no real LSN ever reaches 1.7e15 — so carrying them
   * over would freeze the table forever.
   */
  isPending: boolean,
};

export type StreamSyncResult = {
  streamId: string,
  rowsSynced: number,
  syncCursor: SyncCursorState | null,
  error: string | null,
  /** The source truncated this table; only a fresh snapshot can represent that. */
  needsResnapshot?: boolean,
};

/**
 * What a driver is handed to run one sync.
 *
 * Deliberately free of anything source-specific: the connection is opaque, and
 * server-side objects a driver created live in `managedResources`, which only
 * that driver reads.
 */
export type SyncContext = {
  connection: DataSourceConnection,
  clickhouse: ClickHouseClient,
  databaseName: string,
  /** Fresh catalog, keyed `schema.table`, so column lists match what we are about to read. */
  tablesByName: Map<string, ProbedTable>,
  /** Deployment-level resume point for drivers whose change feed is not per-table. */
  sourceCursor: unknown,
  /** Whatever this driver recorded last time it created something on the source. */
  managedResources: unknown,
  startedAt: Date,
  /** Stable per-source identity, for naming anything the driver must create. */
  dataSourceId: string,
};

export type SyncOutcome = {
  streams: StreamSyncResult[],
  /**
   * Present only for drivers that resume at the deployment level. `undefined`
   * leaves the stored cursor untouched, which is what a per-stream driver wants.
   */
  sourceCursor?: unknown,
  managedResources?: unknown,
};

/**
 * Everything a source type must supply. The orchestration around it — leasing,
 * scheduling, entitlement, destination isolation, per-stream error reporting —
 * is shared, and no driver should reimplement any of it.
 */
export type DataSourceDriver = {
  type: DataSourceType,

  /** Reads capabilities and catalog. Runs at connect time and before every sync. */
  probe(connection: DataSourceConnection): Promise<DataSourceProbeResult>,

  /** Runs every configured stream. One stream failing must not stop the others. */
  runStreamSyncs(context: SyncContext, plans: StreamSyncPlan[]): Promise<SyncOutcome>,

  /**
   * Releases anything this driver created on the customer's system. Called when
   * a source is deleted and when a configuration change stops needing it, so it
   * must be idempotent. A driver that creates nothing omits it.
   */
  teardown?(context: {
    connection: DataSourceConnection,
    dataSourceId: string,
    managedResources: unknown,
  }): Promise<void>,

  /**
   * Whether a configuration change means `teardown` should run now — a Postgres
   * source that no longer syncs any CDC stream is still holding a replication
   * slot that retains WAL. Absent means never.
   */
  shouldTeardownOnReconfigure?(options: {
    previousModes: readonly ("cursor" | "cdc")[],
    nextModes: readonly ("cursor" | "cdc")[],
  }): boolean,
};
