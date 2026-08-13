import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";
import { Client } from "pg";
import { isE2eDiagnosticsEnabled, recordConvergenceWait } from "../../diagnostics";

// The backend's Prisma client routes read queries to a read replica (in dev/CI, db-replica applies WAL with an
// artificial delay). Read-after-write consistency comes from a Prisma extension that, after every write it performs,
// waits until the replicas have replayed the primary's WAL. Tests that seed rows with raw SQL bypass that extension,
// so the replica may still be behind when the test calls the API next and the endpoint then reads a tenancy that
// looks empty. Call this after raw-SQL writes whose effect the test expects a subsequent API request to observe.
//
// pg_stat_replication lives on the primary and only has a row per currently streaming standby, so a deployment
// without replicas (where reads go to the primary anyway) returns immediately.
export async function waitUntilReplicasHaveCaughtUp(primaryClient: Client, timeoutMs: number = 60_000): Promise<void> {
  const target = (await primaryClient.query<{ lsn: string }>(`SELECT pg_current_wal_lsn()::text AS lsn`)).rows[0]?.lsn
    ?? throwErr("pg_current_wal_lsn() returned no row; is this connection pointing at a PostgreSQL primary?");

  const deadline = performance.now() + timeoutMs;
  const startedAt = performance.now();
  let polls = 0;
  let sleepDurationMs = 0;
  while (true) {
    polls++;
    const behind = (await primaryClient.query<{ behind: number }>(
      `SELECT count(*)::int AS behind FROM pg_stat_replication WHERE "replay_lsn" IS NULL OR "replay_lsn" < $1::pg_lsn`,
      [target],
    )).rows[0]?.behind ?? throwErr("Counting lagging replicas returned no row");
    if (behind === 0) {
      if (isE2eDiagnosticsEnabled()) {
        recordConvergenceWait({
          name: "test-replication-catch-up",
          durationMs: performance.now() - startedAt,
          polls,
          completed: true,
          sleepDurationMs,
        });
      }
      return;
    }
    if (performance.now() > deadline) {
      if (isE2eDiagnosticsEnabled()) {
        recordConvergenceWait({
          name: "test-replication-catch-up",
          durationMs: performance.now() - startedAt,
          polls,
          completed: false,
          sleepDurationMs,
        });
      }
      throw new Error(`${behind} replica(s) did not replay up to ${target} within ${timeoutMs}ms`);
    }
    await wait(20);
    sleepDurationMs += 20;
  }
}
