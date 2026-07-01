import type { Sql } from "postgres";
import { expect } from "vitest";

const functionExists = async (sql: Sql): Promise<boolean> => {
  const rows = await sql`
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'bulldozer_timefold_process_queue'
  `;
  return rows.length > 0;
};

const cronPresent = async (sql: Sql): Promise<boolean> => {
  const rows = await sql`SELECT to_regnamespace('cron') IS NOT NULL AS present`;
  return Boolean(rows[0].present);
};

export const preMigration = async (sql: Sql) => {
  // Sanity: the worker function must exist before this migration runs, otherwise
  // the test isn't actually exercising the drop.
  expect(await functionExists(sql)).toBe(true);
};

export const postMigration = async (sql: Sql) => {
  // The worker function is gone.
  expect(await functionExists(sql)).toBe(false);

  // If pg_cron is installed (it is in dev/CI Postgres), the worker job is gone
  // too. Guarded so the test still passes on a Postgres without pg_cron,
  // mirroring the best-effort guard in the migration itself.
  if (await cronPresent(sql)) {
    const jobs = await sql`
      SELECT 1 FROM cron.job WHERE "jobname" = 'bulldozer-timefold-worker'
    `;
    expect(jobs).toHaveLength(0);
  }

  // Idempotency: re-running the teardown statements must be a no-op (the
  // migration uses DROP ... IF EXISTS and a guarded unschedule), not an error.
  await sql`DROP FUNCTION IF EXISTS public.bulldozer_timefold_process_queue()`;
  if (await cronPresent(sql)) {
    await sql`SELECT cron.unschedule("jobid") FROM cron.job WHERE "jobname" = 'bulldozer-timefold-worker'`;
  }
  expect(await functionExists(sql)).toBe(false);
};
