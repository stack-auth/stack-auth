/**
 * What a Convex deployment can do.
 *
 * Almost nothing to decide, and that is the point: Convex exposes one change
 * feed covering the whole deployment, every document carries a nanosecond
 * mutation timestamp and a deletion flag, and `_id` is always the key. So there
 * is exactly one way to sync a Convex table, and the picker has no mode question
 * to put to the customer at all.
 *
 * Cursor mode is reported unavailable rather than quietly omitted, so the table
 * picker can say why the dropdown it renders for Postgres is absent here.
 */

import type { DataSourceSyncMode, ModeAvailability } from "./types";

export function getConvexModeAvailability(): Record<DataSourceSyncMode, ModeAvailability> {
  return {
    cdc: { available: true, reason: null },
    cursor: { available: false, reason: "Convex syncs from its change log" },
  };
}
