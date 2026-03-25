import { stringCompare, templateIdentity } from "@stackframe/stack-shared/dist/utils/strings";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { declareFlatMapTable, declareGroupByTable, declareMapTable, declareStoredTable, toExecutableSqlTransaction, toQueryableSqlQuery } from "./index";

type TestDb = { full: string, base: string };

const TEST_DB_PREFIX = "stack_bulldozer_db_fuzz_test";

function getTestDbUrls(): TestDb {
  const env = Reflect.get(import.meta, "env");
  const connectionString = Reflect.get(env, "STACK_DATABASE_CONNECTION_STRING");
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new Error("Missing STACK_DATABASE_CONNECTION_STRING");
  }
  const base = connectionString.replace(/\/[^/]*(\?.*)?$/, "");
  const query = connectionString.split("?")[1] ?? "";
  const dbName = `${TEST_DB_PREFIX}_${Math.random().toString(16).slice(2, 12)}`;
  return {
    full: query.length === 0 ? `${base}/${dbName}` : `${base}/${dbName}?${query}`,
    base,
  };
}

type SqlExpression<T> = { type: "expression", sql: string };
type SqlStatement = { type: "statement", sql: string, outputName?: string };
type SqlQuery = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };
type SqlMapper = { type: "mapper", sql: string };
type QueryableTable = {
  listGroups(options: { start: "start", end: "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery,
  listRowsInGroup(options: { groupKey?: SqlExpression<unknown>, start: "start", end: "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery,
};
type SourceRow = { team: string | null, value: number };
type TeamMappedRow = { team: string | null, valuePlusTen: number };
type TeamBucketRow = { team: string | null, valueScaled: number, bucket: string };
type TeamFlatMappedRow = { team: string | null, kind: string, mappedValue: number };
type TeamFlatMappedPlusRow = { team: string | null, kind: string, mappedValuePlusOne: number };
type GroupedRows<T extends Record<string, unknown>> = Map<string, { groupKey: string | null, rows: Map<string, T> }>;

function expr<T>(sql: string): SqlExpression<T> {
  return { type: "expression", sql };
}
function mapper(sql: string): SqlMapper {
  return { type: "mapper", sql };
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function choose<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)] ?? values[0];
}
function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
function jsonbLiteral(value: unknown): string {
  return `${sqlStringLiteral(JSON.stringify(value))}::jsonb`;
}
function groupDiscriminator(groupKey: string | null): string {
  return groupKey === null ? "__NULL__" : `S:${groupKey}`;
}
function nullableStringCompare(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return stringCompare(a, b);
}
function groupKeyExpression(groupKey: string | null): SqlExpression<unknown> {
  return groupKey === null
    ? expr(`'null'::jsonb`)
    : expr(`to_jsonb(${sqlStringLiteral(groupKey)}::text)`);
}

function computeTeamGroups(rows: Map<string, SourceRow>): GroupedRows<{ team: string | null, value: number }> {
  const groups: GroupedRows<{ team: string | null, value: number }> = new Map();
  for (const [rowIdentifier, row] of rows) {
    const key = groupDiscriminator(row.team);
    const existing = groups.get(key);
    if (existing != null) {
      existing.rows.set(rowIdentifier, { team: row.team, value: row.value });
    } else {
      groups.set(key, {
        groupKey: row.team,
        rows: new Map([[rowIdentifier, { team: row.team, value: row.value }]]),
      });
    }
  }
  return groups;
}
function mapGroups<OldRow extends Record<string, unknown>, NewRow extends Record<string, unknown>>(
  groups: GroupedRows<OldRow>,
  mapperFn: (row: OldRow) => NewRow,
): GroupedRows<NewRow> {
  const mapped: GroupedRows<NewRow> = new Map();
  for (const [groupKey, group] of groups) {
    mapped.set(groupKey, {
      groupKey: group.groupKey,
      rows: new Map([...group.rows.entries()].map(([rowIdentifier, rowData]) => [rowIdentifier, mapperFn(rowData)])),
    });
  }
  return mapped;
}
function regroupByField<T extends Record<string, unknown>>(
  groups: GroupedRows<T>,
  groupKeySelector: (row: T) => string | null,
): GroupedRows<T> {
  const regrouped: GroupedRows<T> = new Map();
  for (const group of groups.values()) {
    for (const [rowIdentifier, rowData] of group.rows) {
      const groupKey = groupKeySelector(rowData);
      const key = groupDiscriminator(groupKey);
      const existing = regrouped.get(key);
      if (existing != null) {
        existing.rows.set(rowIdentifier, rowData);
      } else {
        regrouped.set(key, {
          groupKey,
          rows: new Map([[rowIdentifier, rowData]]),
        });
      }
    }
  }
  return regrouped;
}
function flatMapGroups<OldRow extends Record<string, unknown>, NewRow extends Record<string, unknown>>(
  groups: GroupedRows<OldRow>,
  mapperFn: (row: OldRow) => NewRow[],
): GroupedRows<NewRow> {
  const mapped: GroupedRows<NewRow> = new Map();
  for (const [groupKey, group] of groups) {
    const rows = new Map<string, NewRow>();
    for (const [rowIdentifier, rowData] of group.rows) {
      const expandedRows = mapperFn(rowData);
      for (let i = 0; i < expandedRows.length; i++) {
        const expandedRow = expandedRows[i] ?? (() => {
          throw new Error("flatMapGroups mapper returned undefined row");
        })();
        rows.set(`${rowIdentifier}:${i + 1}`, expandedRow);
      }
    }
    mapped.set(groupKey, { groupKey: group.groupKey, rows });
  }
  return mapped;
}

describe.sequential("bulldozer db fuzz composition (real postgres)", () => {
  const dbUrls = getTestDbUrls();
  const dbName = dbUrls.full.replace(/^.*\//, "").replace(/\?.*$/, "");
  const adminSql = postgres(dbUrls.base, { onnotice: () => undefined });
  const sql = postgres(dbUrls.full, { onnotice: () => undefined, max: 1 });

  async function runStatements(statements: SqlStatement[]) {
    await sql.unsafe(toExecutableSqlTransaction(statements));
  }
  async function readBoolean(expression: SqlExpression<boolean>) {
    const rows = await sql.unsafe(`SELECT (${expression.sql}) AS "value"`);
    return rows[0].value === true;
  }
  async function readRows(query: SqlQuery) {
    return await sql.unsafe(toQueryableSqlQuery(query));
  }

  async function assertTableMatches<RowData extends Record<string, unknown>>(table: QueryableTable, expected: GroupedRows<RowData>) {
    const expectedGroups = [...expected.values()]
      .filter((group) => group.rows.size > 0)
      .map((group) => group.groupKey)
      .sort(nullableStringCompare);

    const actualGroups = (await readRows(table.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    })))
      .map((row) => row.groupkey as string | null)
      .sort(nullableStringCompare);

    expect(actualGroups).toEqual(expectedGroups);

    const expectedAllRows = [...expected.values()]
      .flatMap((group) => [...group.rows.entries()].map(([rowIdentifier, rowData]) => ({ groupKey: group.groupKey, rowIdentifier, rowData })))
      .sort((a, b) => {
        const byGroup = nullableStringCompare(a.groupKey, b.groupKey);
        return byGroup !== 0 ? byGroup : stringCompare(a.rowIdentifier, b.rowIdentifier);
      });

    const actualAllRows = (await readRows(table.listRowsInGroup({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    })))
      .map((row) => ({
        groupKey: row.groupkey as string | null,
        rowIdentifier: row.rowidentifier as string,
        rowData: row.rowdata as Record<string, unknown>,
      }))
      .sort((a, b) => {
        const byGroup = nullableStringCompare(a.groupKey, b.groupKey);
        return byGroup !== 0 ? byGroup : stringCompare(a.rowIdentifier, b.rowIdentifier);
      });

    expect(actualAllRows).toEqual(expectedAllRows);

    for (const expectedGroup of expected.values()) {
      if (expectedGroup.rows.size === 0) continue;
      const expectedRows = [...expectedGroup.rows.entries()]
        .map(([rowIdentifier, rowData]) => ({ rowIdentifier, rowData }))
        .sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier));
      const actualRows = (await readRows(table.listRowsInGroup({
        groupKey: groupKeyExpression(expectedGroup.groupKey),
        start: "start",
        end: "end",
        startInclusive: true,
        endInclusive: true,
      })))
        .map((row) => ({ rowIdentifier: row.rowidentifier as string, rowData: row.rowdata as Record<string, unknown> }))
        .sort((a, b) => stringCompare(a.rowIdentifier, b.rowIdentifier));
      expect(actualRows).toEqual(expectedRows);
    }

    const missingRows = await readRows(table.listRowsInGroup({
      groupKey: groupKeyExpression("__missing_group__"),
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }));
    expect(missingRows).toEqual([]);
  }

  beforeAll(async () => {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  });

  beforeEach(async () => {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`DROP TABLE IF EXISTS "BulldozerStorageEngine"`;
    await sql`
      CREATE TABLE "BulldozerStorageEngine" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "keyPath" JSONB[] NOT NULL,
        "keyPathParent" JSONB[] GENERATED ALWAYS AS (
          CASE
            WHEN cardinality("keyPath") = 0 THEN NULL
            ELSE "keyPath"[1:cardinality("keyPath") - 1]
          END
        ) STORED,
        "value" JSONB NOT NULL,
        CONSTRAINT "BulldozerStorageEngine_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BulldozerStorageEngine_keyPath_key" UNIQUE ("keyPath"),
        CONSTRAINT "BulldozerStorageEngine_keyPathParent_fkey"
          FOREIGN KEY ("keyPathParent")
          REFERENCES "BulldozerStorageEngine"("keyPath")
          ON DELETE CASCADE
      )
    `;
    await sql`CREATE INDEX "BulldozerStorageEngine_keyPathParent_idx" ON "BulldozerStorageEngine"("keyPathParent")`;
    await sql`
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
      VALUES
        (ARRAY[]::jsonb[], 'null'::jsonb),
        (ARRAY[to_jsonb('table'::text)]::jsonb[], 'null'::jsonb)
    `;
  });

  afterAll(async () => {
    await sql.end();
    await adminSql.unsafe(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${dbName}'
        AND pid <> pg_backend_pid()
    `);
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
    await adminSql.end();
  });

  test("fuzz: stacked group/map/group pipelines preserve invariants under random mutations", async () => {
    const identifiers = ["u1", "u2", "u3", "u4", "u:5", "u 6", "u/7", "u'8"] as const;
    const teams = ["alpha", "beta", "gamma", null] as const;

    for (const seed of [101, 202, 303]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `fuzz-users-${seed}` });
      const groupedTable = declareGroupByTable({
        tableId: `fuzz-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const mapTable1 = declareMapTable({
        tableId: `fuzz-users-map-level-1-${seed}`,
        fromTable: groupedTable,
        mapper: mapper(`
          ("rowData"->'team') AS "team",
          (("rowData"->>'value')::int + 10) AS "valuePlusTen"
        `),
      });
      const mapTable2 = declareMapTable({
        tableId: `fuzz-users-map-level-2-${seed}`,
        fromTable: mapTable1,
        mapper: mapper(`
          ("rowData"->'team') AS "team",
          (("rowData"->>'valuePlusTen')::int * 2) AS "valueScaled",
          (
            CASE
              WHEN (("rowData"->>'valuePlusTen')::int * 2) >= 30 THEN 'high'
              ELSE 'low'
            END
          ) AS "bucket"
        `),
      });
      const groupedByBucket = declareGroupByTable({
        tableId: `fuzz-users-by-bucket-${seed}`,
        fromTable: mapTable2,
        groupBy: mapper(`"rowData"->'bucket' AS "groupKey"`),
      });

      await runStatements(fromTable.init());
      await runStatements(groupedTable.init());
      await runStatements(mapTable1.init());
      await runStatements(mapTable2.init());
      await runStatements(groupedByBucket.init());

      for (let step = 0; step < 60; step++) {
        const roll = rng();
        if (roll < 0.62) {
          const rowIdentifier = choose(rng, identifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 50),
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.86) {
          const rowIdentifier = choose(rng, identifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.94) {
          await runStatements(groupedByBucket.delete());
          await runStatements(mapTable2.delete());
          await runStatements(mapTable1.delete());
          await runStatements(mapTable1.init());
          await runStatements(mapTable2.init());
          await runStatements(groupedByBucket.init());
        } else {
          const rowIdentifier = choose(rng, identifiers);
          const rowData = sourceRows.get(rowIdentifier);
          if (rowData != null) {
            await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
          } else {
            await runStatements(fromTable.deleteRow(rowIdentifier));
          }
        }

        const expectedGrouped = computeTeamGroups(sourceRows);
        const expectedMap1 = mapGroups(expectedGrouped, (row): TeamMappedRow => ({
          team: (row.team as string | null),
          valuePlusTen: (row.value as number) + 10,
        }));
        const expectedMap2 = mapGroups(expectedMap1, (row): TeamBucketRow => {
          const valueScaled = (row.valuePlusTen as number) * 2;
          return {
            team: (row.team as string | null),
            valueScaled,
            bucket: valueScaled >= 30 ? "high" : "low",
          };
        });
        const expectedBucket = regroupByField(expectedMap2, (row) => row.bucket as string);

        await assertTableMatches(groupedTable, expectedGrouped);
        await assertTableMatches(mapTable1, expectedMap1);
        await assertTableMatches(mapTable2, expectedMap2);
        await assertTableMatches(groupedByBucket, expectedBucket);
      }
    }
  });

  test("fuzz: flatMap/map/group pipelines preserve invariants under random mutations and re-inits", async () => {
    const identifiers = ["f1", "f2", "f3", "f4", "f:5", "f 6", "f/7", "f'8"] as const;
    const teams = ["alpha", "beta", "gamma", null] as const;

    for (const seed of [501, 502, 503]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();
      let pipelineInitialized = true;

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `flat-fuzz-users-${seed}` });
      const groupedTable = declareGroupByTable({
        tableId: `flat-fuzz-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const flatMapTable = declareFlatMapTable({
        tableId: `flat-fuzz-users-expanded-${seed}`,
        fromTable: groupedTable,
        mapper: mapper(`
          CASE
            WHEN (("rowData"->>'value')::int) < 0 THEN '[]'::jsonb
            ELSE jsonb_build_array(
              jsonb_build_object(
                'team', "rowData"->'team',
                'kind', 'base',
                'mappedValue', (("rowData"->>'value')::int + 100)
              ),
              jsonb_build_object(
                'team', "rowData"->'team',
                'kind', 'double',
                'mappedValue', (("rowData"->>'value')::int * 2)
              )
            )
          END AS "rows"
        `),
      });
      const mapAfterFlat = declareMapTable({
        tableId: `flat-fuzz-users-expanded-plus-${seed}`,
        fromTable: flatMapTable,
        mapper: mapper(`
          ("rowData"->'team') AS "team",
          ("rowData"->'kind') AS "kind",
          (("rowData"->>'mappedValue')::int + 1) AS "mappedValuePlusOne"
        `),
      });
      const groupedByKind = declareGroupByTable({
        tableId: `flat-fuzz-users-by-kind-${seed}`,
        fromTable: mapAfterFlat,
        groupBy: mapper(`"rowData"->'kind' AS "groupKey"`),
      });

      await runStatements(fromTable.init());
      await runStatements(groupedTable.init());
      await runStatements(flatMapTable.init());
      await runStatements(mapAfterFlat.init());
      await runStatements(groupedByKind.init());

      for (let step = 0; step < 60; step++) {
        const roll = rng();
        if (roll < 0.6) {
          const rowIdentifier = choose(rng, identifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 80) - 20,
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.84) {
          const rowIdentifier = choose(rng, identifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.92) {
          if (pipelineInitialized) {
            await runStatements(groupedByKind.delete());
            await runStatements(mapAfterFlat.delete());
            await runStatements(flatMapTable.delete());
            pipelineInitialized = false;
          }
        } else {
          if (!pipelineInitialized) {
            await runStatements(flatMapTable.init());
            await runStatements(mapAfterFlat.init());
            await runStatements(groupedByKind.init());
            pipelineInitialized = true;
          }
        }

        const expectedGrouped = computeTeamGroups(sourceRows);
        const expectedFlat = flatMapGroups(expectedGrouped, (row): TeamFlatMappedRow[] => {
          if ((row.value as number) < 0) return [];
          return [
            {
              team: row.team as string | null,
              kind: "base",
              mappedValue: (row.value as number) + 100,
            },
            {
              team: row.team as string | null,
              kind: "double",
              mappedValue: (row.value as number) * 2,
            },
          ];
        });
        const expectedMapped = mapGroups(expectedFlat, (row): TeamFlatMappedPlusRow => ({
          team: row.team as string | null,
          kind: row.kind as string,
          mappedValuePlusOne: (row.mappedValue as number) + 1,
        }));
        const expectedKind = regroupByField(expectedMapped, (row) => row.kind as string);

        await assertTableMatches(groupedTable, expectedGrouped);
        if (pipelineInitialized) {
          expect(await readBoolean(flatMapTable.isInitialized())).toBe(true);
          expect(await readBoolean(mapAfterFlat.isInitialized())).toBe(true);
          expect(await readBoolean(groupedByKind.isInitialized())).toBe(true);
          await assertTableMatches(flatMapTable, expectedFlat);
          await assertTableMatches(mapAfterFlat, expectedMapped);
          await assertTableMatches(groupedByKind, expectedKind);
        } else {
          expect(await readBoolean(flatMapTable.isInitialized())).toBe(false);
          expect(await readBoolean(mapAfterFlat.isInitialized())).toBe(false);
          expect(await readBoolean(groupedByKind.isInitialized())).toBe(false);

          const flatGroups = await readRows(flatMapTable.listGroups({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }));
          const mappedGroups = await readRows(mapAfterFlat.listGroups({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }));
          const kindGroups = await readRows(groupedByKind.listGroups({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }));
          expect(flatGroups).toEqual([]);
          expect(mappedGroups).toEqual([]);
          expect(kindGroups).toEqual([]);
        }
      }
    }
  });

  test("fuzz: parallel map tables remain isolated with independent re-inits", async () => {
    const identifiers = ["m1", "m2", "m3", "m 4", "m:5"] as const;
    const teams = ["alpha", "beta", null] as const;

    for (const seed of [401, 402]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();
      let mapAInitialized = true;
      let mapBInitialized = true;

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `parallel-users-${seed}` });
      const groupedTable = declareGroupByTable({
        tableId: `parallel-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const mapTableA = declareMapTable({
        tableId: `parallel-users-map-a-${seed}`,
        fromTable: groupedTable,
        mapper: mapper(`
          ("rowData"->'team') AS "team",
          (("rowData"->>'value')::int + 100) AS "mappedValueA"
        `),
      });
      const mapTableB = declareMapTable({
        tableId: `parallel-users-map-b-${seed}`,
        fromTable: groupedTable,
        mapper: mapper(`
          ("rowData"->'team') AS "team",
          ((("rowData"->>'value')::int) * -1) AS "mappedValueB"
        `),
      });

      await runStatements(fromTable.init());
      await runStatements(groupedTable.init());
      await runStatements(mapTableA.init());
      await runStatements(mapTableB.init());

      for (let step = 0; step < 50; step++) {
        const roll = rng();
        if (roll < 0.6) {
          const rowIdentifier = choose(rng, identifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 40),
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.82) {
          const rowIdentifier = choose(rng, identifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.9) {
          if (mapAInitialized) {
            await runStatements(mapTableA.delete());
            mapAInitialized = false;
          }
        } else if (roll < 0.94) {
          if (!mapAInitialized) {
            await runStatements(mapTableA.init());
            mapAInitialized = true;
          }
        } else if (roll < 0.98) {
          if (mapBInitialized) {
            await runStatements(mapTableB.delete());
            mapBInitialized = false;
          }
        } else {
          if (!mapBInitialized) {
            await runStatements(mapTableB.init());
            mapBInitialized = true;
          }
        }

        const expectedGrouped = computeTeamGroups(sourceRows);
        await assertTableMatches(groupedTable, expectedGrouped);

        const expectedMapA = mapGroups(expectedGrouped, (row) => ({
          team: row.team as string | null,
          mappedValueA: (row.value as number) + 100,
        }));
        const expectedMapB = mapGroups(expectedGrouped, (row) => ({
          team: row.team as string | null,
          mappedValueB: -1 * (row.value as number),
        }));

        if (mapAInitialized) {
          expect(await readBoolean(mapTableA.isInitialized())).toBe(true);
          await assertTableMatches(mapTableA, expectedMapA);
        } else {
          expect(await readBoolean(mapTableA.isInitialized())).toBe(false);
          const groups = await readRows(mapTableA.listGroups({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }));
          expect(groups).toEqual([]);
        }

        if (mapBInitialized) {
          expect(await readBoolean(mapTableB.isInitialized())).toBe(true);
          await assertTableMatches(mapTableB, expectedMapB);
        } else {
          expect(await readBoolean(mapTableB.isInitialized())).toBe(false);
          const groups = await readRows(mapTableB.listGroups({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }));
          expect(groups).toEqual([]);
        }
      }
    }
  });

  test("fuzz: parallel flatMap tables remain isolated with independent re-inits", async () => {
    const identifiers = ["pf1", "pf2", "pf3", "pf 4", "pf:5"] as const;
    const teams = ["alpha", "beta", null] as const;

    for (const seed of [601, 602]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();
      let flatAInitialized = true;
      let flatBInitialized = true;

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `parallel-flat-users-${seed}` });
      const groupedTable = declareGroupByTable({
        tableId: `parallel-flat-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const flatMapA = declareFlatMapTable({
        tableId: `parallel-flat-users-a-${seed}`,
        fromTable: groupedTable,
        mapper: mapper(`
          CASE
            WHEN (("rowData"->>'value')::int) % 2 = 0 THEN jsonb_build_array(
              jsonb_build_object(
                'team', "rowData"->'team',
                'lane', 'even',
                'metricA', (("rowData"->>'value')::int + 1000)
              )
            )
            ELSE '[]'::jsonb
          END AS "rows"
        `),
      });
      const flatMapB = declareFlatMapTable({
        tableId: `parallel-flat-users-b-${seed}`,
        fromTable: groupedTable,
        mapper: mapper(`
          CASE
            WHEN (("rowData"->>'value')::int) < 0 THEN '[]'::jsonb
            ELSE jsonb_build_array(
              jsonb_build_object(
                'team', "rowData"->'team',
                'lane', 'base',
                'metricB', (("rowData"->>'value')::int)
              ),
              jsonb_build_object(
                'team', "rowData"->'team',
                'lane', 'triple',
                'metricB', (("rowData"->>'value')::int * 3)
              )
            )
          END AS "rows"
        `),
      });

      await runStatements(fromTable.init());
      await runStatements(groupedTable.init());
      await runStatements(flatMapA.init());
      await runStatements(flatMapB.init());

      for (let step = 0; step < 55; step++) {
        const roll = rng();
        if (roll < 0.6) {
          const rowIdentifier = choose(rng, identifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 50) - 10,
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.82) {
          const rowIdentifier = choose(rng, identifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.9) {
          if (flatAInitialized) {
            await runStatements(flatMapA.delete());
            flatAInitialized = false;
          }
        } else if (roll < 0.94) {
          if (!flatAInitialized) {
            await runStatements(flatMapA.init());
            flatAInitialized = true;
          }
        } else if (roll < 0.98) {
          if (flatBInitialized) {
            await runStatements(flatMapB.delete());
            flatBInitialized = false;
          }
        } else {
          if (!flatBInitialized) {
            await runStatements(flatMapB.init());
            flatBInitialized = true;
          }
        }

        const expectedGrouped = computeTeamGroups(sourceRows);
        await assertTableMatches(groupedTable, expectedGrouped);

        const expectedFlatA = flatMapGroups(expectedGrouped, (row) => {
          const value = row.value as number;
          if (value % 2 !== 0) return [];
          return [{
            team: row.team as string | null,
            lane: "even",
            metricA: value + 1000,
          }];
        });
        const expectedFlatB = flatMapGroups(expectedGrouped, (row) => {
          const value = row.value as number;
          if (value < 0) return [];
          return [
            {
              team: row.team as string | null,
              lane: "base",
              metricB: value,
            },
            {
              team: row.team as string | null,
              lane: "triple",
              metricB: value * 3,
            },
          ];
        });

        if (flatAInitialized) {
          expect(await readBoolean(flatMapA.isInitialized())).toBe(true);
          await assertTableMatches(flatMapA, expectedFlatA);
        } else {
          expect(await readBoolean(flatMapA.isInitialized())).toBe(false);
          const groups = await readRows(flatMapA.listGroups({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }));
          expect(groups).toEqual([]);
        }

        if (flatBInitialized) {
          expect(await readBoolean(flatMapB.isInitialized())).toBe(true);
          await assertTableMatches(flatMapB, expectedFlatB);
        } else {
          expect(await readBoolean(flatMapB.isInitialized())).toBe(false);
          const groups = await readRows(flatMapB.listGroups({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }));
          expect(groups).toEqual([]);
        }
      }
    }
  });
});
