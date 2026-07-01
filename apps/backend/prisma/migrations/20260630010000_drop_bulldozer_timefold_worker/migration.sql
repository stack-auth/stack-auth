-- Retire the SQL bulldozer timefold worker.
--
-- The live payments path now runs on bulldozer-js (an in-process 1-second tick
-- loop drives timefolds), so the Postgres pg_cron job and its worker function
-- are dead code. We unschedule the cron job and drop the function in a single
-- transaction so there is never a window where the scheduled job exists but the
-- function it calls does not.
--
-- We only swallow the two benign "pg_cron isn't really here" cases: the cron
-- extension being absent entirely, and the cron.job table being missing. We do
-- NOT swallow unschedule failures such as insufficient_privilege — if pg_cron is
-- present and we cannot prove the job is gone, we must abort (rolling back the
-- DROP FUNCTION below) rather than leave a scheduled job calling a function we
-- just deleted, which would error every second. A human must then resolve the
-- privilege issue and re-run. The backing tables are dropped in the following
-- migration, after this commit guarantees nothing calls the function anymore.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM cron.unschedule("jobid")
    FROM cron.job
    WHERE "jobname" = 'bulldozer-timefold-worker';
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;
END
$$;
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DROP FUNCTION IF EXISTS public.bulldozer_timefold_process_queue();
