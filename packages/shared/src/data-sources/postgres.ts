/**
 * What a PostgreSQL server can do, and why not when it cannot.
 *
 * Reached only through `getModeAvailability` in `modes.ts`; nothing generic
 * should import from here.
 */

import type {
  DataSourceSyncMode,
  DataSourceTableInfo,
  ModeAvailability,
  PostgresCapabilities,
  PostgresTableInfo,
} from "./types";

export function getCdcAvailability(
  capabilities: PostgresCapabilities,
  table?: Pick<DataSourceTableInfo, "primaryKeyColumns"> & { postgres?: PostgresTableInfo },
): ModeAvailability {
  if (capabilities.walLevel !== "logical") {
    return { available: false, reason: "needs wal_level=logical" };
  }
  if (!capabilities.hasReplication) {
    return { available: false, reason: "needs REPLICATION grant" };
  }
  if (capabilities.inRecovery) {
    return { available: false, reason: "not on a read replica" };
  }
  if (capabilities.slotsMax != null && capabilities.slotsUsed >= capabilities.slotsMax) {
    return { available: false, reason: "no replication slots free" };
  }
  if (table != null) {
    // Without a key, an UPDATE or DELETE in the WAL carries nothing we can match
    // a destination row on, so CDC would be no better than an append-only log.
    if (table.primaryKeyColumns.length === 0) {
      return { available: false, reason: "needs a primary key" };
    }
    const postgres = table.postgres;
    // Fail closed. These checks exist because adding the wrong table to a
    // publication breaks the customer's own UPDATEs; reporting CDC available
    // because we could not see the facts would be the worst of both.
    if (postgres == null) {
      return { available: false, reason: "table details unavailable" };
    }
    // Adding a REPLICA IDENTITY NOTHING table to a publication makes the
    // customer's own UPDATEs and DELETEs start failing. Never worth it.
    if (postgres.replicaIdentity === "n") {
      return { available: false, reason: "needs a replica identity" };
    }
    // Postgres refuses to add these to a publication, and one of them would fail
    // the whole publication statement, taking every other CDC stream with it.
    if (!postgres.isLogged) {
      return { available: false, reason: "table is unlogged" };
    }
    // Changes are published under the leaf partition, not the parent we would be
    // subscribed to, so every change would be silently dropped.
    if (postgres.isPartitioned) {
      return { available: false, reason: "table is partitioned" };
    }
  }
  return { available: true, reason: null };
}

export function getPostgresModeAvailability(
  table: DataSourceTableInfo,
  capabilities: PostgresCapabilities,
): Record<DataSourceSyncMode, ModeAvailability> {
  return {
    cdc: getCdcAvailability(capabilities, table),
    cursor: table.cursorCandidates.length > 0
      ? { available: true, reason: null }
      : { available: false, reason: "no usable column" },
  };
}
