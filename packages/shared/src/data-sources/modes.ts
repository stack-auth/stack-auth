/**
 * Which sync modes a given source table can use, and which one we recommend.
 *
 * This lives in shared rather than the backend because the dashboard renders the
 * same verdicts while the customer is choosing modes, and the two must never
 * disagree — an option the dashboard offers but the backend rejects is the worst
 * possible outcome of this screen.
 */

export type DataSourceSyncMode = "full_refresh" | "cursor" | "cdc";

export const DATA_SOURCE_SYNC_MODES = ["cdc", "cursor", "full_refresh"] as const satisfies readonly DataSourceSyncMode[];

/**
 * Above this a full reload on every sync puts sustained load on the customer's
 * database, so we refuse the mode rather than let them find out in production.
 */
export const FULL_REFRESH_MAX_ROWS = 2_000_000;

/** Below this, reloading the whole table is cheaper than tracking changes, and it can never drift. */
export const SMALL_TABLE_ROWS = 100_000;

/** What the capability probe learned about the source server. */
export type DataSourceCapabilities = {
  version: string,
  /** `logical` is the only value that permits logical decoding. */
  walLevel: string,
  /** Whether the role we were given has REPLICATION (or is a superuser). */
  hasReplication: boolean,
  /** Slots cannot be created on a hot standby, whatever wal_level says. */
  inRecovery: boolean,
  slotsUsed: number,
  slotsMax: number,
  probedAtMillis: number,
};

export type DataSourceCursorCandidate = {
  column: string,
  dataType: string,
  /** An unindexed cursor still works, but every sync sequentially scans the table. */
  indexed: boolean,
};

export type DataSourceTableInfo = {
  schemaName: string,
  tableName: string,
  /** Null when the source has never been analyzed, which is not the same as empty. */
  approxRows: number | null,
  primaryKeyColumns: string[],
  cursorCandidates: DataSourceCursorCandidate[],
  /** `pg_class.relreplident`: 'd' default, 'n' nothing, 'f' full, 'i' using index. */
  replicaIdentity: string,
  /** Unlogged tables cannot be added to a publication at all. */
  isLogged: boolean,
  isPartitioned: boolean,
};

export type ModeAvailability = {
  available: boolean,
  /** Short, user-facing, and specific enough to act on. Null when available. */
  reason: string | null,
};

export function getCdcAvailability(
  capabilities: DataSourceCapabilities,
  table?: Pick<DataSourceTableInfo, "primaryKeyColumns" | "replicaIdentity" | "isLogged" | "isPartitioned">,
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
  if (capabilities.slotsUsed >= capabilities.slotsMax) {
    return { available: false, reason: "no replication slots free" };
  }
  if (table != null) {
    // Without a key, an UPDATE or DELETE in the WAL carries nothing we can match
    // a destination row on, so CDC would be no better than an append-only log.
    if (table.primaryKeyColumns.length === 0) {
      return { available: false, reason: "needs a primary key" };
    }
    // Adding a REPLICA IDENTITY NOTHING table to a publication makes the
    // customer's own UPDATEs and DELETEs start failing. Never worth it.
    if (table.replicaIdentity === "n") {
      return { available: false, reason: "needs a replica identity" };
    }
    // Postgres refuses to add these to a publication, and one of them would fail
    // the whole publication statement, taking every other CDC stream with it.
    if (!table.isLogged) {
      return { available: false, reason: "table is unlogged" };
    }
    // Changes are published under the leaf partition, not the parent we would be
    // subscribed to, so every change would be silently dropped.
    if (table.isPartitioned) {
      return { available: false, reason: "table is partitioned" };
    }
  }
  return { available: true, reason: null };
}

export function getModeAvailability(
  table: DataSourceTableInfo,
  capabilities: DataSourceCapabilities,
): Record<DataSourceSyncMode, ModeAvailability> {
  return {
    cdc: getCdcAvailability(capabilities, table),
    cursor: table.cursorCandidates.length > 0
      ? { available: true, reason: null }
      : { available: false, reason: "no usable column" },
    // An unknown row count cannot prove the table is small, but refusing on that
    // basis would block every freshly restored source. It is allowed, just never
    // recommended — see getRecommendedMode.
    full_refresh: table.approxRows != null && table.approxRows > FULL_REFRESH_MAX_ROWS
      ? { available: false, reason: "table too large" }
      : { available: true, reason: null },
  };
}

/**
 * Null when no mode applies — the table cannot be synced as it stands, and the
 * dashboard says so rather than silently omitting it.
 */
export function getRecommendedMode(
  table: DataSourceTableInfo,
  capabilities: DataSourceCapabilities,
): DataSourceSyncMode | null {
  const availability = getModeAvailability(table, capabilities);
  // Small tables reload wholesale: cheaper than change tracking, and self-healing.
  // Requires a known count: "unknown" must not be treated as "small".
  if (table.approxRows != null && table.approxRows <= SMALL_TABLE_ROWS && availability.full_refresh.available) {
    return "full_refresh";
  }
  if (availability.cdc.available) return "cdc";
  if (availability.cursor.available) return "cursor";
  // Only fall back to a full reload when we know the table is small enough to
  // stand it; an unknown count reaching here means we genuinely cannot say.
  if (availability.full_refresh.available && table.approxRows != null) return "full_refresh";
  return null;
}

/**
 * The cursor column we preselect. Indexed candidates first — an unindexed cursor
 * makes every sync a sequential scan — then the conventional names, so the common
 * case needs no thought from the customer.
 */
export function getDefaultCursorColumn(table: DataSourceTableInfo): string | null {
  const preferredNames = ["updated_at", "updatedat", "modified_at", "last_modified", "created_at", "createdat"];
  const ranked = [...table.cursorCandidates].sort((a, b) => {
    if (a.indexed !== b.indexed) return a.indexed ? -1 : 1;
    const aRank = preferredNames.indexOf(a.column.toLowerCase());
    const bRank = preferredNames.indexOf(b.column.toLowerCase());
    return (aRank === -1 ? preferredNames.length : aRank) - (bRank === -1 ? preferredNames.length : bRank);
  });
  return ranked[0]?.column ?? null;
}
