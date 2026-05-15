/**
 * Test-only SQL loaders for bulldozer migration artifacts.
 *
 * Lives next to the bulldozer db code because several test files (both in
 * `apps/backend/src/lib/bulldozer` and in `apps/backend/src/lib/payments`)
 * need to install the `public.bulldozer_timefold_process_queue()` function
 * body from its migration file to exercise the queue-drain path. Keeping
 * one canonical loader here avoids drift between copies when the
 * migration's comment sentinels or function name change.
 *
 * Not intended for production code paths — only imported from `*.test.ts`
 * files and the payments test-helpers (which is itself only used from
 * tests).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// apps/backend/src/lib/bulldozer/db/ → apps/backend/prisma/migrations
const MIGRATIONS_DIR = join(HERE, "..", "..", "..", "..", "prisma", "migrations");

const DOWNSTREAM_CASCADE_MIGRATION = "20260417000000_bulldozer_timefold_downstream_cascade";

/**
 * Extracts the `CREATE OR REPLACE FUNCTION public.bulldozer_timefold_process_queue`
 * block from the downstream-cascade migration file. The function body is
 * what `pg_cron` invokes in prod; installing it into a test database lets
 * tests exercise the real drain behaviour end-to-end.
 *
 * The migration file is split into statements via the
 * `-- SPLIT_STATEMENT_SENTINEL` markers already used by the bulldozer
 * migration tooling; this loader just picks the block that starts with
 * the function definition.
 */
export function loadProcessQueueFunctionSql(): string {
  const migrationPath = join(MIGRATIONS_DIR, DOWNSTREAM_CASCADE_MIGRATION, "migration.sql");
  const raw = readFileSync(migrationPath, "utf8");
  const block = raw
    .split("-- SPLIT_STATEMENT_SENTINEL")
    .map((chunk) => chunk.replaceAll("-- SINGLE_STATEMENT_SENTINEL", "").trim())
    .find((chunk) => chunk.startsWith("CREATE OR REPLACE FUNCTION public.bulldozer_timefold_process_queue"));
  if (block == null) {
    throw new Error(
      `Could not locate bulldozer_timefold_process_queue function body in ${DOWNSTREAM_CASCADE_MIGRATION}/migration.sql`,
    );
  }
  return block.replace(/;$/, "");
}
