-- CreateTable
CREATE TABLE "BulldozerTimeFoldQueue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tableStoragePath" JSONB[] NOT NULL,
    "groupKey" JSONB NOT NULL,
    "rowIdentifier" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ NOT NULL,
    "stateAfter" JSONB NOT NULL,
    "rowData" JSONB NOT NULL,
    "reducerSql" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulldozerTimeFoldQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulldozerTimeFoldMetadata" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastProcessedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "BulldozerTimeFoldMetadata_pkey" PRIMARY KEY ("key")
);

-- Seed singleton metadata row.
INSERT INTO "BulldozerTimeFoldMetadata" ("key", "lastProcessedAt")
VALUES ('singleton', now())
ON CONFLICT ("key") DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "BulldozerTimeFoldQueue_table_group_row_key"
  ON "BulldozerTimeFoldQueue"("tableStoragePath", "groupKey", "rowIdentifier");

-- CreateIndex
CREATE INDEX "BulldozerTimeFoldQueue_scheduledAt_idx"
  ON "BulldozerTimeFoldQueue"("scheduledAt");

-- Worker function used by pg_cron and callable manually in tests.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION public.bulldozer_timefold_process_queue()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  cutoff_timestamp timestamptz;
  queued_row "BulldozerTimeFoldQueue"%ROWTYPE;
  group_path jsonb[];
  rows_path jsonb[];
  states_path jsonb[];
  state_row_path jsonb[];
  existing_state jsonb;
  old_emitted_rows jsonb;
  newly_emitted_rows jsonb;
  accumulated_emitted_rows jsonb;
  current_state jsonb;
  current_timestamp_value timestamptz;
  next_state jsonb;
  next_rows_data jsonb;
  normalized_next_rows_data jsonb;
  next_timestamp timestamptz;
  previous_emitted_row_count int;
  reducer_iterations int;
  new_row_record record;
BEGIN
  PERFORM pg_advisory_xact_lock(7857391);

  INSERT INTO "BulldozerTimeFoldMetadata" ("key", "lastProcessedAt")
  VALUES ('singleton', now())
  ON CONFLICT ("key") DO NOTHING;

  cutoff_timestamp := now();

  UPDATE "BulldozerTimeFoldMetadata"
  SET
    "lastProcessedAt" = cutoff_timestamp,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'singleton';

  LOOP
    SELECT *
    INTO queued_row
    FROM "BulldozerTimeFoldQueue"
    WHERE "scheduledAt" <= cutoff_timestamp
    ORDER BY "scheduledAt" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    EXIT WHEN NOT FOUND;

    DELETE FROM "BulldozerTimeFoldQueue"
    WHERE "id" = queued_row."id";

    group_path := queued_row."tableStoragePath" || ARRAY[to_jsonb('groups'::text), queued_row."groupKey"]::jsonb[];
    rows_path := group_path || ARRAY[to_jsonb('rows'::text)]::jsonb[];
    states_path := group_path || ARRAY[to_jsonb('states'::text)]::jsonb[];
    state_row_path := states_path || ARRAY[to_jsonb(queued_row."rowIdentifier")]::jsonb[];

    SELECT "value"
    INTO existing_state
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = state_row_path;

    IF existing_state IS NULL THEN
      CONTINUE;
    END IF;

    IF existing_state->'rowData' IS DISTINCT FROM queued_row."rowData" THEN
      CONTINUE;
    END IF;

    old_emitted_rows := CASE
      WHEN jsonb_typeof(existing_state->'emittedRowsData') = 'array' THEN existing_state->'emittedRowsData'
      ELSE '[]'::jsonb
    END;
    newly_emitted_rows := '[]'::jsonb;
    accumulated_emitted_rows := old_emitted_rows;
    previous_emitted_row_count := jsonb_array_length(old_emitted_rows);

    current_state := queued_row."stateAfter";
    current_timestamp_value := queued_row."scheduledAt";
    reducer_iterations := 0;

    LOOP
      reducer_iterations := reducer_iterations + 1;
      IF reducer_iterations > 10000 THEN
        RAISE EXCEPTION 'bulldozer timefold reducer exceeded 10k iterations for row %', queued_row."rowIdentifier";
      END IF;

      EXECUTE format(
        $reducer$
          SELECT
            to_jsonb("reducerRows"."newState") AS "newState",
            to_jsonb("reducerRows"."newRowsData") AS "newRowsData",
            CASE
              WHEN "reducerRows"."nextTimestamp" IS NULL THEN NULL::timestamptz
              ELSE ("reducerRows"."nextTimestamp")::timestamptz
            END AS "nextTimestamp"
          FROM (
            SELECT %s
            FROM (
              SELECT
                $1::jsonb AS "oldState",
                $2::jsonb AS "oldRowData",
                $3::timestamptz AS "timestamp"
            ) AS "reducerInput"
          ) AS "reducerRows"
        $reducer$,
        queued_row."reducerSql"
      )
      INTO next_state, next_rows_data, next_timestamp
      USING current_state, queued_row."rowData", current_timestamp_value;

      normalized_next_rows_data := CASE
        WHEN jsonb_typeof(next_rows_data) = 'array' THEN next_rows_data
        ELSE '[]'::jsonb
      END;
      newly_emitted_rows := newly_emitted_rows || normalized_next_rows_data;
      accumulated_emitted_rows := accumulated_emitted_rows || normalized_next_rows_data;
      current_state := next_state;

      EXIT WHEN next_timestamp IS NULL OR next_timestamp > cutoff_timestamp;
      current_timestamp_value := next_timestamp;
    END LOOP;

    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES
      (gen_random_uuid(), group_path, 'null'::jsonb),
      (gen_random_uuid(), rows_path, 'null'::jsonb),
      (gen_random_uuid(), states_path, 'null'::jsonb)
    ON CONFLICT ("keyPath") DO NOTHING;

    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      state_row_path,
      jsonb_build_object(
        'rowData', queued_row."rowData",
        'stateAfter', current_state,
        'emittedRowsData', accumulated_emitted_rows,
        'nextTimestamp',
        CASE
          WHEN next_timestamp IS NULL THEN 'null'::jsonb
          ELSE to_jsonb(next_timestamp)
        END
      )
    )
    ON CONFLICT ("keyPath") DO UPDATE
    SET "value" = EXCLUDED."value";

    FOR new_row_record IN
      SELECT
        "rows"."rowData" AS "rowData",
        "rows"."rowIndex" AS "rowIndex"
      FROM jsonb_array_elements(newly_emitted_rows) WITH ORDINALITY AS "rows"("rowData", "rowIndex")
    LOOP
      INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
      VALUES (
        gen_random_uuid(),
        rows_path || ARRAY[to_jsonb((queued_row."rowIdentifier" || ':' || (previous_emitted_row_count + new_row_record."rowIndex")::text)::text)]::jsonb[],
        jsonb_build_object('rowData', new_row_record."rowData")
      )
      ON CONFLICT ("keyPath") DO UPDATE
      SET "value" = EXCLUDED."value";
    END LOOP;

    IF next_timestamp IS NOT NULL AND next_timestamp > cutoff_timestamp THEN
      INSERT INTO "BulldozerTimeFoldQueue" (
        "id",
        "tableStoragePath",
        "groupKey",
        "rowIdentifier",
        "scheduledAt",
        "stateAfter",
        "rowData",
        "reducerSql"
      )
      VALUES (
        gen_random_uuid(),
        queued_row."tableStoragePath",
        queued_row."groupKey",
        queued_row."rowIdentifier",
        next_timestamp,
        current_state,
        queued_row."rowData",
        queued_row."reducerSql"
      )
      ON CONFLICT ("tableStoragePath", "groupKey", "rowIdentifier") DO UPDATE
      SET
        "scheduledAt" = EXCLUDED."scheduledAt",
        "stateAfter" = EXCLUDED."stateAfter",
        "rowData" = EXCLUDED."rowData",
        "reducerSql" = EXCLUDED."reducerSql",
        "updatedAt" = CURRENT_TIMESTAMP;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM "BulldozerStorageEngine"
      WHERE "keyPathParent" = rows_path
    )
      AND NOT EXISTS (
        SELECT 1
        FROM "BulldozerStorageEngine"
        WHERE "keyPathParent" = states_path
      )
    THEN
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (rows_path, states_path, group_path);
    END IF;
  END LOOP;
END;
$function$;
-- SPLIT_STATEMENT_SENTINEL

-- Best-effort pg_cron setup. If pg_cron is unavailable, the queue can still be
-- processed via explicit calls to public.bulldozer_timefold_process_queue().
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN insufficient_privilege OR undefined_file OR feature_not_supported OR object_not_in_prerequisite_state OR raise_exception THEN
    RAISE NOTICE 'Skipping pg_cron extension setup for bulldozer timefold worker.';
END
$$;
-- SPLIT_STATEMENT_SENTINEL

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

  PERFORM cron.schedule(
    'bulldozer-timefold-worker',
    '1 second',
    'SELECT public.bulldozer_timefold_process_queue();'
  );
EXCEPTION
  WHEN insufficient_privilege OR undefined_function OR feature_not_supported THEN
    RAISE NOTICE 'Skipping pg_cron schedule setup for bulldozer timefold worker.';
END
$$;
-- SPLIT_STATEMENT_SENTINEL
