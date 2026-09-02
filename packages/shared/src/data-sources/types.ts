/**
 * The vocabulary every data source shares.
 *
 * A source type contributes one member to `DataSourceCapabilities` and, if it
 * needs per-table facts that only it understands, one optional bag on
 * `DataSourceTableInfo`. Both are discriminated by `type`, so a consumer that
 * forgets to handle a new source fails to compile rather than rendering a
 * Postgres label over a Convex deployment.
 */

export type DataSourceType = "postgres" | "convex";

export type DataSourceSyncMode = "cursor" | "cdc";

/** What the capability probe learned about a PostgreSQL server. */
export type PostgresCapabilities = {
  type: "postgres",
  version: string,
  /** `logical` is the only value that permits logical decoding. */
  walLevel: string,
  /** Whether the role we were given has REPLICATION (or is a superuser). */
  hasReplication: boolean,
  /** Slots cannot be created on a hot standby, whatever wal_level says. */
  inRecovery: boolean,
  slotsUsed: number,
  /** Null when the provider does not allow the slot budget to be inspected. */
  slotsMax: number | null,
  probedAtMillis: number,
};

/**
 * What the capability probe learned about a Convex deployment.
 *
 * Far shorter than the Postgres list because there is nothing to configure: the
 * change feed either is available to the deploy key or it is not, and that is
 * settled at connect time by the probe succeeding at all.
 */
export type ConvexCapabilities = {
  type: "convex",
  /** The deployment we are pointed at, echoed back for the dashboard to show. */
  deploymentUrl: string,
  /**
   * Whether the deployment served the change feed. Convex Cloud gates streaming
   * export behind a Pro plan; a self-hosted backend has no such gate.
   */
  hasStreamingExport: boolean,
  probedAtMillis: number,
};

export type DataSourceCapabilities = PostgresCapabilities | ConvexCapabilities;

export type DataSourceCursorCandidate = {
  column: string,
  dataType: string,
  /** An unindexed cursor still works, but every sync sequentially scans the table. */
  indexed: boolean,
};

/**
 * Facts only a Postgres source has. Kept in their own bag rather than flattened
 * onto every table so that a Convex table is not obliged to invent a replica
 * identity it has no concept of.
 */
export type PostgresTableInfo = {
  /** `pg_class.relreplident`: 'd' default, 'n' nothing, 'f' full, 'i' using index. */
  replicaIdentity: string,
  /** Unlogged tables cannot be added to a publication at all. */
  isLogged: boolean,
  isPartitioned: boolean,
};

export type DataSourceTableInfo = {
  /**
   * The namespace the table lives in: a Postgres schema, or a Convex component
   * (the root app is reported as "app"). Part of the table's identity everywhere,
   * including the destination table name.
   */
  schemaName: string,
  tableName: string,
  /** Null when the source cannot cheaply estimate the row count. */
  approxRows: number | null,
  primaryKeyColumns: string[],
  cursorCandidates: DataSourceCursorCandidate[],
  /** Present only on a Postgres source. */
  postgres?: PostgresTableInfo,
};

export type ModeAvailability = {
  available: boolean,
  /** Short, user-facing, and specific enough to act on. Null when available. */
  reason: string | null,
};
