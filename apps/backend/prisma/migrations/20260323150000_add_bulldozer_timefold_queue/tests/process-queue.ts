import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const tableStoragePathSql = `ARRAY[
    to_jsonb('table'::text),
    to_jsonb('external:test-timefold'::text),
    to_jsonb('storage'::text)
  ]::jsonb[]`;
  const groupsPathSql = `${tableStoragePathSql} || ARRAY[to_jsonb('groups'::text)]::jsonb[]`;
  const groupPathSql = `${groupsPathSql} || ARRAY[to_jsonb('alpha'::text)]::jsonb[]`;
  const rowsPathSql = `${groupPathSql} || ARRAY[to_jsonb('rows'::text)]::jsonb[]`;
  const statesPathSql = `${groupPathSql} || ARRAY[to_jsonb('states'::text)]::jsonb[]`;
  const stateRowPathSql = `${statesPathSql} || ARRAY[to_jsonb('u1'::text)]::jsonb[]`;
  const oldOutputPathSql = `${rowsPathSql} || ARRAY[to_jsonb('u1:1'::text)]::jsonb[]`;

  await sql.unsafe(`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES
      (gen_random_uuid(), ARRAY[to_jsonb('table'::text), to_jsonb('external:test-timefold'::text)]::jsonb[], 'null'::jsonb),
      (gen_random_uuid(), ${tableStoragePathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${groupsPathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${groupPathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${rowsPathSql}, 'null'::jsonb),
      (gen_random_uuid(), ${statesPathSql}, 'null'::jsonb)
    ON CONFLICT ("keyPath") DO NOTHING
  `);

  await sql.unsafe(`
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES
      (
        gen_random_uuid(),
        ${stateRowPathSql},
        jsonb_build_object(
          'rowData', '{"value": 2}'::jsonb,
          'stateAfter', '{"counter": 1}'::jsonb,
          'emittedRowsData', jsonb_build_array(jsonb_build_object('value', 100)),
          'nextTimestamp', 'null'::jsonb
        )
      ),
      (
        gen_random_uuid(),
        ${oldOutputPathSql},
        jsonb_build_object('rowData', jsonb_build_object('value', 100))
      )
    ON CONFLICT ("keyPath") DO UPDATE
    SET "value" = EXCLUDED."value"
  `);

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
      ${tableStoragePathSql},
      to_jsonb('alpha'::text),
      'u1',
      now() - interval '1 minute',
      '{"counter": 1}'::jsonb,
      '{"value": 2}'::jsonb,
      'jsonb_build_object(''counter'', COALESCE(("oldState"->>''counter'')::int, 0) + (("oldRowData"->>''value'')::int)) AS "newState", jsonb_build_array(jsonb_build_object(''value'', (("oldRowData"->>''value'')::int), ''counter'', COALESCE(("oldState"->>''counter'')::int, 0) + (("oldRowData"->>''value'')::int))) AS "newRowsData", ("timestamp" + interval ''1 day'') AS "nextTimestamp"'
    )
    ON CONFLICT ("tableStoragePath", "groupKey", "rowIdentifier") DO UPDATE
    SET
      "scheduledAt" = EXCLUDED."scheduledAt",
      "stateAfter" = EXCLUDED."stateAfter",
      "rowData" = EXCLUDED."rowData",
      "reducerSql" = EXCLUDED."reducerSql",
      "updatedAt" = CURRENT_TIMESTAMP
  `);

  await sql.unsafe(`SELECT public.bulldozer_timefold_process_queue()`);

  const stateRows = await sql.unsafe(`
    SELECT "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = ${stateRowPathSql}
  `);
  expect(stateRows).toHaveLength(1);
  expect(stateRows[0].value).toEqual({
    rowData: { value: 2 },
    stateAfter: { counter: 3 },
    emittedRowsData: [{ value: 100 }, { value: 2, counter: 3 }],
    nextTimestamp: expect.any(String),
  });

  const oldOutputRows = await sql.unsafe(`
    SELECT "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = ${oldOutputPathSql}
  `);
  expect(oldOutputRows).toHaveLength(1);
  expect(oldOutputRows[0].value).toEqual({ rowData: { value: 100 } });

  const newOutputRows = await sql.unsafe(`
    SELECT "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = ${rowsPathSql} || ARRAY[to_jsonb('u1:2'::text)]::jsonb[]
  `);
  expect(newOutputRows).toHaveLength(1);
  expect(newOutputRows[0].value).toEqual({ rowData: { value: 2, counter: 3 } });

  const queueRows = await sql.unsafe(`
    SELECT "scheduledAt", "stateAfter"
    FROM "BulldozerTimeFoldQueue"
    WHERE "tableStoragePath" = ${tableStoragePathSql}
      AND "groupKey" = to_jsonb('alpha'::text)
      AND "rowIdentifier" = 'u1'
  `);
  expect(queueRows).toHaveLength(1);
  expect(queueRows[0].stateAfter).toEqual({ counter: 3 });

  const metadataRows = await sql.unsafe(`
    SELECT "lastProcessedAt"
    FROM "BulldozerTimeFoldMetadata"
    WHERE "key" = 'singleton'
  `);
  expect(metadataRows).toHaveLength(1);
  expect(new Date(metadataRows[0].lastProcessedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
};
