import { captureError } from "@hexclave/shared/dist/utils/errors";
import { type ClickHouseClient } from "./clickhouse";

/**
 * Expand-phase dual-writes for the legacy telemetry cutover.
 *
 * While the physical `analytics_internal.events` table still exists (i.e. the
 * cutover has not run yet), every product-event row written to
 * `analytics_internal.telemetry` is mirrored into the legacy table with
 * `dual_written = 1`. That keeps the legacy table a complete record, which is
 * what makes this release safe:
 *
 * - `default.events` (the customer SQL surface) reads the physical legacy
 *   table until the cutover, so it must not miss rows written by this release;
 * - rolling back to the previous release keeps working, because the table the
 *   old code reads and writes never developed a gap;
 * - the cutover backfill can copy exactly the `dual_written = 0` rows (written
 *   by pre-expand instances) without timestamp heuristics or deduplication.
 *
 * After the cutover drops the physical table (and the migration phase
 * recreates the name as a read-only view), dual-writing must stop. Processes
 * that started before the cutover discover this through the insert failing
 * with UNKNOWN_TABLE / a read-only-view error and permanently disable
 * themselves — the rows are already durable in telemetry, so nothing is lost.
 */

// Process-wide because the physical table's existence is a deployment-phase
// fact, not a per-request one. `null` means "not probed yet".
let dualWriteEnabledCache: boolean | null = null;

/** Test-only: reset the process-wide phase cache between test cases. */
export function resetLegacyEventsDualWriteCacheForTesting(): void {
  dualWriteEnabledCache = null;
}

async function isLegacyEventsDualWriteEnabled(client: ClickHouseClient): Promise<boolean> {
  if (dualWriteEnabledCache !== null) return dualWriteEnabledCache;
  const resultSet = await client.query({
    query: `
      SELECT engine
      FROM system.tables
      WHERE database = 'analytics_internal' AND name = 'events'
    `,
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ engine: string }>();
  // Post-cutover the name is a View (the read-only compatibility alias), which
  // must not be written to; only a physical table enables dual-writing.
  const enabled = rows.length > 0 && rows[0].engine !== "View";
  dualWriteEnabledCache = enabled;
  return enabled;
}

/**
 * True for the two ways an insert into `analytics_internal.events` fails
 * BECAUSE the cutover retired the physical table between our cached existence
 * probe and this insert: the name is gone (UNKNOWN_TABLE, code 60) or it has
 * been recreated as the read-only compatibility view, which rejects writes
 * with NOT_IMPLEMENTED (code 48, "Method write is not supported by storage
 * View"). Every other failure is a real error and must propagate. This is
 * deliberately NOT a catch-all: the codes are the documented ClickHouse error
 * codes for exactly this lifecycle transition.
 */
function isRetiredLegacyTableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code: unknown = error.code;
  return code === "60" || code === "48" || code === 60 || code === 48;
}

/**
 * Mirrors telemetry rows into the physical legacy events table while it
 * exists. `rows` must be the exact objects written to
 * `analytics_internal.telemetry` (the legacy table was upgraded to the same
 * column set in the expand phase); the `dual_written` marker is added here.
 *
 * Failures while the table exists PROPAGATE: during the expand phase the
 * legacy table is the customer-visible read surface, so silently dropping the
 * mirror write would be user-visible data loss. Callers therefore treat this
 * like the primary write (a request-path failure surfaces as a retryable
 * error; retries may duplicate rows in the legacy table just like they did
 * before the expand release, and those duplicates are discarded at cutover).
 */
export async function dualWriteLegacyEvents(
  client: ClickHouseClient,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  if (!(await isLegacyEventsDualWriteEnabled(client))) return;
  try {
    await client.insert({
      table: "analytics_internal.events",
      values: rows.map((row) => ({ ...row, dual_written: 1 })),
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 1,
      },
    });
  } catch (error) {
    if (isRetiredLegacyTableError(error)) {
      dualWriteEnabledCache = false;
      // Informational, not an incident: this is the expected way a process
      // that outlived the cutover learns dual-writing is over.
      captureError("legacy-telemetry-dual-write-retired", error);
      return;
    }
    throw error;
  }
}
