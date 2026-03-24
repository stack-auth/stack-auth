import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent, templateIdentity } from "@stackframe/stack-shared/dist/utils/strings";

export type Table<GK extends Json, SK extends Json, RD extends RowData> = {
  tableId: TableId,

  // Query groups and rows
  listGroups(options: { start: SqlExpression<GK>, end: SqlExpression<GK>, startInclusive: boolean, endInclusive: boolean }): SqlQuery<Iterable<{ groupKey: GK }>>,
  listRowsInGroup(options: { groupKey: SqlExpression<GK>, start: SqlExpression<SK>, end: SqlExpression<SK>, startInclusive: boolean, endInclusive: boolean }): SqlQuery<Iterable<{ rowIdentifier: RowIdentifier, rowSortKey: SK, rowData: RD }>>,

  // Sorting and grouping
  compareGroupKeys(a: SqlExpression<GK>, b: SqlExpression<GK>): SqlExpression<number>,
  compareSortKeys(a: SqlExpression<SK>, b: SqlExpression<SK>): SqlExpression<number>,

  // Lifecycle/migration methods
  /** Called when the table should be created on the storage engine. */
  init(): SqlStatement[],
  /** Called when the table should be deleted from the storage engine. */
  delete(): SqlStatement[],
  isInitialized(): SqlExpression<boolean>,

  // Internal methods, used only by table constructors to create relationships between them
  /**
   * @param trigger A SQL statement that can reference the changes table with columns `groupKey: GK`, `rowIdentifier: RowIdentifier`, `oldRowSortKey: SK | null`, `newRowSortKey: SK | null`, `oldRowData: RowData | null`, `newRowData: RowData | null`. Note that this trigger should be a no-op if the table that created this trigger is not initialized.
   */
  registerRowChangeTrigger(trigger: (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]): { deregister: () => void },
};

export function declareStoredTable<RD extends RowData>(options: {
  tableId: TableId,
}): Table<null, null, RD> & {
  setRow(rowIdentifier: RowIdentifier, rowData: SqlExpression<RD>): SqlStatement[],
  deleteRow(rowIdentifier: RowIdentifier): SqlStatement[],
} {
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const ensureRowsHierarchyStatement = createInsertPathRowsStatement(options.tableId, ["rows"]);

  // Note that this table has only one group and sort key (null), so all groups and rows are always returned by every filter.
  return {
    tableId: options.tableId,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT 'null'::jsonb AS groupKey
      WHERE ${startInclusive && endInclusive ? sqlExpression`1 = 1` : sqlExpression`1 = 0`}
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT
        "keyPath"[cardinality("keyPath")] AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine"
      WHERE "keyPathParent" = ${getStorageEnginePath(options.tableId, ["rows"])}::text[]
        AND ${startInclusive && endInclusive ? sqlExpression`1 = 1` : sqlExpression`1 = 0`}
    `,
    compareGroupKeys: (a, b) => sqlExpression` 0 `,
    compareSortKeys: (a, b) => sqlExpression` 0 `,
    init: () => [ensureRowsHierarchyStatement, sqlStatement`
      -- Create metadata about the table.
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
      VALUES (
        ${getStorageEnginePath(options.tableId, ["metadata"])}::text[],
        '{ "version": 1 }'::jsonb
      )
    `],
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getStorageEnginePath(options.tableId, [])}::text[] AS "path"
        UNION ALL
        SELECT "BulldozerStorageEngine"."keyPath" AS "path"
        FROM "BulldozerStorageEngine"
        INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
      )
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
    `],
    isInitialized: () => sqlExpression`
      EXISTS (
        SELECT 1 FROM "BulldozerStorageEngine"
        WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::text[]
      )
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
    setRow: (rowIdentifier, rowData) => {
      const oldRowsTableName = `old_rows_${generateSecureRandomString()}`;
      const upsertedRowsTableName = `upserted_rows_${generateSecureRandomString()}`;
      const changesTableName = `changes_${generateSecureRandomString()}`;
      const rowIdentifierLiteral = quoteSqlStringLiteral(rowIdentifier);
      const rowValue = sqlExpression`
        jsonb_build_object(
          'rowData', ${rowData}::jsonb
        )
      `;
      return [
        ensureRowsHierarchyStatement,
        sqlQuery`
          SELECT "value"->'rowData' AS "oldRowData"
          FROM "BulldozerStorageEngine"
          WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["rows", rowIdentifier])}::text[]
        `.toStatement(oldRowsTableName),
        sqlQuery`
          INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
          VALUES (
            ${getStorageEnginePath(options.tableId, ["rows", rowIdentifier])}::text[],
            ${rowValue}::jsonb
          )
          ON CONFLICT ("keyPath") DO UPDATE
          SET "value" = ${rowValue}::jsonb
          RETURNING "value"->'rowData' AS "newRowData"
        `.toStatement(upsertedRowsTableName),
        sqlQuery`
          SELECT
            'null'::jsonb AS "groupKey",
            ${rowIdentifierLiteral}::text AS "rowIdentifier",
            'null'::jsonb AS "oldRowSortKey",
            'null'::jsonb AS "newRowSortKey",
            ${quoteSqlIdentifier(oldRowsTableName)}."oldRowData" AS "oldRowData",
            ${quoteSqlIdentifier(upsertedRowsTableName)}."newRowData" AS "newRowData"
          FROM ${quoteSqlIdentifier(upsertedRowsTableName)}
          LEFT JOIN ${quoteSqlIdentifier(oldRowsTableName)} ON true
        `.toStatement(changesTableName),
        ...[...triggers.values()].flatMap(trigger => trigger(quoteSqlIdentifier(changesTableName)))
      ];
    },
    deleteRow: (rowIdentifier) => {
      const deletedRowsTableName = `deleted_rows_${generateSecureRandomString()}`;
      const changesTableName = `changes_${generateSecureRandomString()}`;
      const rowIdentifierLiteral = quoteSqlStringLiteral(rowIdentifier);
      return [
        sqlQuery`
          DELETE FROM "BulldozerStorageEngine"
            WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["rows", rowIdentifier])}::text[]
            RETURNING "value"->'rowData' AS "oldRowData"
        `.toStatement(deletedRowsTableName),
        sqlQuery`
          SELECT
            'null'::jsonb AS "groupKey",
            ${rowIdentifierLiteral}::text AS "rowIdentifier",
            'null'::jsonb AS "oldRowSortKey",
            'null'::jsonb AS "newRowSortKey",
            ${quoteSqlIdentifier(deletedRowsTableName)}."oldRowData" AS "oldRowData",
            'null'::jsonb AS "newRowData"
          FROM ${quoteSqlIdentifier(deletedRowsTableName)}
        `.toStatement(changesTableName),
        ...[...triggers.values()].flatMap(trigger => trigger(quoteSqlIdentifier(changesTableName)))
      ];
    },
  };
}

declare function declareMapTable<
  GK extends Json,
  SK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, SK, OldRD>,
  mapper: SqlMapper<OldRD, NewRD>,
}): Table<GK, SK, NewRD>;

declare function declareFilterTable<
  GK extends Json,
  SK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, SK, RD>,
  filter: SqlPredicate<RD>,
}): Table<GK, SK, RD>;


// ====== Executing SQL Statements ======
const BULLDOZER_LOCK_ID = 7857391;  // random number to avoid conflicts with other applications
export function toQueryableSqlQuery(query: SqlQuery): string {
  return query.sql;
}
export function toExecutableSqlTransaction(statements: SqlStatement[]): string {
  return deindent`
    BEGIN;

    SELECT pg_advisory_xact_lock(${BULLDOZER_LOCK_ID});

    WITH __dummy_statement_1__ AS (SELECT 1),
    ${statements.map(statement => deindent`
      ${quoteSqlIdentifier(statement.outputName ?? `unnamed_statement_${generateSecureRandomString().slice(0, 8)}`).sql} AS (
        ${statement.sql}
      ),
    `).join("\n")}
    __dummy_statement_2__ AS (SELECT 1)
    SELECT 1;

    COMMIT;
  `;
}

// ====== Utilities ======
const sqlTemplateLiteral = <T>(type: T) => (strings: TemplateStringsArray, ...values: { sql: string }[]) => ({ type, sql: templateIdentity(strings, ...values.map(v => v.sql)) });
type SqlStatement = { type: "statement", outputName?: string, sql: string };
const sqlStatement = sqlTemplateLiteral<"statement">("statement");
type SqlQuery<R extends void | Iterable<unknown> = void> = { type: "query", outputName?: string, sql: string };
const sqlQuery = (...args: Parameters<ReturnType<typeof sqlTemplateLiteral<"query">>>) => {
  return {
    ...sqlTemplateLiteral<"query">("query")(...args),
    toStatement(outputName?: string) {
      return { type: "statement", outputName, sql: this.sql } as const;
    }
  };
};
type SqlExpression<T> = { type: "expression", sql: string };
const sqlExpression = sqlTemplateLiteral<"expression">("expression");
type SqlMapper<OldRD extends RowData, NewRD extends RowData> = { type: "mapper", sql: string };  // ex.: "row.id AS id, row.old_value + 1 AS new_value"
const sqlMapper = sqlTemplateLiteral<"mapper">("mapper");
type SqlPredicate<RD extends RowData> = { type: "predicate", sql: string };  // ex.: "user_id = 123"
const sqlPredicate = sqlTemplateLiteral<"predicate">("predicate");
type RowData = Record<string, Json>;
type Json = string | number | boolean | null | { [key: string]: Json } | Json[];
type RowIdentifier = string;
type TableId = string | { "tableType": "internal", "internalId": string, "parent": null | TableId };
function quoteSqlIdentifier(input: string): SqlExpression<string> {
  if (input.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) == null) {
    throw new StackAssertionError("Invalid SQL identifier", { input });
  }
  return { type: "expression", sql: `"${input}"` };
}
function quoteSqlStringLiteral(input: string): SqlExpression<string> {
  return { type: "expression", sql: `'${input.replaceAll("'", "''")}'` };
}
function getStorageEnginePath(tableId: TableId, path: string[]): SqlExpression<string[]> {
  return pathSegmentsToSqlExpression(getStorageEnginePathSegments(tableId, path));
}
function getStorageEnginePathSegments(tableId: TableId, path: string[]): string[] {
  const tableIdWithParents = [];
  let currentTableId = tableId;
  while (true) {
    if (typeof currentTableId === "string") {
      tableIdWithParents.push(`external:${currentTableId}`);
      break;
    } else {
      tableIdWithParents.push(`internal:${currentTableId.internalId}`);
      if (currentTableId.parent === null) break;
      currentTableId = currentTableId.parent;
    }
  }
  return [...tableIdWithParents.reverse().flatMap(id => ["table", id]), "storage", ...path];
}
function pathSegmentsToSqlExpression(pathSegments: string[]): SqlExpression<string[]> {
  return {
    type: "expression",
    sql: `ARRAY[${pathSegments.map((segment) => quoteSqlStringLiteral(segment).sql).join(", ")}]::text[]`,
  };
}
function createInsertPathRowsStatement(tableId: TableId, path: string[]): SqlStatement {
  const segments = getStorageEnginePathSegments(tableId, path);
  const uniquePathSqlExpressions = [...new Set(segments.map((_, idx) => pathSegmentsToSqlExpression(segments.slice(0, idx + 1)).sql))];
  return {
    type: "statement",
    sql: deindent`
      INSERT INTO "BulldozerStorageEngine" ("keyPath", "value")
      VALUES
      ${uniquePathSqlExpressions.map((pathSql) => `(${pathSql}, 'null'::jsonb)`).join(",\n")}
      ON CONFLICT ("keyPath") DO NOTHING
    `,
  };
}
