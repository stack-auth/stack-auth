/**
 * Which sync modes a given source table can use, and which one we recommend.
 *
 * This lives in shared rather than the backend because the dashboard renders the
 * same verdicts while the customer is choosing modes, and the two must never
 * disagree — an option the dashboard offers but the backend rejects is the worst
 * possible outcome of this screen.
 *
 * Everything here is generic across source types. The rules that decide what a
 * *particular* kind of server can do live next door in `postgres.ts` and
 * `convex.ts`, and are reached only through the dispatch at the bottom of this
 * file. Adding a source type should not require editing anything above it.
 */

import { getConvexModeAvailability } from "./convex";
import { getPostgresModeAvailability } from "./postgres";
import type { DataSourceCapabilities, DataSourceSyncMode, DataSourceTableInfo, ModeAvailability } from "./types";

export * from "./types";

export const DATA_SOURCE_SYNC_MODES = ["cdc", "cursor"] as const satisfies readonly DataSourceSyncMode[];

/**
 * Cursor columns that carry a wall-clock time. These are the ones that behave the
 * way people expect: an application that touches the row bumps the timestamp, so
 * updates are picked up as well as inserts.
 *
 * A monotonic id is still a legal cursor and is often the right one for an
 * append-only log, but it only ever moves when a row is inserted — so edits to
 * existing rows are invisible. The picker warns about that rather than refusing
 * it, because the customer knows their write patterns and we do not.
 */
const TEMPORAL_CURSOR_TYPE = /^(timestamp( with(out)? time zone)?|date)$/i;

export function isTemporalCursorType(dataType: string): boolean {
  return TEMPORAL_CURSOR_TYPE.test(dataType.trim().replace(/\(\d+(,\s*\d+)?\)/, ""));
}

/**
 * Dispatches to the rules for whatever kind of server this is. A source type
 * that offered a mode here which its driver cannot actually run would put the
 * customer in front of a choice that fails at the first sync, so the two are
 * deliberately written to be read side by side.
 */
export function getModeAvailability(
  table: DataSourceTableInfo,
  capabilities: DataSourceCapabilities,
): Record<DataSourceSyncMode, ModeAvailability> {
  switch (capabilities.type) {
    case "postgres": {
      return getPostgresModeAvailability(table, capabilities);
    }
    case "convex": {
      return getConvexModeAvailability();
    }
  }
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
  // CDC first wherever it is possible: it is cheaper in steady state than reading
  // rows back, and it is the only mode that sees deletes.
  if (availability.cdc.available) return "cdc";
  if (availability.cursor.available) return "cursor";
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
