import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { declareConcatTable, declareFilterTable, declareFlatMapTable, declareGroupByTable, declareLeftJoinTable, declareLFoldTable, declareLimitTable, declareMapTable, declareSortTable, declareStoredTable, toExecutableSqlTransaction, toQueryableSqlQuery } from "./index";

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
type JoinRuleRow = { team: string | null, threshold: number, label: string };
type TeamMappedRow = { team: string | null, valuePlusTen: number };
type TeamBucketRow = { team: string | null, valueScaled: number, bucket: string };
type TeamFlatMappedRow = { team: string | null, kind: string, mappedValue: number };
type TeamFlatMappedPlusRow = { team: string | null, kind: string, mappedValuePlusOne: number };
type GroupedRows<T extends Record<string, unknown>> = Map<string, { groupKey: string | null, rows: Map<string, T> }>;
type TraceSectionStats = {
  count: number,
  totalMs: number,
  maxMs: number,
  slowestExample: string,
};
type TraceBucket = {
  totalTrackedMs: number,
  sections: Map<string, TraceSectionStats>,
  slowOps: Array<{ opKind: string, ms: number, detail: string }>,
};

const FUZZ_TRACE_ENABLED = (() => {
  const env = Reflect.get(import.meta, "env");
  const value = Reflect.get(env, "STACK_BULLDOZER_FUZZ_TRACE") ?? Reflect.get(env, "BULLDOZER_FUZZ_TRACE");
  return value === true || value === "true" || value === "1";
})();
const MAX_SLOW_OPS = 20;
const tracesByTest = new Map<string, TraceBucket>();

function getCurrentTestNameForTrace(): string {
  return expect.getState().currentTestName ?? "__unknown_test__";
}
function getTraceBucket(testName: string): TraceBucket {
  const existing = tracesByTest.get(testName);
  if (existing != null) return existing;
  const created: TraceBucket = { totalTrackedMs: 0, sections: new Map(), slowOps: [] };
  tracesByTest.set(testName, created);
  return created;
}
function trimSqlForTrace(input: string): string {
  const trimmed = input.replaceAll(/\s+/g, " ").trim();
  if (trimmed.length <= 180) return trimmed;
  return `${trimmed.slice(0, 177)}...`;
}
function callerForTrace(fallback: string): string {
  const stack = (new Error().stack ?? "").split("\n").map((line) => line.trim());
  const preferred = stack.find((line) =>
    line.includes("index.fuzz.test.ts")
    && !line.includes("callerForTrace")
    && !line.includes("traceOperation")
    && !line.includes("runStatements")
    && !line.includes("readRows")
    && !line.includes("readBoolean"),
  );
  if (preferred != null) return preferred;
  return stack[3] ?? fallback;
}
function traceOperation(options: { opKind: "tx" | "query" | "expr", section: string, ms: number, detail: string }) {
  if (!FUZZ_TRACE_ENABLED) return;
  const testName = getCurrentTestNameForTrace();
  const bucket = getTraceBucket(testName);
  bucket.totalTrackedMs += options.ms;
  const key = `${options.opKind}:${options.section}`;
  const existing = bucket.sections.get(key);
  if (existing != null) {
    existing.count += 1;
    existing.totalMs += options.ms;
    if (options.ms > existing.maxMs) {
      existing.maxMs = options.ms;
      existing.slowestExample = options.detail;
    }
  } else {
    bucket.sections.set(key, {
      count: 1,
      totalMs: options.ms,
      maxMs: options.ms,
      slowestExample: options.detail,
    });
  }
  bucket.slowOps.push({
    opKind: options.opKind,
    ms: options.ms,
    detail: `${options.section} :: ${options.detail}`,
  });
  bucket.slowOps.sort((a, b) => b.ms - a.ms);
  if (bucket.slowOps.length > MAX_SLOW_OPS) {
    bucket.slowOps.length = MAX_SLOW_OPS;
  }
}

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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
function computeRuleGroups(rows: Map<string, JoinRuleRow>): GroupedRows<JoinRuleRow> {
  const groups: GroupedRows<JoinRuleRow> = new Map();
  for (const [rowIdentifier, row] of rows) {
    const key = groupDiscriminator(row.team);
    const existing = groups.get(key);
    if (existing != null) {
      existing.rows.set(rowIdentifier, { team: row.team, threshold: row.threshold, label: row.label });
    } else {
      groups.set(key, {
        groupKey: row.team,
        rows: new Map([[rowIdentifier, { team: row.team, threshold: row.threshold, label: row.label }]]),
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
      rows: new Map([...group.rows.entries()].map(([rowIdentifier, rowData]) => [`${rowIdentifier}:1`, mapperFn(rowData)])),
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
function filterGroups<Row extends Record<string, unknown>>(
  groups: GroupedRows<Row>,
  predicateFn: (row: Row) => boolean,
): GroupedRows<Row> {
  const filtered: GroupedRows<Row> = new Map();
  for (const [groupKey, group] of groups) {
    const rows = new Map<string, Row>();
    for (const [rowIdentifier, rowData] of group.rows) {
      if (!predicateFn(rowData)) continue;
      rows.set(`${rowIdentifier}:1`, rowData);
    }
    filtered.set(groupKey, { groupKey: group.groupKey, rows });
  }
  return filtered;
}
function limitGroups<Row extends Record<string, unknown>>(
  groups: GroupedRows<Row>,
  limit: number,
): GroupedRows<Row> {
  const limited: GroupedRows<Row> = new Map();
  for (const [groupKey, group] of groups) {
    const rows = new Map<string, Row>();
    const sortedRows = [...group.rows.entries()].sort((a, b) => stringCompare(a[0], b[0]));
    for (let i = 0; i < Math.min(limit, sortedRows.length); i++) {
      const entry = sortedRows[i] ?? (() => {
        throw new Error("limitGroups expected sorted row entry to exist");
      })();
      rows.set(entry[0], entry[1]);
    }
    limited.set(groupKey, { groupKey: group.groupKey, rows });
  }
  return limited;
}
function concatGroups<Row extends Record<string, unknown>>(
  groupsList: GroupedRows<Row>[],
): GroupedRows<Row> {
  const concatenated: GroupedRows<Row> = new Map();
  for (let tableIndex = 0; tableIndex < groupsList.length; tableIndex++) {
    const groups = groupsList[tableIndex] ?? (() => {
      throw new Error("concatGroups expected grouped rows for table index");
    })();
    for (const [groupKey, group] of groups) {
      const existing = concatenated.get(groupKey) ?? { groupKey: group.groupKey, rows: new Map<string, Row>() };
      for (const [rowIdentifier, rowData] of group.rows) {
        existing.rows.set(`${tableIndex}:${rowIdentifier}`, rowData);
      }
      concatenated.set(groupKey, existing);
    }
  }
  return concatenated;
}
function leftJoinRowIdentifier(leftRowIdentifier: string, rightRowIdentifier: string | null): string {
  return `[${JSON.stringify(leftRowIdentifier)}, ${rightRowIdentifier === null ? "null" : JSON.stringify(rightRowIdentifier)}]`;
}
function leftJoinGroups<
  FromRow extends Record<string, unknown>,
  JoinRow extends Record<string, unknown>,
>(
  fromGroups: GroupedRows<FromRow>,
  joinGroups: GroupedRows<JoinRow>,
  predicateFn: (fromRow: FromRow, joinRow: JoinRow) => boolean,
): GroupedRows<Record<string, unknown>> {
  const joined: GroupedRows<Record<string, unknown>> = new Map();
  for (const [groupKey, fromGroup] of fromGroups) {
    const joinGroup = joinGroups.get(groupKey);
    const rows = new Map<string, Record<string, unknown>>();
    const sortedFromRows = [...fromGroup.rows.entries()].sort((a, b) => stringCompare(a[0], b[0]));
    const sortedJoinRows = joinGroup == null
      ? []
      : [...joinGroup.rows.entries()].sort((a, b) => stringCompare(a[0], b[0]));
    for (const [leftRowIdentifier, leftRowData] of sortedFromRows) {
      const matches = sortedJoinRows.filter((joinEntry) => predicateFn(leftRowData, joinEntry[1]));
      if (matches.length === 0) {
        rows.set(leftJoinRowIdentifier(leftRowIdentifier, null), {
          leftRowData: { ...leftRowData },
          rightRowData: null,
        });
        continue;
      }
      for (const [rightRowIdentifier, rightRowData] of matches) {
        rows.set(leftJoinRowIdentifier(leftRowIdentifier, rightRowIdentifier), {
          leftRowData: { ...leftRowData },
          rightRowData: { ...rightRowData },
        });
      }
    }
    joined.set(groupKey, { groupKey: fromGroup.groupKey, rows });
  }
  return joined;
}
function sortedRowsForGroups<Row extends Record<string, unknown>>(groups: GroupedRows<Row>) {
  return [...groups.values()].flatMap((group) => {
    return [...group.rows.entries()]
      .sort((a, b) => {
        const leftValue = Number(Reflect.get(a[1], "value"));
        const rightValue = Number(Reflect.get(b[1], "value"));
        return leftValue - rightValue || stringCompare(a[0], b[0]);
      })
      .map(([rowIdentifier, rowData]) => ({
        groupKey: group.groupKey,
        rowIdentifier,
        rowSortKey: Number(Reflect.get(rowData, "value")),
        rowData,
      }));
  });
}
function lFoldGroupsForSortedInput(groups: GroupedRows<{ team: string | null, value: number }>) {
  const folded: GroupedRows<{ kind: string, runningTotal: number, value: number }> = new Map();
  for (const [groupKey, group] of groups) {
    const rows = new Map<string, { kind: string, runningTotal: number, value: number }>();
    let runningTotal = 0;
    const sortedEntries = [...group.rows.entries()].sort((a, b) => {
      const byValue = (a[1].value - b[1].value);
      return byValue !== 0 ? byValue : stringCompare(a[0], b[0]);
    });
    for (const [rowIdentifier, rowData] of sortedEntries) {
      runningTotal += rowData.value;
      rows.set(`${rowIdentifier}:1`, {
        kind: "running",
        runningTotal,
        value: rowData.value,
      });
      if (rowData.value % 2 === 0) {
        rows.set(`${rowIdentifier}:2`, {
          kind: "even-marker",
          runningTotal,
          value: rowData.value,
        });
      }
    }
    folded.set(groupKey, { groupKey: group.groupKey, rows });
  }
  return folded;
}
function lFoldRowsWithSortKeys(groups: GroupedRows<{ team: string | null, value: number }>) {
  const rows: Array<{ groupKey: string | null, rowIdentifier: string, rowSortKey: number, rowData: { kind: string, runningTotal: number, value: number } }> = [];
  for (const group of groups.values()) {
    let runningTotal = 0;
    const sortedEntries = [...group.rows.entries()].sort((a, b) => {
      const byValue = (a[1].value - b[1].value);
      return byValue !== 0 ? byValue : stringCompare(a[0], b[0]);
    });
    for (const [rowIdentifier, rowData] of sortedEntries) {
      runningTotal += rowData.value;
      rows.push({
        groupKey: group.groupKey,
        rowIdentifier: `${rowIdentifier}:1`,
        rowSortKey: rowData.value,
        rowData: { kind: "running", runningTotal, value: rowData.value },
      });
      if (rowData.value % 2 === 0) {
        rows.push({
          groupKey: group.groupKey,
          rowIdentifier: `${rowIdentifier}:2`,
          rowSortKey: rowData.value,
          rowData: { kind: "even-marker", runningTotal, value: rowData.value },
        });
      }
    }
  }
  return rows.sort((a, b) => {
    const byGroup = nullableStringCompare(a.groupKey, b.groupKey);
    if (byGroup !== 0) return byGroup;
    const bySort = a.rowSortKey - b.rowSortKey;
    if (bySort !== 0) return bySort;
    return stringCompare(a.rowIdentifier, b.rowIdentifier);
  });
}

describe.sequential("bulldozer db fuzz composition (real postgres)", () => {
  const dbUrls = getTestDbUrls();
  const dbName = dbUrls.full.replace(/^.*\//, "").replace(/\?.*$/, "");
  const adminSql = postgres(dbUrls.base, { onnotice: () => undefined });
  const sql = postgres(dbUrls.full, { onnotice: () => undefined, max: 1 });

  async function runStatements(statements: SqlStatement[], traceSection?: string) {
    const txSql = toExecutableSqlTransaction(statements);
    const startedAt = performance.now();
    await sql.unsafe(txSql);
    const elapsedMs = performance.now() - startedAt;
    let rowCountDetail = "";
    if (FUZZ_TRACE_ENABLED) {
      const countRows = await sql.unsafe(`SELECT COUNT(*)::int AS "count" FROM "BulldozerStorageEngine"`);
      if (countRows.length === 0) {
        throw new Error("expected count row for BulldozerStorageEngine");
      }
      const firstCountRow = countRows[0];
      rowCountDetail = ` storageRows=${Number(firstCountRow.count)}`;
    }
    const detail = `statements=${statements.length} txSqlChars=${txSql.length}${rowCountDetail} first=${trimSqlForTrace(statements[0]?.sql ?? "none")}`;
    traceOperation({
      opKind: "tx",
      section: traceSection ?? callerForTrace("runStatements"),
      ms: elapsedMs,
      detail,
    });
  }
  async function readBoolean(expression: SqlExpression<boolean>, traceSection?: string) {
    const startedAt = performance.now();
    const rows = await sql.unsafe(`SELECT (${expression.sql}) AS "value"`);
    const elapsedMs = performance.now() - startedAt;
    traceOperation({
      opKind: "expr",
      section: traceSection ?? callerForTrace("readBoolean"),
      ms: elapsedMs,
      detail: trimSqlForTrace(expression.sql),
    });
    return rows[0].value === true;
  }
  async function readRows(query: SqlQuery, traceSection?: string) {
    const startedAt = performance.now();
    const rows = await sql.unsafe(toQueryableSqlQuery(query));
    const elapsedMs = performance.now() - startedAt;
    traceOperation({
      opKind: "query",
      section: traceSection ?? callerForTrace("readRows"),
      ms: elapsedMs,
      detail: trimSqlForTrace(toQueryableSqlQuery(query)),
    });
    return rows;
  }

  async function assertTableMatches<RowData extends Record<string, unknown>>(table: QueryableTable, expected: GroupedRows<RowData>) {
    const tableLabel = (() => {
      const maybeRecord = table as unknown;
      if (isRecord(maybeRecord)) {
        const debugArgs = Reflect.get(maybeRecord, "debugArgs");
        if (isRecord(debugArgs)) {
          const tableId = Reflect.get(debugArgs, "tableId");
          const operator = Reflect.get(debugArgs, "operator");
          if (typeof tableId === "string" && typeof operator === "string") {
            return `${operator}:${tableId}`;
          }
        }
      }
      return "table";
    })();
    const expectedGroups = [...expected.values()]
      .filter((group) => group.rows.size > 0)
      .map((group) => group.groupKey)
      .sort(nullableStringCompare);

    const actualGroups = (await readRows(table.listGroups({
      start: "start",
      end: "end",
      startInclusive: true,
      endInclusive: true,
    }), `${tableLabel}.listGroups`))
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
    }), `${tableLabel}.listRowsInGroup(all)`))
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
      }), `${tableLabel}.listRowsInGroup(group)`))
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
    }), `${tableLabel}.listRowsInGroup(missing)`);
    expect(missingRows).toEqual([]);
  }

  beforeAll(async () => {
    await adminSql.unsafe(`CREATE DATABASE ${dbName}`);
  });

  beforeEach(async () => {
    const createExtensionStartedAt = performance.now();
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    traceOperation({
      opKind: "query",
      section: "beforeEach.createExtension",
      ms: performance.now() - createExtensionStartedAt,
      detail: "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    });

    const dropTableStartedAt = performance.now();
    await sql`DROP TABLE IF EXISTS "BulldozerStorageEngine"`;
    traceOperation({
      opKind: "query",
      section: "beforeEach.dropTable",
      ms: performance.now() - dropTableStartedAt,
      detail: `DROP TABLE IF EXISTS "BulldozerStorageEngine"`,
    });

    const createTableStartedAt = performance.now();
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
    traceOperation({
      opKind: "query",
      section: "beforeEach.createTable",
      ms: performance.now() - createTableStartedAt,
      detail: `CREATE TABLE "BulldozerStorageEngine"`,
    });

    const createIndexStartedAt = performance.now();
    await sql`CREATE INDEX "BulldozerStorageEngine_keyPathParent_idx" ON "BulldozerStorageEngine"("keyPathParent")`;
    traceOperation({
      opKind: "query",
      section: "beforeEach.createIndex",
      ms: performance.now() - createIndexStartedAt,
      detail: `CREATE INDEX "BulldozerStorageEngine_keyPathParent_idx"`,
    });

    const seedRootsStartedAt = performance.now();
    await sql`
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
      VALUES
        (ARRAY[]::jsonb[], 'null'::jsonb),
        (ARRAY[to_jsonb('table'::text)]::jsonb[], 'null'::jsonb)
    `;
    traceOperation({
      opKind: "query",
      section: "beforeEach.seedRoots",
      ms: performance.now() - seedRootsStartedAt,
      detail: `INSERT root key paths`,
    });
  });

  afterEach(() => {
    if (!FUZZ_TRACE_ENABLED) return;
    const testName = getCurrentTestNameForTrace();
    const bucket = tracesByTest.get(testName);
    if (bucket == null) return;

    const topSections = [...bucket.sections.entries()]
      .sort((a, b) => b[1].totalMs - a[1].totalMs)
      .slice(0, 12);
    const topOps = bucket.slowOps.slice(0, 12);

    console.log(`\n[bulldozer-fuzz-trace] ${testName}`);
    console.log(`[bulldozer-fuzz-trace] tracked_total_ms=${bucket.totalTrackedMs.toFixed(1)} sections=${bucket.sections.size}`);
    for (const [sectionName, stats] of topSections) {
      console.log(
        `[bulldozer-fuzz-trace] section=${sectionName} count=${stats.count} total_ms=${stats.totalMs.toFixed(1)} avg_ms=${(stats.totalMs / stats.count).toFixed(2)} max_ms=${stats.maxMs.toFixed(1)} slowest="${stats.slowestExample}"`,
      );
    }
    for (const op of topOps) {
      console.log(
        `[bulldozer-fuzz-trace] slow_op kind=${op.opKind} ms=${op.ms.toFixed(1)} detail="${op.detail}"`,
      );
    }

    tracesByTest.delete(testName);
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

    for (const seed of [101]) {
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

      for (let step = 0; step < 24; step++) {
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

        if (step % 3 === 0 || step === 23) {
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
    }
  }, 120_000);

  test("fuzz: flatMap/map/group pipelines preserve invariants under random mutations and re-inits", async () => {
    const identifiers = ["f1", "f2", "f3", "f4", "f:5", "f 6", "f/7", "f'8"] as const;
    const teams = ["alpha", "beta", "gamma", null] as const;

    for (const seed of [501]) {
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

      for (let step = 0; step < 24; step++) {
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

        if (step % 3 === 0 || step === 23) {
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
    }
  }, 120_000);

  test("fuzz: filter/map pipelines preserve invariants under random mutations and re-inits", async () => {
    const identifiers = ["ff1", "ff2", "ff3", "ff:4", "ff 5"] as const;
    const teams = ["alpha", "beta", "gamma", null] as const;

    for (const seed of [701]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();
      let filterPipelineInitialized = true;

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `filter-fuzz-users-${seed}` });
      const groupedTable = declareGroupByTable({
        tableId: `filter-fuzz-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const filterTable = declareFilterTable({
        tableId: `filter-fuzz-users-threshold-${seed}`,
        fromTable: groupedTable,
        filter: { type: "predicate", sql: `("rowData"->'team') IS NOT NULL AND (("rowData"->>'value')::int) >= 10` },
      });
      const mappedAfterFilter = declareMapTable({
        tableId: `filter-fuzz-users-mapped-${seed}`,
        fromTable: filterTable,
        mapper: mapper(`
          ("rowData"->'team') AS "team",
          (("rowData"->>'value')::int * 10) AS "scaledValue"
        `),
      });

      await runStatements(fromTable.init());
      await runStatements(groupedTable.init());
      await runStatements(filterTable.init());
      await runStatements(mappedAfterFilter.init());

      for (let step = 0; step < 28; step++) {
        const roll = rng();
        if (roll < 0.6) {
          const rowIdentifier = choose(rng, identifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 35) - 5,
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.82) {
          const rowIdentifier = choose(rng, identifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.9) {
          if (filterPipelineInitialized) {
            await runStatements(mappedAfterFilter.delete());
            await runStatements(filterTable.delete());
            filterPipelineInitialized = false;
          }
        } else {
          if (!filterPipelineInitialized) {
            await runStatements(filterTable.init());
            await runStatements(mappedAfterFilter.init());
            filterPipelineInitialized = true;
          }
        }

        if (step % 3 === 0 || step === 27) {
          const expectedGrouped = computeTeamGroups(sourceRows);
          const expectedFiltered = filterGroups(expectedGrouped, (row) => row.team != null && row.value >= 10);
          const expectedMapped = mapGroups(expectedFiltered, (row) => {
            if (row.team == null) {
              throw new Error("expected non-null team after filter predicate");
            }
            return {
              team: row.team,
              scaledValue: row.value * 10,
            };
          });

          await assertTableMatches(groupedTable, expectedGrouped);
          if (filterPipelineInitialized) {
            expect(await readBoolean(filterTable.isInitialized())).toBe(true);
            expect(await readBoolean(mappedAfterFilter.isInitialized())).toBe(true);
            await assertTableMatches(filterTable, expectedFiltered);
            await assertTableMatches(mappedAfterFilter, expectedMapped);
          } else {
            expect(await readBoolean(filterTable.isInitialized())).toBe(false);
            expect(await readBoolean(mappedAfterFilter.isInitialized())).toBe(false);
            expect(await readRows(filterTable.listGroups({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }))).toEqual([]);
            expect(await readRows(mappedAfterFilter.listGroups({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }))).toEqual([]);
          }
        }
      }
    }
  }, 120_000);

  test("fuzz: grouped limit table remains consistent under random mutations and re-inits", async () => {
    const identifiers = ["l1", "l2", "l3", "l4", "l 5", "l:6"] as const;
    const teams = ["alpha", "beta", "gamma", null] as const;

    for (const seed of [801]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();
      let limitInitialized = true;

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `limit-fuzz-users-${seed}` });
      const groupedTable = declareGroupByTable({
        tableId: `limit-fuzz-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const limitedByTeam = declareLimitTable({
        tableId: `limit-fuzz-users-top2-${seed}`,
        fromTable: groupedTable,
        limit: expr(`2`),
      });

      await runStatements(fromTable.init());
      await runStatements(groupedTable.init());
      await runStatements(limitedByTeam.init());

      for (let step = 0; step < 36; step++) {
        const roll = rng();
        if (roll < 0.62) {
          const rowIdentifier = choose(rng, identifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 100),
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.86) {
          const rowIdentifier = choose(rng, identifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.93) {
          if (limitInitialized) {
            await runStatements(limitedByTeam.delete());
            limitInitialized = false;
          }
        } else {
          if (!limitInitialized) {
            await runStatements(limitedByTeam.init());
            limitInitialized = true;
          }
        }

        if (step % 3 === 0 || step === 35) {
          const expectedGrouped = computeTeamGroups(sourceRows);
          const expectedLimited = limitGroups(expectedGrouped, 2);
          await assertTableMatches(groupedTable, expectedGrouped);
          if (limitInitialized) {
            expect(await readBoolean(limitedByTeam.isInitialized())).toBe(true);
            await assertTableMatches(limitedByTeam, expectedLimited);
          } else {
            expect(await readBoolean(limitedByTeam.isInitialized())).toBe(false);
            expect(await readRows(limitedByTeam.listGroups({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }))).toEqual([]);
          }
        }
      }
    }
  }, 120_000);

  test("fuzz: virtual concat table preserves prefixed rows across parallel source mutations", async () => {
    const identifiers = ["c1", "c2", "c3", "c:4", "c 5", "c/6", "c'7"] as const;
    const teams = ["alpha", "beta", "gamma"] as const;

    for (const seed of [1801]) {
      const rng = createRng(seed);
      const sourceRowsA = new Map<string, SourceRow>();
      const sourceRowsB = new Map<string, SourceRow>();
      let secondInputInitialized = true;
      let concatInitialized = true;

      const fromTableA = declareStoredTable<{ value: number, team: string | null }>({ tableId: `concat-fuzz-users-a-${seed}` });
      const fromTableB = declareStoredTable<{ value: number, team: string | null }>({ tableId: `concat-fuzz-users-b-${seed}` });
      const groupedTableA = declareGroupByTable({
        tableId: `concat-fuzz-users-a-by-team-${seed}`,
        fromTable: fromTableA,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const groupedTableB = declareGroupByTable({
        tableId: `concat-fuzz-users-b-by-team-${seed}`,
        fromTable: fromTableB,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const concatenatedTable = declareConcatTable({
        tableId: `concat-fuzz-users-by-team-${seed}`,
        tables: [groupedTableA, groupedTableB],
      });

      await runStatements(fromTableA.init());
      await runStatements(fromTableB.init());
      await runStatements(groupedTableA.init());
      await runStatements(groupedTableB.init());
      await runStatements(concatenatedTable.init());

      for (let step = 0; step < 24; step++) {
        const roll = rng();
        const mutateTableA = roll < 0.42;
        const mutateTableB = roll >= 0.42 && roll < 0.84;
        const targetRows = mutateTableA ? sourceRowsA : sourceRowsB;
        const targetTable = mutateTableA ? fromTableA : fromTableB;

        if (mutateTableA || mutateTableB) {
          if (rng() < 0.68) {
            const rowIdentifier = choose(rng, identifiers);
            const rowData: SourceRow = {
              team: choose(rng, teams),
              value: Math.floor(rng() * 60),
            };
            targetRows.set(rowIdentifier, rowData);
            await runStatements(targetTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
          } else {
            const rowIdentifier = choose(rng, identifiers);
            targetRows.delete(rowIdentifier);
            await runStatements(targetTable.deleteRow(rowIdentifier));
          }
        } else if (roll < 0.90) {
          if (secondInputInitialized) {
            await runStatements(groupedTableB.delete());
            secondInputInitialized = false;
          }
        } else if (roll < 0.95) {
          if (concatInitialized) {
            await runStatements(concatenatedTable.delete());
            concatInitialized = false;
          }
        } else {
          if (!secondInputInitialized) {
            await runStatements(groupedTableB.init());
            secondInputInitialized = true;
          } else if (!concatInitialized) {
            await runStatements(concatenatedTable.init());
            concatInitialized = true;
          }
        }

        if (step % 3 === 0 || step === 23) {
          const expectedA = computeTeamGroups(sourceRowsA);
          const expectedB = computeTeamGroups(sourceRowsB);
          if (!concatInitialized) {
            expect(await readBoolean(concatenatedTable.isInitialized())).toBe(false);
            const groups = await readRows(concatenatedTable.listGroups({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }));
            expect(groups).toEqual([]);
          } else if (secondInputInitialized) {
            expect(await readBoolean(concatenatedTable.isInitialized())).toBe(true);
            await assertTableMatches(concatenatedTable, concatGroups([expectedA, expectedB]));
          } else {
            expect(await readBoolean(concatenatedTable.isInitialized())).toBe(true);
            await assertTableMatches(concatenatedTable, concatGroups([expectedA]));
          }
        }
      }
    }
  }, 120_000);

  test("fuzz: sort table preserves sorted order under random mutations and re-inits", async () => {
    const identifiers = ["s1", "s2", "s3", "s4", "s:5", "s 6", "s/7", "s'8"] as const;
    const teams = ["alpha", "beta", "gamma", null] as const;

    for (const seed of [2201]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();
      let sortInitialized = true;

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `sort-fuzz-users-${seed}` });
      const groupedTable = declareGroupByTable({
        tableId: `sort-fuzz-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const sortedTable = declareSortTable({
        tableId: `sort-fuzz-users-sorted-${seed}`,
        fromTable: groupedTable,
        getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
        compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
      });

      await runStatements(fromTable.init());
      await runStatements(groupedTable.init());
      await runStatements(sortedTable.init());

      for (let step = 0; step < 24; step++) {
        const roll = rng();
        if (roll < 0.62) {
          const rowIdentifier = choose(rng, identifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 80),
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.86) {
          const rowIdentifier = choose(rng, identifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.93) {
          if (sortInitialized) {
            await runStatements(sortedTable.delete());
            sortInitialized = false;
          }
        } else {
          if (!sortInitialized) {
            await runStatements(sortedTable.init());
            sortInitialized = true;
          }
        }

        if (step % 3 === 0 || step === 23) {
          const expectedGrouped = computeTeamGroups(sourceRows);
          await assertTableMatches(groupedTable, expectedGrouped);

          if (!sortInitialized) {
            expect(await readBoolean(sortedTable.isInitialized())).toBe(false);
            expect(await readRows(sortedTable.listGroups({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }))).toEqual([]);
            continue;
          }

          expect(await readBoolean(sortedTable.isInitialized())).toBe(true);
          const actualRows = (await readRows(sortedTable.listRowsInGroup({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }))).map((row) => ({
            groupKey: row.groupkey as string | null,
            rowIdentifier: row.rowidentifier as string,
            rowSortKey: Number(row.rowsortkey),
            rowData: row.rowdata as Record<string, unknown>,
          }));
          expect(actualRows).toEqual(sortedRowsForGroups(expectedGrouped));
        }
      }
    }
  }, 120_000);

  test("fuzz: lfold table preserves folded suffix invariants under random mutations and re-inits", async () => {
    const identifiers = ["lf1", "lf2", "lf3", "lf4", "lf:5", "lf 6", "lf/7"] as const;
    const teams = ["alpha", "beta", "gamma", null] as const;

    for (const seed of [2601]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();
      let lFoldInitialized = true;

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `lfold-fuzz-users-${seed}` });
      const groupedTable = declareGroupByTable({
        tableId: `lfold-fuzz-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const sortedTable = declareSortTable({
        tableId: `lfold-fuzz-users-sorted-${seed}`,
        fromTable: groupedTable,
        getSortKey: mapper(`(("rowData"->>'value')::int) AS "newSortKey"`),
        compareSortKeys: (a, b) => expr(`(((${a.sql}) #>> '{}')::int) - (((${b.sql}) #>> '{}')::int)`),
      });
      const lFoldTable = declareLFoldTable({
        tableId: `lfold-fuzz-users-folded-${seed}`,
        fromTable: sortedTable,
        initialState: expr(`'0'::jsonb`),
        reducer: mapper(`
          (
            COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int)
          ) AS "newState",
          (
            CASE
              WHEN ((("oldRowData"->>'value')::int) % 2) = 0 THEN jsonb_build_array(
                jsonb_build_object(
                  'kind', 'running',
                  'runningTotal', COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int),
                  'value', (("oldRowData"->>'value')::int)
                ),
                jsonb_build_object(
                  'kind', 'even-marker',
                  'runningTotal', COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int),
                  'value', (("oldRowData"->>'value')::int)
                )
              )
              ELSE jsonb_build_array(
                jsonb_build_object(
                  'kind', 'running',
                  'runningTotal', COALESCE(("oldState"#>>'{}')::int, 0) + (("oldRowData"->>'value')::int),
                  'value', (("oldRowData"->>'value')::int)
                )
              )
            END
          ) AS "newRowsData"
        `),
      });

      await runStatements(fromTable.init());
      await runStatements(groupedTable.init());
      await runStatements(sortedTable.init());
      await runStatements(lFoldTable.init());

      for (let step = 0; step < 30; step++) {
        const roll = rng();
        if (roll < 0.62) {
          const rowIdentifier = choose(rng, identifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 90),
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.86) {
          const rowIdentifier = choose(rng, identifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.93) {
          if (lFoldInitialized) {
            await runStatements(lFoldTable.delete());
            lFoldInitialized = false;
          }
        } else if (!lFoldInitialized) {
          await runStatements(lFoldTable.init());
          lFoldInitialized = true;
        }

        if (step % 3 === 0 || step === 29) {
          const expectedGrouped = computeTeamGroups(sourceRows);
          await assertTableMatches(groupedTable, expectedGrouped);

          const expectedSortedRows = sortedRowsForGroups(expectedGrouped);
          const actualSortedRows = (await readRows(sortedTable.listRowsInGroup({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }))).map((row) => ({
            groupKey: row.groupkey as string | null,
            rowIdentifier: row.rowidentifier as string,
            rowSortKey: Number(row.rowsortkey),
            rowData: row.rowdata as Record<string, unknown>,
          })).sort((a, b) => {
            const byGroup = nullableStringCompare(a.groupKey, b.groupKey);
            if (byGroup !== 0) return byGroup;
            const bySortKey = a.rowSortKey - b.rowSortKey;
            if (bySortKey !== 0) return bySortKey;
            return stringCompare(a.rowIdentifier, b.rowIdentifier);
          });
          const sortedExpectedRows = [...expectedSortedRows].sort((a, b) => {
            const byGroup = nullableStringCompare(a.groupKey, b.groupKey);
            if (byGroup !== 0) return byGroup;
            const bySortKey = a.rowSortKey - b.rowSortKey;
            if (bySortKey !== 0) return bySortKey;
            return stringCompare(a.rowIdentifier, b.rowIdentifier);
          });
          expect(actualSortedRows).toEqual(sortedExpectedRows);

          if (!lFoldInitialized) {
            expect(await readBoolean(lFoldTable.isInitialized())).toBe(false);
            expect(await readRows(lFoldTable.listGroups({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }))).toEqual([]);
            continue;
          }

          expect(await readBoolean(lFoldTable.isInitialized())).toBe(true);
          await assertTableMatches(lFoldTable, lFoldGroupsForSortedInput(expectedGrouped));
          const actualFoldRows = (await readRows(lFoldTable.listRowsInGroup({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }))).map((row) => ({
            groupKey: row.groupkey as string | null,
            rowIdentifier: row.rowidentifier as string,
            rowSortKey: Number(row.rowsortkey),
            rowData: row.rowdata as { kind: string, runningTotal: number, value: number },
          })).sort((a, b) => {
            const byGroup = nullableStringCompare(a.groupKey, b.groupKey);
            if (byGroup !== 0) return byGroup;
            const bySort = a.rowSortKey - b.rowSortKey;
            if (bySort !== 0) return bySort;
            return stringCompare(a.rowIdentifier, b.rowIdentifier);
          });
          expect(actualFoldRows).toEqual(lFoldRowsWithSortKeys(expectedGrouped));
        }
      }
    }
  }, 120_000);

  test("fuzz: left join table preserves join invariants under random mutations and re-inits", async () => {
    const userIdentifiers = ["lj-u1", "lj-u2", "lj-u3", "lj-u4", "lj-u:5", "lj-u 6"] as const;
    const ruleIdentifiers = ["lj-r1", "lj-r2", "lj-r3", "lj-r4", "lj-r:5", "lj-r 6"] as const;
    const teams = ["alpha", "beta", "gamma", null] as const;
    const labels = ["bronze", "silver", "gold", "vip"] as const;

    for (const seed of [3001]) {
      const rng = createRng(seed);
      const sourceRows = new Map<string, SourceRow>();
      const ruleRows = new Map<string, JoinRuleRow>();
      let leftJoinInitialized = true;

      const fromTable = declareStoredTable<{ value: number, team: string | null }>({ tableId: `left-join-fuzz-users-${seed}` });
      const joinTable = declareStoredTable<{ team: string | null, threshold: number, label: string }>({ tableId: `left-join-fuzz-rules-${seed}` });
      const groupedFromTable = declareGroupByTable({
        tableId: `left-join-fuzz-users-by-team-${seed}`,
        fromTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const groupedJoinTable = declareGroupByTable({
        tableId: `left-join-fuzz-rules-by-team-${seed}`,
        fromTable: joinTable,
        groupBy: mapper(`"rowData"->'team' AS "groupKey"`),
      });
      const leftJoinedTable = declareLeftJoinTable({
        tableId: `left-join-fuzz-result-${seed}`,
        leftTable: groupedFromTable,
        rightTable: groupedJoinTable,
        on: { type: "predicate", sql: `(("rightRowData"->>'threshold')::int) <= (("leftRowData"->>'value')::int)` },
      });

      await runStatements(fromTable.init());
      await runStatements(joinTable.init());
      await runStatements(groupedFromTable.init());
      await runStatements(groupedJoinTable.init());
      await runStatements(leftJoinedTable.init());

      for (let step = 0; step < 36; step++) {
        const roll = rng();
        if (roll < 0.42) {
          const rowIdentifier = choose(rng, userIdentifiers);
          const rowData: SourceRow = {
            team: choose(rng, teams),
            value: Math.floor(rng() * 90),
          };
          sourceRows.set(rowIdentifier, rowData);
          await runStatements(fromTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.56) {
          const rowIdentifier = choose(rng, userIdentifiers);
          sourceRows.delete(rowIdentifier);
          await runStatements(fromTable.deleteRow(rowIdentifier));
        } else if (roll < 0.82) {
          const rowIdentifier = choose(rng, ruleIdentifiers);
          const rowData: JoinRuleRow = {
            team: choose(rng, teams),
            threshold: Math.floor(rng() * 90),
            label: choose(rng, labels),
          };
          ruleRows.set(rowIdentifier, rowData);
          await runStatements(joinTable.setRow(rowIdentifier, expr(jsonbLiteral(rowData))));
        } else if (roll < 0.90) {
          const rowIdentifier = choose(rng, ruleIdentifiers);
          ruleRows.delete(rowIdentifier);
          await runStatements(joinTable.deleteRow(rowIdentifier));
        } else if (roll < 0.95) {
          if (leftJoinInitialized) {
            await runStatements(leftJoinedTable.delete());
            leftJoinInitialized = false;
          }
        } else if (!leftJoinInitialized) {
          await runStatements(leftJoinedTable.init());
          leftJoinInitialized = true;
        }

        if (step % 3 === 0 || step === 35) {
          const expectedGroupedFrom = computeTeamGroups(sourceRows);
          const expectedGroupedJoin = computeRuleGroups(ruleRows);
          await assertTableMatches(groupedFromTable, expectedGroupedFrom);
          await assertTableMatches(groupedJoinTable, expectedGroupedJoin);

          if (!leftJoinInitialized) {
            expect(await readBoolean(leftJoinedTable.isInitialized())).toBe(false);
            expect(await readRows(leftJoinedTable.listGroups({
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            }))).toEqual([]);
            continue;
          }

          expect(await readBoolean(leftJoinedTable.isInitialized())).toBe(true);
          const expectedLeftJoined = leftJoinGroups(
            expectedGroupedFrom,
            expectedGroupedJoin,
            (fromRow, joinRow) => {
              const fromValue = Number(Reflect.get(fromRow, "value"));
              const joinThreshold = Number(Reflect.get(joinRow, "threshold"));
              return joinThreshold <= fromValue;
            },
          );
          await assertTableMatches(leftJoinedTable, expectedLeftJoined);
        }
      }
    }
  }, 120_000);

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
  }, 120_000);

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
  }, 120_000);
});
