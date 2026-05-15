import type { Sql } from "postgres";
import { expect } from "vitest";

/**
 * Migration-level test for `20260417000000_bulldozer_timefold_downstream_cascade`.
 *
 * Exercises the shape the migration is responsible for:
 *  - `BulldozerTimeFoldDownstreamCascade` exists with the right columns,
 *  - `public.bulldozer_timefold_process_queue()` consults that registry,
 *  - when a timefold has a registered `cascadeTemplate`, process_queue
 *    populates `__bulldozer_seq` with newly-emitted rows and EXECUTEs the
 *    template (i.e. the downstream cascade actually fires on the
 *    queue-drain path — the regression this migration fixes),
 *  - re-draining with nothing due is a no-op (idempotency).
 *
 * The cascade template here is constructed by hand (not via
 * `toCascadeSqlBlock` in TypeScript) so the test stays purely at the
 * migration-SQL layer, matching the other migration tests under
 * `apps/backend/prisma/migrations/.../tests/`.
 */
export const postMigration = async (sql: Sql) => {
  // 1) Migration shape: the registry table exists with the expected columns.
  const registryColumnRows = await sql<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'BulldozerTimeFoldDownstreamCascade'
    ORDER BY ordinal_position
  `;
  expect(registryColumnRows.map((r) => r.column_name)).toEqual([
    "tableStoragePath",
    "cascadeInputName",
    "cascadeTemplate",
    "createdAt",
    "updatedAt",
  ]);

  // 2) Set up a minimal timefold-shaped storage hierarchy. Each
  //    BulldozerStorageEngine insert must have its parent keyPath already
  //    present (FK: keyPathParent → keyPath).
  const tablePathSql = `ARRAY[to_jsonb('table'::text), to_jsonb('external:cascade-migration-test'::text)]::jsonb[]`;
  const storagePathSql = `${tablePathSql} || ARRAY[to_jsonb('storage'::text)]::jsonb[]`;
  const groupsPathSql = `${storagePathSql} || ARRAY[to_jsonb('groups'::text)]::jsonb[]`;
  const groupPathSql = `${groupsPathSql} || ARRAY[to_jsonb('alpha'::text)]::jsonb[]`;
  const rowsPathSql = `${groupPathSql} || ARRAY[to_jsonb('rows'::text)]::jsonb[]`;
  const statesPathSql = `${groupPathSql} || ARRAY[to_jsonb('states'::text)]::jsonb[]`;
  const stateRowPathSql = `${statesPathSql} || ARRAY[to_jsonb('u1'::text)]::jsonb[]`;

  // Parallel downstream tree the cascade template writes into. Its root
  // (`ARRAY['cascade-out']`) is a direct child of the already-seeded
  // `ARRAY[]` root, and only the root is needed as a parent for the
  // cascade's row inserts below (rows hang directly off of it).
  const cascadeOutRootSql = `ARRAY[to_jsonb('cascade-out'::text)]::jsonb[]`;

  await sql.unsafe(`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES
      (gen_random_uuid(), ${tablePathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${storagePathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${groupsPathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${groupPathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${rowsPathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${statesPathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${cascadeOutRootSql}, 'null'::jsonb)
    ON CONFLICT ("keyPath") DO NOTHING
  `);

  await sql.unsafe(`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      ${stateRowPathSql},
      jsonb_build_object(
        'rowData', '{"value": 2}'::jsonb,
        'stateAfter', '{"counter": 1}'::jsonb,
        'emittedRowsData', '[]'::jsonb,
        'nextTimestamp', 'null'::jsonb
      )
    )
    ON CONFLICT ("keyPath") DO UPDATE
    SET "value" = EXCLUDED."value"
  `);

  // 3) Register this timefold's cascade. The template reads the rows
  //    that process_queue pushes into `__bulldozer_seq` under the input
  //    name and writes them under `ARRAY['cascade-out', <rowIdentifier>]`.
  //    EXECUTEing this DO block is exactly what process_queue does with
  //    the stored cascadeTemplate once per timefold per tick.
  const cascadeInputName = "migration_test_cascade_input";
  const cascadeTemplateSql = `
    DO $tf_cascade$
    BEGIN
      INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
      SELECT
        gen_random_uuid(),
        ARRAY[to_jsonb('cascade-out'::text), "__bulldozer_seq"."__output_row"->'rowIdentifier']::jsonb[],
        "__bulldozer_seq"."__output_row"->'newRowData'
      FROM "__bulldozer_seq"
      WHERE "__output_name" = '${cascadeInputName}'
      ON CONFLICT ("keyPath") DO UPDATE
      SET "value" = EXCLUDED."value";
    END;
    $tf_cascade$ LANGUAGE plpgsql;
  `;

  await sql.unsafe(`
    INSERT INTO "BulldozerTimeFoldDownstreamCascade"
      ("tableStoragePath", "cascadeInputName", "cascadeTemplate")
    VALUES (
      ${storagePathSql},
      '${cascadeInputName}',
      $cascade_template$${cascadeTemplateSql}$cascade_template$
    )
  `);

  // 4) Queue a reducer row that emits one output row (value=100). Reducer
  //    SQL is the same shape the real timefold table emits:
  //    newState / newRowsData / nextTimestamp.
  await sql.unsafe(`
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
      ${storagePathSql},
      to_jsonb('alpha'::text),
      'u1',
      now() - interval '1 minute',
      '{"counter": 1}'::jsonb,
      '{"value": 2}'::jsonb,
      'jsonb_build_object(''counter'', COALESCE(("oldState"->>''counter'')::int, 0) + 1) AS "newState", jsonb_build_array(jsonb_build_object(''value'', 100)) AS "newRowsData", NULL::timestamptz AS "nextTimestamp"'
    )
  `);

  // 5) Drain the queue. This is the real prod entry point — pg_cron calls
  //    exactly this function.
  await sql.unsafe(`SELECT public.bulldozer_timefold_process_queue()`);

  // The queue row must be consumed. Scope by tableStoragePath — the
  // sibling `20260323150000_add_bulldozer_timefold_queue/tests/process-queue.ts`
  // ran on this same shared DB and left a future-dated queue row behind
  // under its own tableStoragePath, which we must not match here.
  const remainingQueueRows = await sql.unsafe(`
    SELECT 1 FROM "BulldozerTimeFoldQueue"
    WHERE "tableStoragePath" = ${storagePathSql}
      AND "rowIdentifier" = 'u1'
  `);
  expect(remainingQueueRows).toHaveLength(0);

  // The timefold's own state row must be updated (baseline the prior
  // migration already covered).
  const stateRows = await sql.unsafe(`
    SELECT "value" FROM "BulldozerStorageEngine" WHERE "keyPath" = ${stateRowPathSql}
  `);
  expect(stateRows).toHaveLength(1);
  expect(stateRows[0].value).toMatchObject({
    rowData: { value: 2 },
    stateAfter: { counter: 2 },
  });

  // The regression guard: the cascade template must have run. Without
  // the migration's rewrite, `__bulldozer_seq` is never populated and
  // the template is never EXECUTEd, so `cascade-out/u1:1` would not
  // exist.
  const cascadeOutRows = await sql.unsafe(`
    SELECT "keyPath", "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPathParent" = ${cascadeOutRootSql}
  `);
  expect(cascadeOutRows).toHaveLength(1);
  expect(cascadeOutRows[0].value).toEqual({ value: 100 });

  // 6) Idempotency: re-draining with nothing new in the queue must not
  //    re-run the cascade (no duplicate rows, no FK errors).
  await sql.unsafe(`SELECT public.bulldozer_timefold_process_queue()`);
  const cascadeOutAfterRedrain = await sql.unsafe(`
    SELECT 1 FROM "BulldozerStorageEngine" WHERE "keyPathParent" = ${cascadeOutRootSql}
  `);
  expect(cascadeOutAfterRedrain).toHaveLength(1);

  // 7) No-template path: a timefold with cascadeTemplate = NULL must
  //    drain queued rows without error. Use a second, independent
  //    tableStoragePath so the FK'd storage engine rows for this
  //    branch don't collide with the one above.
  const nullTableSql = `ARRAY[to_jsonb('table'::text), to_jsonb('external:cascade-null-template'::text)]::jsonb[]`;
  const nullStorageSql = `${nullTableSql} || ARRAY[to_jsonb('storage'::text)]::jsonb[]`;
  const nullGroupsSql = `${nullStorageSql} || ARRAY[to_jsonb('groups'::text)]::jsonb[]`;
  const nullGroupSql = `${nullGroupsSql} || ARRAY[to_jsonb('alpha'::text)]::jsonb[]`;
  const nullRowsSql = `${nullGroupSql} || ARRAY[to_jsonb('rows'::text)]::jsonb[]`;
  const nullStatesSql = `${nullGroupSql} || ARRAY[to_jsonb('states'::text)]::jsonb[]`;
  const nullStateRowSql = `${nullStatesSql} || ARRAY[to_jsonb('u1'::text)]::jsonb[]`;

  await sql.unsafe(`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES
      (gen_random_uuid(), ${nullTableSql}, 'null'::jsonb),
      (gen_random_uuid(), ${nullStorageSql}, 'null'::jsonb),
      (gen_random_uuid(), ${nullGroupsSql}, 'null'::jsonb),
      (gen_random_uuid(), ${nullGroupSql}, 'null'::jsonb),
      (gen_random_uuid(), ${nullRowsSql}, 'null'::jsonb),
      (gen_random_uuid(), ${nullStatesSql}, 'null'::jsonb)
    ON CONFLICT ("keyPath") DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      ${nullStateRowSql},
      jsonb_build_object(
        'rowData', '{"value": 2}'::jsonb,
        'stateAfter', '{"counter": 1}'::jsonb,
        'emittedRowsData', '[]'::jsonb,
        'nextTimestamp', 'null'::jsonb
      )
    )
  `);
  await sql.unsafe(`
    INSERT INTO "BulldozerTimeFoldDownstreamCascade"
      ("tableStoragePath", "cascadeInputName", "cascadeTemplate")
    VALUES (
      ${nullStorageSql},
      'null_template_input',
      NULL
    )
  `);
  await sql.unsafe(`
    INSERT INTO "BulldozerTimeFoldQueue" (
      "id", "tableStoragePath", "groupKey", "rowIdentifier",
      "scheduledAt", "stateAfter", "rowData", "reducerSql"
    )
    VALUES (
      gen_random_uuid(),
      ${nullStorageSql},
      to_jsonb('alpha'::text),
      'u1',
      now() - interval '1 minute',
      '{"counter": 1}'::jsonb,
      '{"value": 2}'::jsonb,
      'jsonb_build_object(''counter'', 2) AS "newState", jsonb_build_array(jsonb_build_object(''value'', 100)) AS "newRowsData", NULL::timestamptz AS "nextTimestamp"'
    )
  `);

  await sql.unsafe(`SELECT public.bulldozer_timefold_process_queue()`);

  const nullRemainingQueue = await sql.unsafe(`
    SELECT 1 FROM "BulldozerTimeFoldQueue"
    WHERE "tableStoragePath" = ${nullStorageSql}
  `);
  expect(nullRemainingQueue).toHaveLength(0);

  const nullStateAfterDrain = await sql.unsafe(`
    SELECT "value" FROM "BulldozerStorageEngine" WHERE "keyPath" = ${nullStateRowSql}
  `);
  expect(nullStateAfterDrain).toHaveLength(1);
  expect(nullStateAfterDrain[0].value).toMatchObject({ stateAfter: { counter: 2 } });
};
