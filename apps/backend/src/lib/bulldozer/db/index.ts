import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { deindent, templateIdentity } from "@stackframe/stack-shared/dist/utils/strings";

export type Table<GK extends Json, SK extends Json, RD extends RowData> = {
  tableId: TableId,
  inputTables: Table<any, any, any>[],
  debugArgs: Record<string, unknown>,

  // Query groups and rows
  listGroups(options: { start: SqlExpression<GK> | "start", end: SqlExpression<GK> | "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery<Iterable<{ groupKey: GK }>>,
  listRowsInGroup(options: { groupKey?: SqlExpression<GK>, start: SqlExpression<SK> | "start", end: SqlExpression<SK> | "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery<Iterable<{ rowIdentifier: RowIdentifier, rowSortKey: SK, rowData: RD }>>,

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


// ====== Table implementations ======
// IMPORTANT NOTE: For every new table implementation, we should also add tests (unit, fuzzing, & perf; including an entry in the "hundreds of thousands" perf test), an example in the example schema, and support in Bulldozer Studio.

export function declareStoredTable<RD extends RowData>(options: {
  tableId: TableId,
}): Table<null, null, RD> & {
  setRow(rowIdentifier: RowIdentifier, rowData: SqlExpression<RD>): SqlStatement[],
  deleteRow(rowIdentifier: RowIdentifier): SqlStatement[],
} {
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();

  // Note that this table has only one group and sort key (null), so all groups and rows are always returned by every filter.
  return {
    tableId: options.tableId,
    inputTables: [],
    debugArgs: {
      operator: "stored",
      tableId: tableIdToDebugString(options.tableId),
    },
    compareGroupKeys: (a, b) => sqlExpression` 0 `,
    compareSortKeys: (a, b) => sqlExpression` 0 `,
    init: () => [sqlStatement`
      INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
      VALUES
      (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
      (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
      (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["rows"])}, 'null'::jsonb),
      (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
    `],
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
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
        WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
      )
    `,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT 'null'::jsonb AS groupKey
      WHERE ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT
        ("keyPath"[cardinality("keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine"
      WHERE "keyPathParent" = ${getStorageEnginePath(options.tableId, ["rows"])}::jsonb[]
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
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
        sqlQuery`
          SELECT "value"->'rowData' AS "oldRowData"
          FROM "BulldozerStorageEngine"
          WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["rows", rowIdentifier])}::jsonb[]
        `.toStatement(oldRowsTableName),
        sqlQuery`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES (
            gen_random_uuid(),
            ${getStorageEnginePath(options.tableId, ["rows", rowIdentifier])}::jsonb[],
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
            WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["rows", rowIdentifier])}::jsonb[]
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

export function declareGroupByTable<
  GK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, OldRD>,
  groupBy: SqlMapper<{ rowIdentifier: RowIdentifier, rowData: OldRD }, { groupKey: GK }>,
}): Table<GK, null, NewRD> {
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;

  options.fromTable.registerRowChangeTrigger((fromChangesTable) => {
    const mappedChangesTableName = `mapped_changes_${generateSecureRandomString()}`;
    const groupedChangesTableName = `grouped_changes_${generateSecureRandomString()}`;

    return [
      sqlQuery`
        SELECT
          "changes"."rowIdentifier" AS "rowIdentifier",
          "changes"."oldRowData" AS "oldRowData",
          "changes"."newRowData" AS "newRowData",
          ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
          ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow",
          "oldGroup"."groupKey" AS "oldGroupKey",
          "newGroup"."groupKey" AS "newGroupKey"
        FROM ${fromChangesTable} AS "changes"
        LEFT JOIN LATERAL (
          SELECT "mapped"."groupKey"
          FROM (
            SELECT ${options.groupBy}
            FROM (
              SELECT
                "changes"."rowIdentifier" AS "rowIdentifier",
                "changes"."oldRowData" AS "rowData"
            ) AS "groupByInput"
          ) AS "mapped"
        ) AS "oldGroup" ON ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object')
        LEFT JOIN LATERAL (
          SELECT "mapped"."groupKey"
          FROM (
            SELECT ${options.groupBy}
            FROM (
              SELECT
                "changes"."rowIdentifier" AS "rowIdentifier",
                "changes"."newRowData" AS "rowData"
            ) AS "groupByInput"
          ) AS "mapped"
        ) AS "newGroup" ON ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object')
        WHERE ${isInitializedExpression}
      `.toStatement(mappedChangesTableName),
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          "insertRows"."keyPath",
          "insertRows"."value"
        FROM (
          SELECT DISTINCT
            ${getGroupKeyPath(sqlExpression`"newGroupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(mappedChangesTableName)}
          WHERE "hasNewRow"
          UNION
          SELECT DISTINCT
            ${getGroupRowsPath(sqlExpression`"newGroupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(mappedChangesTableName)}
          WHERE "hasNewRow"
        ) AS "insertRows"
        ON CONFLICT ("keyPath") DO NOTHING
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "target"
        USING ${quoteSqlIdentifier(mappedChangesTableName)} AS "changes"
        WHERE "changes"."hasOldRow"
          AND "target"."keyPath" = ${getGroupRowPath(
            sqlExpression`"changes"."oldGroupKey"`,
            sqlExpression`to_jsonb("changes"."rowIdentifier"::text)`,
          )}::jsonb[]
      `,
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          ${getGroupRowPath(
            sqlExpression`"newGroupKey"`,
            sqlExpression`to_jsonb("rowIdentifier"::text)`,
          )}::jsonb[],
          jsonb_build_object('rowData', "newRowData")
        FROM ${quoteSqlIdentifier(mappedChangesTableName)}
        WHERE "hasNewRow"
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "staleGroupPath"
        USING ${quoteSqlIdentifier(mappedChangesTableName)} AS "changes"
        WHERE "changes"."hasOldRow"
          AND "staleGroupPath"."keyPath" IN (
            ${getGroupRowsPath(sqlExpression`"changes"."oldGroupKey"`)}::jsonb[],
            ${getGroupKeyPath(sqlExpression`"changes"."oldGroupKey"`)}::jsonb[]
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "BulldozerStorageEngine" AS "groupRow"
            WHERE "groupRow"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"changes"."oldGroupKey"`)}::jsonb[]
              AND NOT EXISTS (
                SELECT 1
                FROM ${quoteSqlIdentifier(mappedChangesTableName)} AS "deletingRow"
                WHERE "deletingRow"."hasOldRow"
                  AND "deletingRow"."oldGroupKey" IS NOT DISTINCT FROM "changes"."oldGroupKey"
                  AND "groupRow"."keyPath" = ${getGroupRowPath(
                    sqlExpression`"deletingRow"."oldGroupKey"`,
                    sqlExpression`to_jsonb("deletingRow"."rowIdentifier"::text)`,
                  )}::jsonb[]
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(mappedChangesTableName)} AS "insertingRow"
            WHERE "insertingRow"."hasNewRow"
              AND "insertingRow"."newGroupKey" IS NOT DISTINCT FROM "changes"."oldGroupKey"
          )
      `,
      sqlQuery`
        SELECT
          "oldGroupKey" AS "groupKey",
          "rowIdentifier" AS "rowIdentifier",
          'null'::jsonb AS "oldRowSortKey",
          'null'::jsonb AS "newRowSortKey",
          "oldRowData" AS "oldRowData",
          CASE
            WHEN "hasNewRow" AND "oldGroupKey" IS NOT DISTINCT FROM "newGroupKey" THEN "newRowData"
            ELSE 'null'::jsonb
          END AS "newRowData"
        FROM ${quoteSqlIdentifier(mappedChangesTableName)}
        WHERE "hasOldRow"
        UNION ALL
        SELECT
          "newGroupKey" AS "groupKey",
          "rowIdentifier" AS "rowIdentifier",
          'null'::jsonb AS "oldRowSortKey",
          'null'::jsonb AS "newRowSortKey",
          'null'::jsonb AS "oldRowData",
          "newRowData" AS "newRowData"
        FROM ${quoteSqlIdentifier(mappedChangesTableName)}
        WHERE "hasNewRow"
          AND (NOT "hasOldRow" OR "oldGroupKey" IS DISTINCT FROM "newGroupKey")
      `.toStatement(groupedChangesTableName),
      ...[...triggers.values()].flatMap((trigger) => trigger(quoteSqlIdentifier(groupedChangesTableName))),
    ];
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "groupBy",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      groupBySql: options.groupBy.sql,
    },
    compareGroupKeys: (a, b) => sqlExpression` 0 `,
    compareSortKeys: (a, b) => sqlExpression` 0 `,
    init: () => {
      const fromTableAllRowsTableName = `from_table_all_rows_${generateSecureRandomString()}`;
      const fromTableRowsWithGroupKeyTableName = `from_table_rows_with_group_key_${generateSecureRandomString()}`;

      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["groups"])}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        options.fromTable.listRowsInGroup({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).toStatement(fromTableAllRowsTableName),
        sqlQuery`
          SELECT
            "rows"."rowidentifier" AS "rowIdentifier",
            "rows"."rowdata" AS "rowData",
            "mapped"."groupKey" AS "groupKey"
          FROM ${quoteSqlIdentifier(fromTableAllRowsTableName)} AS "rows"
          LEFT JOIN LATERAL (
            SELECT "mapped"."groupKey"
            FROM (
              SELECT ${options.groupBy}
              FROM (
                SELECT
                  "rows"."rowidentifier" AS "rowIdentifier",
                  "rows"."rowdata" AS "rowData"
              ) AS "groupByInput"
            ) AS "mapped"
          ) AS "mapped" ON true
        `.toStatement(fromTableRowsWithGroupKeyTableName),
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            "insertRows"."keyPath",
            "insertRows"."value"
          FROM (
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(fromTableRowsWithGroupKeyTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(fromTableRowsWithGroupKeyTableName)}
            UNION
            SELECT
              ${getGroupRowPath(
                sqlExpression`"groupKey"`,
                sqlExpression`to_jsonb("rowIdentifier"::text)`,
              )}::jsonb[] AS "keyPath",
              jsonb_build_object('rowData', "rowData") AS "value"
            FROM ${quoteSqlIdentifier(fromTableRowsWithGroupKeyTableName)}
          ) AS "insertRows"
        `,
      ];
    },
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
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
        WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
      )
    `,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey
      FROM "BulldozerStorageEngine" AS "groupPath"
      WHERE "groupPath"."keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND EXISTS (
          SELECT 1
          FROM "BulldozerStorageEngine" AS "groupRowsPath"
          INNER JOIN "BulldozerStorageEngine" AS "groupRow"
            ON "groupRow"."keyPathParent" = "groupRowsPath"."keyPath"
          WHERE "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
            AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        )
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey ? sqlQuery`
      SELECT
        ("keyPath"[cardinality("keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine"
      WHERE "keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"])}::jsonb[]
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    ` : sqlQuery`
      -- Get all rows from all groups
      SELECT
        "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupPath"
      INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
        ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
      INNER JOIN "BulldozerStorageEngine" AS "rows"
        ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
      WHERE "groupPath"."keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
  };
}

export function declareFlatMapTable<
  GK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, OldRD>,
  mapper: SqlMapper<OldRD, { rows: NewRD[] }>,
}): Table<GK, null, NewRD> {
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const createExpandedRowIdentifier = (sourceRowIdentifier: SqlExpression<RowIdentifier>, flatIndex: SqlExpression<number>): SqlExpression<RowIdentifier> =>
    sqlExpression`(${sourceRowIdentifier} || ':' || (${flatIndex}::text))`;
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;

  options.fromTable.registerRowChangeTrigger((fromChangesTable) => {
    const mappedChangesTableName = `mapped_changes_${generateSecureRandomString()}`;
    const oldFlatRowsTableName = `old_flat_rows_${generateSecureRandomString()}`;
    const newFlatRowsTableName = `new_flat_rows_${generateSecureRandomString()}`;
    const flatMapChangesTableName = `flat_map_changes_${generateSecureRandomString()}`;
    return [
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."rowIdentifier" AS "sourceRowIdentifier",
          ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
          ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow",
          "oldMapped"."rows" AS "oldMappedRows",
          "newMapped"."rows" AS "newMappedRows"
        FROM ${fromChangesTable} AS "changes"
        LEFT JOIN LATERAL (
          SELECT "mapped"."rows" AS "rows"
          FROM (
            SELECT ${options.mapper}
            FROM (
              SELECT
                "changes"."rowIdentifier" AS "rowIdentifier",
                "changes"."oldRowData" AS "rowData"
            ) AS "mapperInput"
          ) AS "mapped"
        ) AS "oldMapped" ON ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object')
        LEFT JOIN LATERAL (
          SELECT "mapped"."rows" AS "rows"
          FROM (
            SELECT ${options.mapper}
            FROM (
              SELECT
                "changes"."rowIdentifier" AS "rowIdentifier",
                "changes"."newRowData" AS "rowData"
            ) AS "mapperInput"
          ) AS "mapped"
        ) AS "newMapped" ON ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object')
        WHERE ${isInitializedExpression}
      `.toStatement(mappedChangesTableName),
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          ${createExpandedRowIdentifier(
            sqlExpression`"changes"."sourceRowIdentifier"`,
            sqlExpression`"flatRow"."flatIndex"`,
          )} AS "rowIdentifier",
          "flatRow"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(mappedChangesTableName)} AS "changes"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN "changes"."hasOldRow" THEN (
              CASE
                WHEN jsonb_typeof("changes"."oldMappedRows") = 'array' THEN "changes"."oldMappedRows"
                ELSE '[]'::jsonb
              END
            )
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      `.toStatement(oldFlatRowsTableName),
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          ${createExpandedRowIdentifier(
            sqlExpression`"changes"."sourceRowIdentifier"`,
            sqlExpression`"flatRow"."flatIndex"`,
          )} AS "rowIdentifier",
          "flatRow"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(mappedChangesTableName)} AS "changes"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN "changes"."hasNewRow" THEN (
              CASE
                WHEN jsonb_typeof("changes"."newMappedRows") = 'array' THEN "changes"."newMappedRows"
                ELSE '[]'::jsonb
              END
            )
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      `.toStatement(newFlatRowsTableName),
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          "insertRows"."keyPath",
          "insertRows"."value"
        FROM (
          SELECT DISTINCT
            ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newFlatRowsTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newFlatRowsTableName)}
        ) AS "insertRows"
        ON CONFLICT ("keyPath") DO NOTHING
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "target"
        USING ${quoteSqlIdentifier(oldFlatRowsTableName)} AS "changes"
        WHERE "target"."keyPath" = ${getGroupRowPath(
          sqlExpression`"changes"."groupKey"`,
          sqlExpression`to_jsonb("changes"."rowIdentifier"::text)`,
        )}::jsonb[]
      `,
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          ${getGroupRowPath(
            sqlExpression`"groupKey"`,
            sqlExpression`to_jsonb("rowIdentifier"::text)`,
          )}::jsonb[],
          jsonb_build_object('rowData', "rowData")
        FROM ${quoteSqlIdentifier(newFlatRowsTableName)}
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "staleGroupPath"
        USING ${quoteSqlIdentifier(oldFlatRowsTableName)} AS "changes"
        WHERE "staleGroupPath"."keyPath" IN (
          ${getGroupRowsPath(sqlExpression`"changes"."groupKey"`)}::jsonb[],
          ${getGroupKeyPath(sqlExpression`"changes"."groupKey"`)}::jsonb[]
        )
          AND NOT EXISTS (
            SELECT 1
            FROM "BulldozerStorageEngine" AS "groupRow"
            WHERE "groupRow"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"changes"."groupKey"`)}::jsonb[]
              AND NOT EXISTS (
                SELECT 1
                FROM ${quoteSqlIdentifier(oldFlatRowsTableName)} AS "deletingRow"
                WHERE "deletingRow"."groupKey" IS NOT DISTINCT FROM "changes"."groupKey"
                  AND "groupRow"."keyPath" = ${getGroupRowPath(
                    sqlExpression`"deletingRow"."groupKey"`,
                    sqlExpression`to_jsonb("deletingRow"."rowIdentifier"::text)`,
                  )}::jsonb[]
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(newFlatRowsTableName)} AS "insertingRow"
            WHERE "insertingRow"."groupKey" IS NOT DISTINCT FROM "changes"."groupKey"
          )
      `,
      sqlQuery`
        SELECT
          COALESCE("newRows"."groupKey", "oldRows"."groupKey") AS "groupKey",
          COALESCE("newRows"."rowIdentifier", "oldRows"."rowIdentifier") AS "rowIdentifier",
          'null'::jsonb AS "oldRowSortKey",
          'null'::jsonb AS "newRowSortKey",
          CASE WHEN "oldRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowData" END AS "oldRowData",
          CASE WHEN "newRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowData" END AS "newRowData"
        FROM ${quoteSqlIdentifier(oldFlatRowsTableName)} AS "oldRows"
        FULL OUTER JOIN ${quoteSqlIdentifier(newFlatRowsTableName)} AS "newRows"
          ON "oldRows"."groupKey" IS NOT DISTINCT FROM "newRows"."groupKey"
          AND "oldRows"."rowIdentifier" = "newRows"."rowIdentifier"
        WHERE "oldRows"."rowData" IS DISTINCT FROM "newRows"."rowData"
      `.toStatement(flatMapChangesTableName),
      ...[...triggers.values()].flatMap((trigger) => trigger(quoteSqlIdentifier(flatMapChangesTableName))),
    ];
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "flatMap",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      mapperSql: options.mapper.sql,
    },
    compareGroupKeys: options.fromTable.compareGroupKeys,
    compareSortKeys: (a, b) => sqlExpression` 0 `,
    init: () => {
      const fromGroupsTableName = `from_groups_${generateSecureRandomString()}`;
      const fromRowsTableName = `from_rows_${generateSecureRandomString()}`;
      const mappedRowsTableName = `mapped_rows_${generateSecureRandomString()}`;
      const flatRowsTableName = `flat_rows_${generateSecureRandomString()}`;

      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["groups"])}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        options.fromTable.listGroups({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).toStatement(fromGroupsTableName),
        sqlQuery`
          SELECT
            "groups"."groupkey" AS "groupKey",
            "rows"."rowidentifier" AS "rowIdentifier",
            "rows"."rowdata" AS "rowData"
          FROM ${quoteSqlIdentifier(fromGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${options.fromTable.listRowsInGroup({
              groupKey: sqlExpression`"groups"."groupkey"`,
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            })}
          ) AS "rows"
        `.toStatement(fromRowsTableName),
        sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rowIdentifier" AS "sourceRowIdentifier",
            "mapped"."rows" AS "mappedRows"
          FROM ${quoteSqlIdentifier(fromRowsTableName)} AS "rows"
          LEFT JOIN LATERAL (
            SELECT "mapped"."rows" AS "rows"
            FROM (
              SELECT ${options.mapper}
              FROM (
                SELECT
                  "rows"."rowIdentifier" AS "rowIdentifier",
                  "rows"."rowData" AS "rowData"
              ) AS "mapperInput"
            ) AS "mapped"
          ) AS "mapped" ON true
        `.toStatement(mappedRowsTableName),
        sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            ${createExpandedRowIdentifier(
              sqlExpression`"rows"."sourceRowIdentifier"`,
              sqlExpression`"flatRow"."flatIndex"`,
            )} AS "rowIdentifier",
            "flatRow"."rowData" AS "rowData"
          FROM ${quoteSqlIdentifier(mappedRowsTableName)} AS "rows"
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof("rows"."mappedRows") = 'array' THEN "rows"."mappedRows"
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
        `.toStatement(flatRowsTableName),
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            "insertRows"."keyPath",
            "insertRows"."value"
          FROM (
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(flatRowsTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(flatRowsTableName)}
            UNION
            SELECT
              ${getGroupRowPath(
                sqlExpression`"groupKey"`,
                sqlExpression`to_jsonb("rowIdentifier"::text)`,
              )}::jsonb[] AS "keyPath",
              jsonb_build_object('rowData', "rowData") AS "value"
            FROM ${quoteSqlIdentifier(flatRowsTableName)}
          ) AS "insertRows"
        `,
      ];
    },
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
        UNION ALL
        SELECT "BulldozerStorageEngine"."keyPath" AS "path"
        FROM "BulldozerStorageEngine"
        INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
      )
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
    `],
    isInitialized: () => isInitializedExpression,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey
      FROM "BulldozerStorageEngine" AS "groupPath"
      WHERE "groupPath"."keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND EXISTS (
          SELECT 1
          FROM "BulldozerStorageEngine" AS "groupRowsPath"
          INNER JOIN "BulldozerStorageEngine" AS "groupRow"
            ON "groupRow"."keyPathParent" = "groupRowsPath"."keyPath"
          WHERE "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
            AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        )
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
        }
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey ? sqlQuery`
      SELECT
        ("keyPath"[cardinality("keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine"
      WHERE "keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"])}::jsonb[]
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    ` : sqlQuery`
      SELECT
        "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupPath"
      INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
        ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
      INNER JOIN "BulldozerStorageEngine" AS "rows"
        ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
      WHERE "groupPath"."keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
  };
}

export function declareMapTable<
  GK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, OldRD>,
  mapper: SqlMapper<OldRD, NewRD>,
}): Table<GK, null, NewRD> {
  const nestedFlatMapTable = declareFlatMapTable({
    tableId: { tableType: "internal", internalId: "map", parent: options.tableId },
    fromTable: options.fromTable,
    mapper: sqlMapper`
      jsonb_build_array(
        COALESCE(
          (
            SELECT to_jsonb("mapped")
            FROM (
              SELECT ${options.mapper}
            ) AS "mapped"
          ),
          'null'::jsonb
        )
      ) AS "rows"
    `,
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "map",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      mapperSql: options.mapper.sql,
    },
    init: () => [
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        VALUES
        (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
        (gen_random_uuid(), ${sqlArray([...getTablePathSegments(options.tableId), quoteSqlJsonbLiteral("table")])}::jsonb[], 'null'::jsonb),
        (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}::jsonb[], 'null'::jsonb),
        (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[], '{ "version": 1 }'::jsonb)
      `,
      ...nestedFlatMapTable.init(),
    ],
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
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
        WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
      )
    `,
    ...pick(nestedFlatMapTable, [
      "compareGroupKeys",
      "compareSortKeys",
      "listGroups",
      "listRowsInGroup",
      "registerRowChangeTrigger",
    ]),
  };
}

export function declareFilterTable<
  GK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, RD>,
  filter: SqlPredicate<RD>,
}): Table<GK, null, RD> {
  const nestedFlatMapTable = declareFlatMapTable({
    tableId: { tableType: "internal", internalId: "filter", parent: options.tableId },
    fromTable: options.fromTable,
    mapper: sqlMapper`
      CASE
        WHEN ${options.filter}
          THEN jsonb_build_array("rowData")
        ELSE '[]'::jsonb
      END AS "rows"
    `,
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "filter",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      filterSql: options.filter.sql,
    },
    init: () => [
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        VALUES
        (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
        (gen_random_uuid(), ${sqlArray([...getTablePathSegments(options.tableId), quoteSqlJsonbLiteral("table")])}::jsonb[], 'null'::jsonb),
        (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}::jsonb[], 'null'::jsonb),
        (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[], '{ "version": 1 }'::jsonb)
      `,
      ...nestedFlatMapTable.init(),
    ],
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
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
        WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
      )
    `,
    ...pick(nestedFlatMapTable, [
      "compareGroupKeys",
      "compareSortKeys",
      "listGroups",
      "listRowsInGroup",
      "registerRowChangeTrigger",
    ]),
  };
}

export function declareLimitTable<
  GK extends Json,
  SK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, SK, RD>,
  limit: SqlExpression<number>,
}): Table<GK, SK, RD> {
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const normalizedLimit = sqlExpression`GREATEST((${options.limit})::int, 0)`;
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;

  // TODO: Currently, we recompute the entire limit table when a particular group changes. In the future, we should use an ordered tree to do this incrementally

  options.fromTable.registerRowChangeTrigger((fromChangesTable) => {
    const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
    const affectedGroupsTableName = `affected_groups_${generateSecureRandomString()}`;
    const oldGroupRowsTableName = `old_group_rows_${generateSecureRandomString()}`;
    const newGroupRowsTableName = `new_group_rows_${generateSecureRandomString()}`;
    const oldLimitedRowsTableName = `old_limited_rows_${generateSecureRandomString()}`;
    const newLimitedRowsTableName = `new_limited_rows_${generateSecureRandomString()}`;
    const limitChangesTableName = `limit_changes_${generateSecureRandomString()}`;
    return [
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."rowIdentifier" AS "rowIdentifier",
          "changes"."oldRowSortKey" AS "oldRowSortKey",
          "changes"."newRowSortKey" AS "newRowSortKey",
          "changes"."oldRowData" AS "oldRowData",
          "changes"."newRowData" AS "newRowData",
          ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
          ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow"
        FROM ${fromChangesTable} AS "changes"
        WHERE ${isInitializedExpression}
      `.toStatement(normalizedChangesTableName),
      sqlQuery`
        SELECT DISTINCT "changes"."groupKey" AS "groupKey"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."hasOldRow" OR "changes"."hasNewRow"
      `.toStatement(affectedGroupsTableName),
      sqlQuery`
        SELECT
          "groups"."groupKey" AS "groupKey",
          "rows"."rowidentifier" AS "rowIdentifier",
          "rows"."rowsortkey" AS "rowSortKey",
          "rows"."rowdata" AS "rowData"
        FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        CROSS JOIN LATERAL (
          ${options.fromTable.listRowsInGroup({
            groupKey: sqlExpression`"groups"."groupKey"`,
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          })}
        ) AS "rows"
      `.toStatement(oldGroupRowsTableName),
      sqlQuery`
        SELECT
          "rows"."groupKey" AS "groupKey",
          "rows"."rowIdentifier" AS "rowIdentifier",
          "rows"."rowSortKey" AS "rowSortKey",
          "rows"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(oldGroupRowsTableName)} AS "rows"
        WHERE NOT EXISTS (
          SELECT 1
          FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
          WHERE "changes"."hasOldRow"
            AND "changes"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
            AND "changes"."rowIdentifier" = "rows"."rowIdentifier"
        )
        UNION ALL
        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."rowIdentifier" AS "rowIdentifier",
          "changes"."newRowSortKey" AS "rowSortKey",
          "changes"."newRowData" AS "rowData"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."hasNewRow"
      `.toStatement(newGroupRowsTableName),
      sqlQuery`
        SELECT
          "rankedRows"."groupKey" AS "groupKey",
          "rankedRows"."rowIdentifier" AS "rowIdentifier",
          "rankedRows"."rowSortKey" AS "rowSortKey",
          "rankedRows"."rowData" AS "rowData"
        FROM (
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rowIdentifier" AS "rowIdentifier",
            "rows"."rowSortKey" AS "rowSortKey",
            "rows"."rowData" AS "rowData",
            row_number() OVER (
              PARTITION BY "rows"."groupKey"
              ORDER BY "rows"."rowSortKey" ASC, "rows"."rowIdentifier" ASC
            ) AS "rank"
          FROM ${quoteSqlIdentifier(oldGroupRowsTableName)} AS "rows"
        ) AS "rankedRows"
        WHERE "rankedRows"."rank" <= ${normalizedLimit}
      `.toStatement(oldLimitedRowsTableName),
      sqlQuery`
        SELECT
          "rankedRows"."groupKey" AS "groupKey",
          "rankedRows"."rowIdentifier" AS "rowIdentifier",
          "rankedRows"."rowSortKey" AS "rowSortKey",
          "rankedRows"."rowData" AS "rowData"
        FROM (
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rowIdentifier" AS "rowIdentifier",
            "rows"."rowSortKey" AS "rowSortKey",
            "rows"."rowData" AS "rowData",
            row_number() OVER (
              PARTITION BY "rows"."groupKey"
              ORDER BY "rows"."rowSortKey" ASC, "rows"."rowIdentifier" ASC
            ) AS "rank"
          FROM ${quoteSqlIdentifier(newGroupRowsTableName)} AS "rows"
        ) AS "rankedRows"
        WHERE "rankedRows"."rank" <= ${normalizedLimit}
      `.toStatement(newLimitedRowsTableName),
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          "insertRows"."keyPath",
          "insertRows"."value"
        FROM (
          SELECT DISTINCT
            ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newLimitedRowsTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newLimitedRowsTableName)}
        ) AS "insertRows"
        ON CONFLICT ("keyPath") DO NOTHING
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "target"
        USING ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        WHERE "target"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
      `,
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          ${getGroupRowPath(
            sqlExpression`"groupKey"`,
            sqlExpression`to_jsonb("rowIdentifier"::text)`,
          )}::jsonb[],
          jsonb_build_object(
            'rowSortKey', "rowSortKey",
            'rowData', "rowData"
          )
        FROM ${quoteSqlIdentifier(newLimitedRowsTableName)}
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "staleGroupPath"
        USING ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        WHERE "staleGroupPath"."keyPath" IN (
          ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[],
          ${getGroupKeyPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        )
          AND NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(newLimitedRowsTableName)} AS "newRows"
            WHERE "newRows"."groupKey" IS NOT DISTINCT FROM "groups"."groupKey"
          )
      `,
      sqlQuery`
        SELECT
          COALESCE("newRows"."groupKey", "oldRows"."groupKey") AS "groupKey",
          COALESCE("newRows"."rowIdentifier", "oldRows"."rowIdentifier") AS "rowIdentifier",
          CASE WHEN "oldRows"."rowSortKey" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowSortKey" END AS "oldRowSortKey",
          CASE WHEN "newRows"."rowSortKey" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowSortKey" END AS "newRowSortKey",
          CASE WHEN "oldRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowData" END AS "oldRowData",
          CASE WHEN "newRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowData" END AS "newRowData"
        FROM ${quoteSqlIdentifier(oldLimitedRowsTableName)} AS "oldRows"
        FULL OUTER JOIN ${quoteSqlIdentifier(newLimitedRowsTableName)} AS "newRows"
          ON "oldRows"."groupKey" IS NOT DISTINCT FROM "newRows"."groupKey"
          AND "oldRows"."rowIdentifier" = "newRows"."rowIdentifier"
        WHERE "oldRows"."rowSortKey" IS DISTINCT FROM "newRows"."rowSortKey"
          OR "oldRows"."rowData" IS DISTINCT FROM "newRows"."rowData"
      `.toStatement(limitChangesTableName),
      ...[...triggers.values()].flatMap((trigger) => trigger(quoteSqlIdentifier(limitChangesTableName))),
    ];
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "limit",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      limitSql: options.limit.sql,
    },
    compareGroupKeys: options.fromTable.compareGroupKeys,
    compareSortKeys: options.fromTable.compareSortKeys,
    init: () => {
      const fromGroupsTableName = `from_groups_${generateSecureRandomString()}`;
      const fromRowsTableName = `from_rows_${generateSecureRandomString()}`;
      const limitedRowsTableName = `limited_rows_${generateSecureRandomString()}`;
      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["groups"])}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        options.fromTable.listGroups({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).toStatement(fromGroupsTableName),
        sqlQuery`
          SELECT
            "groups"."groupkey" AS "groupKey",
            "rows"."rowidentifier" AS "rowIdentifier",
            "rows"."rowsortkey" AS "rowSortKey",
            "rows"."rowdata" AS "rowData"
          FROM ${quoteSqlIdentifier(fromGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${options.fromTable.listRowsInGroup({
              groupKey: sqlExpression`"groups"."groupkey"`,
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            })}
          ) AS "rows"
        `.toStatement(fromRowsTableName),
        sqlQuery`
          SELECT
            "rankedRows"."groupKey" AS "groupKey",
            "rankedRows"."rowIdentifier" AS "rowIdentifier",
            "rankedRows"."rowSortKey" AS "rowSortKey",
            "rankedRows"."rowData" AS "rowData"
          FROM (
            SELECT
              "rows"."groupKey" AS "groupKey",
              "rows"."rowIdentifier" AS "rowIdentifier",
              "rows"."rowSortKey" AS "rowSortKey",
              "rows"."rowData" AS "rowData",
              row_number() OVER (
                PARTITION BY "rows"."groupKey"
                ORDER BY "rows"."rowSortKey" ASC, "rows"."rowIdentifier" ASC
              ) AS "rank"
            FROM ${quoteSqlIdentifier(fromRowsTableName)} AS "rows"
          ) AS "rankedRows"
          WHERE "rankedRows"."rank" <= ${normalizedLimit}
        `.toStatement(limitedRowsTableName),
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            "insertRows"."keyPath",
            "insertRows"."value"
          FROM (
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(limitedRowsTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(limitedRowsTableName)}
            UNION
            SELECT
              ${getGroupRowPath(
                sqlExpression`"groupKey"`,
                sqlExpression`to_jsonb("rowIdentifier"::text)`,
              )}::jsonb[] AS "keyPath",
              jsonb_build_object(
                'rowSortKey', "rowSortKey",
                'rowData', "rowData"
              ) AS "value"
            FROM ${quoteSqlIdentifier(limitedRowsTableName)}
          ) AS "insertRows"
        `,
      ];
    },
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
        UNION ALL
        SELECT "BulldozerStorageEngine"."keyPath" AS "path"
        FROM "BulldozerStorageEngine"
        INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
      )
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
    `],
    isInitialized: () => isInitializedExpression,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey
      FROM "BulldozerStorageEngine" AS "groupPath"
      WHERE "groupPath"."keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND EXISTS (
          SELECT 1
          FROM "BulldozerStorageEngine" AS "groupRowsPath"
          INNER JOIN "BulldozerStorageEngine" AS "groupRow"
            ON "groupRow"."keyPathParent" = "groupRowsPath"."keyPath"
          WHERE "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
            AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        )
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
        }
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey ? sqlQuery`
      SELECT
        ("row"."keyPath"[cardinality("row"."keyPath")] #>> '{}') AS rowIdentifier,
        "row"."value"->'rowSortKey' AS rowSortKey,
        "row"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "row"
      WHERE "row"."keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"])}::jsonb[]
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"row"."value"->'rowSortKey'`, start)} >= 0`
              : sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"row"."value"->'rowSortKey'`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"row"."value"->'rowSortKey'`, end)} <= 0`
              : sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"row"."value"->'rowSortKey'`, end)} < 0`
        }
      ORDER BY rowSortKey ASC, rowIdentifier ASC
    ` : sqlQuery`
      SELECT
        "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        "rows"."value"->'rowSortKey' AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupPath"
      INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
        ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
      INNER JOIN "BulldozerStorageEngine" AS "rows"
        ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
      WHERE "groupPath"."keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"rows"."value"->'rowSortKey'`, start)} >= 0`
              : sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"rows"."value"->'rowSortKey'`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"rows"."value"->'rowSortKey'`, end)} <= 0`
              : sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"rows"."value"->'rowSortKey'`, end)} < 0`
        }
      ORDER BY groupKey ASC, rowSortKey ASC, rowIdentifier ASC
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
  };
}

export function declareConcatTable<
  GK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  tables: Table<GK, any, RD>[],
}): Table<GK, null, RD> {
  const firstTable = options.tables[0] ?? (() => {
    throw new StackAssertionError("declareConcatTable requires at least one input table", { tableId: options.tableId });
  })();
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const rawExpression = <T>(sql: string): SqlExpression<T> => ({ type: "expression", sql });
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;
  const createConcatenatedRowIdentifierSql = (tableIndex: number, rowIdentifierSql: string) =>
    `${quoteSqlStringLiteral(`${tableIndex}:`).sql} || ${rowIdentifierSql}`;
  const getInputInitializedSql = (table: Table<GK, any, RD>) => table.isInitialized().sql;
  const getUnionedListGroupsSql = (queryOptions: Parameters<typeof firstTable.listGroups>[0]) => {
    return options.tables
      .map((table) => deindent`
        SELECT "sourceGroups"."groupkey" AS "groupKey"
        FROM (${table.listGroups(queryOptions).sql}) AS "sourceGroups"
        WHERE ${getInputInitializedSql(table)}
      `)
      .join("\nUNION ALL\n");
  };
  const getUnionedListRowsSql = (queryOptions: Parameters<typeof firstTable.listRowsInGroup>[0] & { allGroups: boolean }) => {
    return options.tables.map((table, tableIndex) => {
      if (queryOptions.allGroups) {
        return deindent`
          SELECT
            "sourceRows"."groupkey" AS "groupKey",
            ${createConcatenatedRowIdentifierSql(tableIndex, `"sourceRows"."rowidentifier"`)} AS "rowIdentifier",
            'null'::jsonb AS "rowSortKey",
            "sourceRows"."rowdata" AS "rowData",
            ${tableIndex}::int AS "sourceTableIndex",
            row_number() OVER (
              ORDER BY "sourceRows"."groupkey" ASC, "sourceRows"."rowsortkey" ASC, "sourceRows"."rowidentifier" ASC
            ) AS "sourceRowIndex"
          FROM (${table.listRowsInGroup({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }).sql}) AS "sourceRows"
          WHERE ${getInputInitializedSql(table)}
        `;
      }
      const groupKey = queryOptions.groupKey ?? (() => {
        throw new StackAssertionError("declareConcatTable specific-group query requires a group key");
      })();
      return deindent`
        SELECT
          ${createConcatenatedRowIdentifierSql(tableIndex, `"sourceRows"."rowidentifier"`)} AS "rowIdentifier",
          'null'::jsonb AS "rowSortKey",
          "sourceRows"."rowdata" AS "rowData",
          ${tableIndex}::int AS "sourceTableIndex",
          row_number() OVER (
            ORDER BY "sourceRows"."rowsortkey" ASC, "sourceRows"."rowidentifier" ASC
          ) AS "sourceRowIndex"
        FROM (${table.listRowsInGroup({
          groupKey,
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).sql}) AS "sourceRows"
        WHERE ${getInputInitializedSql(table)}
      `;
    }).join("\nUNION ALL\n");
  };

  options.tables.forEach((table, tableIndex) => {
    table.registerRowChangeTrigger((changesTable) => {
      const concatChangesTableName = `concat_changes_${generateSecureRandomString()}`;
      return [
        sqlQuery`
          SELECT
            "changes"."groupKey" AS "groupKey",
            ${rawExpression<RowIdentifier>(createConcatenatedRowIdentifierSql(tableIndex, `"changes"."rowIdentifier"`))} AS "rowIdentifier",
            'null'::jsonb AS "oldRowSortKey",
            'null'::jsonb AS "newRowSortKey",
            "changes"."oldRowData" AS "oldRowData",
            "changes"."newRowData" AS "newRowData"
          FROM ${changesTable} AS "changes"
          WHERE ${isInitializedExpression}
            AND ${rawExpression<boolean>(getInputInitializedSql(table))}
        `.toStatement(concatChangesTableName),
        ...[...triggers.values()].flatMap((trigger) => trigger(quoteSqlIdentifier(concatChangesTableName))),
      ];
    });
  });

  return {
    tableId: options.tableId,
    inputTables: options.tables,
    debugArgs: {
      operator: "concat",
      tableId: tableIdToDebugString(options.tableId),
      inputTableIds: options.tables.map((table) => tableIdToDebugString(table.tableId)),
    },
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT DISTINCT "concatGroups"."groupKey" AS groupKey
      FROM (${rawExpression(getUnionedListGroupsSql({ start, end, startInclusive, endInclusive }))}) AS "concatGroups"
      WHERE ${isInitializedExpression}
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey != null ? sqlQuery`
      SELECT
        "concatRows"."rowIdentifier" AS rowIdentifier,
        "concatRows"."rowSortKey" AS rowSortKey,
        "concatRows"."rowData" AS rowData
      FROM (${rawExpression(getUnionedListRowsSql({
        groupKey,
        start,
        end,
        startInclusive,
        endInclusive,
        allGroups: false,
      }))}) AS "concatRows"
      WHERE ${isInitializedExpression}
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
      ORDER BY "concatRows"."sourceTableIndex" ASC, "concatRows"."sourceRowIndex" ASC, "concatRows"."rowIdentifier" ASC
    ` : sqlQuery`
      SELECT
        "concatRows"."groupKey" AS groupKey,
        "concatRows"."rowIdentifier" AS rowIdentifier,
        "concatRows"."rowSortKey" AS rowSortKey,
        "concatRows"."rowData" AS rowData
      FROM (${rawExpression(getUnionedListRowsSql({
        start,
        end,
        startInclusive,
        endInclusive,
        allGroups: true,
      }))}) AS "concatRows"
      WHERE ${isInitializedExpression}
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
      ORDER BY "concatRows"."sourceTableIndex" ASC, "concatRows"."sourceRowIndex" ASC, "concatRows"."rowIdentifier" ASC
    `,
    compareGroupKeys: firstTable.compareGroupKeys,
    compareSortKeys: () => sqlExpression`0`,
    init: () => [sqlStatement`
      INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
      VALUES
      (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
      (gen_random_uuid(), ${sqlArray([...getTablePathSegments(options.tableId), quoteSqlJsonbLiteral("table")])}::jsonb[], 'null'::jsonb),
      (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}::jsonb[], 'null'::jsonb),
      (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[], '{ "version": 1 }'::jsonb)
    `],
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
        UNION ALL
        SELECT "BulldozerStorageEngine"."keyPath" AS "path"
        FROM "BulldozerStorageEngine"
        INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
      )
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
    `],
    isInitialized: () => isInitializedExpression,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
  };
}

export function declareSortTable<
  GK extends Json,
  OldSK extends Json,
  NewSK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, OldSK, RD>,
  getSortKey: SqlMapper<{ rowIdentifier: RowIdentifier, oldSortKey: OldSK, rowData: RD }, { newSortKey: NewSK }>,
  compareSortKeys: (a: SqlExpression<NewSK>, b: SqlExpression<NewSK>) => SqlExpression<number>,
}): Table<GK, NewSK, RD> {
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const groupsPath = getStorageEnginePath(options.tableId, ["groups"]);
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const getGroupMetadataPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "metadata"]);
  const compareSortKeysSqlLiteral = quoteSqlStringLiteral(options.compareSortKeys(sqlExpression`$1`, sqlExpression`$2`).sql);
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;
  const sortRangePredicate = (rowSortKey: SqlExpression<NewSK>, optionsForRange: {
    start: SqlExpression<NewSK> | "start",
    end: SqlExpression<NewSK> | "end",
    startInclusive: boolean,
    endInclusive: boolean,
  }) => sqlExpression`
    ${
      optionsForRange.start === "start"
        ? sqlExpression`1 = 1`
        : optionsForRange.startInclusive
          ? sqlExpression`${options.compareSortKeys(rowSortKey, optionsForRange.start)} >= 0`
          : sqlExpression`${options.compareSortKeys(rowSortKey, optionsForRange.start)} > 0`
    }
    AND ${
      optionsForRange.end === "end"
        ? sqlExpression`1 = 1`
        : optionsForRange.endInclusive
          ? sqlExpression`${options.compareSortKeys(rowSortKey, optionsForRange.end)} <= 0`
          : sqlExpression`${options.compareSortKeys(rowSortKey, optionsForRange.end)} < 0`
    }
  `;

  options.fromTable.registerRowChangeTrigger((fromChangesTable) => {
    const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
    const sortChangesTableName = `sort_changes_${generateSecureRandomString()}`;
    return [
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."rowIdentifier" AS "rowIdentifier",
          "changes"."oldRowData" AS "oldRowData",
          "changes"."newRowData" AS "newRowData",
          to_jsonb("oldSortKey"."newSortKey") AS "oldComputedSortKey",
          to_jsonb("newSortKey"."newSortKey") AS "newComputedSortKey",
          ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
          ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow"
        FROM ${fromChangesTable} AS "changes"
        LEFT JOIN LATERAL (
          SELECT "mapped"."newSortKey"
          FROM (
            SELECT ${options.getSortKey}
            FROM (
              SELECT
                "changes"."rowIdentifier" AS "rowIdentifier",
                "changes"."oldRowSortKey" AS "oldSortKey",
                "changes"."oldRowData" AS "rowData"
            ) AS "sortInput"
          ) AS "mapped"
        ) AS "oldSortKey" ON ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object')
        LEFT JOIN LATERAL (
          SELECT "mapped"."newSortKey"
          FROM (
            SELECT ${options.getSortKey}
            FROM (
              SELECT
                "changes"."rowIdentifier" AS "rowIdentifier",
                "changes"."newRowSortKey" AS "oldSortKey",
                "changes"."newRowData" AS "rowData"
            ) AS "sortInput"
          ) AS "mapped"
        ) AS "newSortKey" ON ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object')
        WHERE ${isInitializedExpression}
      `.toStatement(normalizedChangesTableName),
      sqlStatement`
        INSERT INTO pg_temp.bulldozer_side_effects ("note")
        SELECT "effect"."note"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        CROSS JOIN LATERAL (
          SELECT pg_temp.bulldozer_sort_delete(
            ${groupsPath}::jsonb[],
            "changes"."groupKey",
            ${compareSortKeysSqlLiteral}::text,
            "changes"."rowIdentifier"
          ) AS "note"
        ) AS "effect"
        WHERE "changes"."hasOldRow"
          AND (
            NOT "changes"."hasNewRow"
            OR "changes"."oldComputedSortKey" IS DISTINCT FROM "changes"."newComputedSortKey"
            OR "changes"."oldRowData" IS DISTINCT FROM "changes"."newRowData"
          )
      `,
      sqlStatement`
        INSERT INTO pg_temp.bulldozer_side_effects ("note")
        SELECT "effect"."note"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        CROSS JOIN LATERAL (
          SELECT pg_temp.bulldozer_sort_insert(
            ${groupsPath}::jsonb[],
            "changes"."groupKey",
            ${compareSortKeysSqlLiteral}::text,
            "changes"."rowIdentifier",
            "changes"."newComputedSortKey",
            "changes"."newRowData"
          ) AS "note"
        ) AS "effect"
        WHERE "changes"."hasNewRow"
          AND (
            NOT "changes"."hasOldRow"
            OR "changes"."oldComputedSortKey" IS DISTINCT FROM "changes"."newComputedSortKey"
            OR "changes"."oldRowData" IS DISTINCT FROM "changes"."newRowData"
          )
      `,
      sqlQuery`
        SELECT
          "groupKey" AS "groupKey",
          "rowIdentifier" AS "rowIdentifier",
          CASE
            WHEN "hasOldRow" THEN "oldComputedSortKey"
            ELSE 'null'::jsonb
          END AS "oldRowSortKey",
          CASE
            WHEN "hasNewRow" THEN "newComputedSortKey"
            ELSE 'null'::jsonb
          END AS "newRowSortKey",
          "oldRowData" AS "oldRowData",
          "newRowData" AS "newRowData"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)}
        WHERE ("hasOldRow" OR "hasNewRow")
          AND (
            NOT ("hasOldRow" AND "hasNewRow")
            OR "oldComputedSortKey" IS DISTINCT FROM "newComputedSortKey"
            OR "oldRowData" IS DISTINCT FROM "newRowData"
          )
      `.toStatement(sortChangesTableName),
      ...[...triggers.values()].flatMap((trigger) => trigger(quoteSqlIdentifier(sortChangesTableName))),
    ];
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "sort",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      getSortKeySql: options.getSortKey.sql,
      compareSortKeysSql: options.compareSortKeys(sqlExpression`$1`, sqlExpression`$2`).sql,
    },
    compareGroupKeys: options.fromTable.compareGroupKeys,
    compareSortKeys: options.compareSortKeys,
    init: () => {
      const fromGroupsTableName = `from_groups_${generateSecureRandomString()}`;
      const fromRowsTableName = `from_rows_${generateSecureRandomString()}`;
      const sortedRowsTableName = `sorted_rows_${generateSecureRandomString()}`;
      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${groupsPath}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
          ON CONFLICT ("keyPath") DO NOTHING
        `,
        options.fromTable.listGroups({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).toStatement(fromGroupsTableName),
        sqlQuery`
          SELECT
            "groups"."groupkey" AS "groupKey",
            "rows"."rowidentifier" AS "rowIdentifier",
            "rows"."rowsortkey" AS "oldSortKey",
            "rows"."rowdata" AS "rowData"
          FROM ${quoteSqlIdentifier(fromGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${options.fromTable.listRowsInGroup({
              groupKey: sqlExpression`"groups"."groupkey"`,
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            })}
          ) AS "rows"
        `.toStatement(fromRowsTableName),
        sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rowIdentifier" AS "rowIdentifier",
            "rows"."rowData" AS "rowData",
            to_jsonb("sortKey"."newSortKey") AS "rowSortKey"
          FROM ${quoteSqlIdentifier(fromRowsTableName)} AS "rows"
          CROSS JOIN LATERAL (
            SELECT "mapped"."newSortKey"
            FROM (
              SELECT ${options.getSortKey}
              FROM (
                SELECT
                  "rows"."rowIdentifier" AS "rowIdentifier",
                  "rows"."oldSortKey" AS "oldSortKey",
                  "rows"."rowData" AS "rowData"
              ) AS "sortInput"
            ) AS "mapped"
          ) AS "sortKey"
        `.toStatement(sortedRowsTableName),
        sqlStatement`
          INSERT INTO pg_temp.bulldozer_side_effects ("note")
          SELECT pg_temp.bulldozer_sort_bulk_init_from_table(
            ${groupsPath}::jsonb[],
            ${quoteSqlStringLiteral(sortedRowsTableName)}::text
          )
        `,
      ];
    },
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
        UNION ALL
        SELECT "BulldozerStorageEngine"."keyPath" AS "path"
        FROM "BulldozerStorageEngine"
        INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
      )
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
    `],
    isInitialized: () => isInitializedExpression,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey
      FROM "BulldozerStorageEngine" AS "groupPath"
      INNER JOIN "BulldozerStorageEngine" AS "groupMetadata"
        ON "groupMetadata"."keyPath" = ${getGroupMetadataPath(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`)}::jsonb[]
      WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
        AND COALESCE(("groupMetadata"."value"->>'rowCount')::int, 0) > 0
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
        }
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey != null ? sqlQuery`
      WITH RECURSIVE "orderedRows" AS (
        SELECT
          0 AS "rowIndex",
          ("headRow"."keyPath"[cardinality("headRow"."keyPath")] #>> '{}') AS "rowIdentifier",
          "headRow"."value" AS "nodeValue"
        FROM "BulldozerStorageEngine" AS "groupMetadata"
        INNER JOIN "BulldozerStorageEngine" AS "headRow"
          ON "headRow"."keyPath" = ${getGroupRowPath(groupKey, sqlExpression`to_jsonb("groupMetadata"."value"->>'headRowIdentifier')`)}::jsonb[]
        WHERE "groupMetadata"."keyPath" = ${getGroupMetadataPath(groupKey)}::jsonb[]
          AND ("groupMetadata"."value"->>'headRowIdentifier') IS NOT NULL

        UNION ALL

        SELECT
          "orderedRows"."rowIndex" + 1 AS "rowIndex",
          ("nextRow"."keyPath"[cardinality("nextRow"."keyPath")] #>> '{}') AS "rowIdentifier",
          "nextRow"."value" AS "nodeValue"
        FROM "orderedRows"
        INNER JOIN "BulldozerStorageEngine" AS "nextRow"
          ON "orderedRows"."nodeValue"->>'nextRowIdentifier' IS NOT NULL
          AND "nextRow"."keyPath" = ${getGroupRowPath(groupKey, sqlExpression`to_jsonb("orderedRows"."nodeValue"->>'nextRowIdentifier')`)}::jsonb[]
      )
      SELECT
        "orderedRows"."rowIdentifier" AS rowIdentifier,
        "orderedRows"."nodeValue"->'rowSortKey' AS rowSortKey,
        "orderedRows"."nodeValue"->'rowData' AS rowData
      FROM "orderedRows"
      WHERE ${sortRangePredicate(sqlExpression`"orderedRows"."nodeValue"->'rowSortKey'`, { start, end, startInclusive, endInclusive })}
      ORDER BY "orderedRows"."rowIndex" ASC
    ` : sqlQuery`
      WITH RECURSIVE "groupMetadatas" AS (
        SELECT
          "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS "groupKey",
          "groupMetadata"."value" AS "groupMetadataValue"
        FROM "BulldozerStorageEngine" AS "groupPath"
        INNER JOIN "BulldozerStorageEngine" AS "groupMetadata"
          ON "groupMetadata"."keyPath" = ${getGroupMetadataPath(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`)}::jsonb[]
        WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
          AND COALESCE(("groupMetadata"."value"->>'rowCount')::int, 0) > 0
          AND ${
            start === "start"
              ? sqlExpression`1 = 1`
              : startInclusive
                ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
                : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
          }
          AND ${
            end === "end"
              ? sqlExpression`1 = 1`
              : endInclusive
                ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
                : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
          }
      ),
      "orderedRows" AS (
        SELECT
          "groupMetadatas"."groupKey" AS "groupKey",
          0 AS "rowIndex",
          ("headRow"."keyPath"[cardinality("headRow"."keyPath")] #>> '{}') AS "rowIdentifier",
          "headRow"."value" AS "nodeValue"
        FROM "groupMetadatas"
        INNER JOIN "BulldozerStorageEngine" AS "headRow"
          ON ("groupMetadatas"."groupMetadataValue"->>'headRowIdentifier') IS NOT NULL
          AND "headRow"."keyPath" = ${getGroupRowPath(
            sqlExpression`"groupMetadatas"."groupKey"`,
            sqlExpression`to_jsonb("groupMetadatas"."groupMetadataValue"->>'headRowIdentifier')`,
          )}::jsonb[]

        UNION ALL

        SELECT
          "orderedRows"."groupKey" AS "groupKey",
          "orderedRows"."rowIndex" + 1 AS "rowIndex",
          ("nextRow"."keyPath"[cardinality("nextRow"."keyPath")] #>> '{}') AS "rowIdentifier",
          "nextRow"."value" AS "nodeValue"
        FROM "orderedRows"
        INNER JOIN "BulldozerStorageEngine" AS "nextRow"
          ON "orderedRows"."nodeValue"->>'nextRowIdentifier' IS NOT NULL
          AND "nextRow"."keyPath" = ${getGroupRowPath(
            sqlExpression`"orderedRows"."groupKey"`,
            sqlExpression`to_jsonb("orderedRows"."nodeValue"->>'nextRowIdentifier')`,
          )}::jsonb[]
      )
      SELECT
        "orderedRows"."groupKey" AS groupKey,
        "orderedRows"."rowIdentifier" AS rowIdentifier,
        "orderedRows"."nodeValue"->'rowSortKey' AS rowSortKey,
        "orderedRows"."nodeValue"->'rowData' AS rowData
      FROM "orderedRows"
      WHERE ${sortRangePredicate(sqlExpression`"orderedRows"."nodeValue"->'rowSortKey'`, { start, end, startInclusive, endInclusive })}
      ORDER BY "orderedRows"."groupKey" ASC, "orderedRows"."rowIndex" ASC
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
  };
}

/**
 * Materialized left-fold table.
 *
 * For each group, this table folds source rows in sort order (ties are deterministically broken by source
 * `rowIdentifier`) and stores the reducer output as flattened rows.
 *
 * Reducer contract:
 * - Input: `{ oldState, oldRowData }`
 * - Output: `{ newState, newRowsData }`
 *   - `newState` is carried into the next row in the same group.
 *   - `newRowsData` is flattened into output rows for the current source row.
 *
 * Output details:
 * - Output row sort key is the source row sort key.
 * - Output row identifier is `${sourceRowIdentifier}:${index}` (1-based index in `newRowsData`).
 *
 * Incremental behavior and performance:
 * - An internal sort table (treap-backed via `declareSortTable`) maintains source ordering.
 * - On source changes, LFold recomputes only the affected suffix in each touched group.
 * - If the first row changes, the full group is recomputed; if the last row changes, only the tail is.
 * - Per touched group complexity is roughly `O(log n + affectedRows * reducerCost + affectedOutputRows)`.
 */
export function declareLFoldTable<
  GK extends Json,
  SK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
  S extends Json,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, SK, OldRD>,
  initialState: SqlExpression<S>,
  reducer: SqlMapper<{ oldState: S, oldRowData: OldRD }, { newState: S, newRowsData: NewRD[] }>,
}): Table<GK, SK, NewRD> {
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const sourceSortTableId: TableId = {
    tableType: "internal",
    internalId: "lfold-source-sort",
    parent: options.tableId,
  };
  const sourceSortTable = declareSortTable({
    tableId: sourceSortTableId,
    fromTable: options.fromTable,
    getSortKey: sqlMapper`
      "oldSortKey" AS "newSortKey"
    `,
    compareSortKeys: options.fromTable.compareSortKeys,
  });
  const groupsPath = getStorageEnginePath(options.tableId, ["groups"]);
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const getGroupStatesPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "states"]);
  const getGroupStatePath = (groupKey: SqlExpression<Json>, sourceRowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "states", sourceRowIdentifier]);
  const getSourceSortGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(sourceSortTableId, ["groups", groupKey, "rows"]);
  const createExpandedRowIdentifier = (sourceRowIdentifier: SqlExpression<RowIdentifier>, flatIndex: SqlExpression<number>): SqlExpression<RowIdentifier> =>
    sqlExpression`(${sourceRowIdentifier} || ':' || (${flatIndex}::text))`;
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;
  const sortRangePredicate = (rowSortKey: SqlExpression<SK>, optionsForRange: {
    start: SqlExpression<SK> | "start",
    end: SqlExpression<SK> | "end",
    startInclusive: boolean,
    endInclusive: boolean,
  }) => sqlExpression`
    ${
      optionsForRange.start === "start"
        ? sqlExpression`1 = 1`
        : optionsForRange.startInclusive
          ? sqlExpression`${options.fromTable.compareSortKeys(rowSortKey, optionsForRange.start)} >= 0`
          : sqlExpression`${options.fromTable.compareSortKeys(rowSortKey, optionsForRange.start)} > 0`
    }
    AND ${
      optionsForRange.end === "end"
        ? sqlExpression`1 = 1`
        : optionsForRange.endInclusive
          ? sqlExpression`${options.fromTable.compareSortKeys(rowSortKey, optionsForRange.end)} <= 0`
          : sqlExpression`${options.fromTable.compareSortKeys(rowSortKey, optionsForRange.end)} < 0`
    }
  `;

  sourceSortTable.registerRowChangeTrigger((fromChangesTable) => {
    const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
    const boundaryCandidatesTableName = `boundary_candidates_${generateSecureRandomString()}`;
    const touchedGroupsTableName = `touched_groups_${generateSecureRandomString()}`;
    const currentSourceRowsTableName = `current_source_rows_${generateSecureRandomString()}`;
    const affectedSourceRowsTableName = `affected_source_rows_${generateSecureRandomString()}`;
    const firstAffectedRowsTableName = `first_affected_rows_${generateSecureRandomString()}`;
    const rowsToClearTableName = `rows_to_clear_${generateSecureRandomString()}`;
    const oldFoldRowsTableName = `old_fold_rows_${generateSecureRandomString()}`;
    const recomputedSourceStatesTableName = `recomputed_source_states_${generateSecureRandomString()}`;
    const newFoldRowsTableName = `new_fold_rows_${generateSecureRandomString()}`;
    const lfoldChangesTableName = `lfold_changes_${generateSecureRandomString()}`;

    return [
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."rowIdentifier" AS "rowIdentifier",
          "changes"."oldRowSortKey" AS "oldRowSortKey",
          "changes"."newRowSortKey" AS "newRowSortKey",
          "changes"."oldRowData" AS "oldRowData",
          "changes"."newRowData" AS "newRowData",
          "changes"."hasOldRow" AS "hasOldRow",
          "changes"."hasNewRow" AS "hasNewRow",
          (
            ("changes"."hasOldRow" OR "changes"."hasNewRow")
            AND (
              NOT ("changes"."hasOldRow" AND "changes"."hasNewRow")
              OR "changes"."oldRowSortKey" IS DISTINCT FROM "changes"."newRowSortKey"
              OR "changes"."oldRowData" IS DISTINCT FROM "changes"."newRowData"
            )
          ) AS "shouldRecompute"
        FROM (
          SELECT
            "changes"."groupKey" AS "groupKey",
            "changes"."rowIdentifier" AS "rowIdentifier",
            "changes"."oldRowSortKey" AS "oldRowSortKey",
            "changes"."newRowSortKey" AS "newRowSortKey",
            "changes"."oldRowData" AS "oldRowData",
            "changes"."newRowData" AS "newRowData",
            ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
            ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow"
          FROM ${fromChangesTable} AS "changes"
        ) AS "changes"
        WHERE ${isInitializedExpression}
      `.toStatement(normalizedChangesTableName),
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."oldRowSortKey" AS "boundarySortKey",
          "changes"."rowIdentifier" AS "boundaryRowIdentifier"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."shouldRecompute" AND "changes"."hasOldRow"

        UNION ALL

        SELECT
          "changes"."groupKey" AS "groupKey",
          "changes"."newRowSortKey" AS "boundarySortKey",
          "changes"."rowIdentifier" AS "boundaryRowIdentifier"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."shouldRecompute" AND "changes"."hasNewRow"
      `.toStatement(boundaryCandidatesTableName),
      sqlQuery`
        SELECT DISTINCT "groupKey"
        FROM ${quoteSqlIdentifier(boundaryCandidatesTableName)}
      `.toStatement(touchedGroupsTableName),
      sqlQuery`
        SELECT
          "groups"."groupKey" AS "groupKey",
          ("sourceRows"."keyPath"[cardinality("sourceRows"."keyPath")] #>> '{}') AS "rowIdentifier",
          "sourceRows"."value"->'rowSortKey' AS "rowSortKey",
          "sourceRows"."value"->'rowData' AS "rowData",
          "sourceRows"."value"->>'prevRowIdentifier' AS "prevRowIdentifier",
          "sourceRows"."value"->>'nextRowIdentifier' AS "nextRowIdentifier"
        FROM ${quoteSqlIdentifier(touchedGroupsTableName)} AS "groups"
        INNER JOIN "BulldozerStorageEngine" AS "sourceRows"
          ON "sourceRows"."keyPathParent" = ${getSourceSortGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
      `.toStatement(currentSourceRowsTableName),
      sqlQuery`
        SELECT DISTINCT
          "sourceRows"."groupKey" AS "groupKey",
          "sourceRows"."rowIdentifier" AS "rowIdentifier",
          "sourceRows"."rowSortKey" AS "rowSortKey",
          "sourceRows"."rowData" AS "rowData",
          "sourceRows"."prevRowIdentifier" AS "prevRowIdentifier",
          "sourceRows"."nextRowIdentifier" AS "nextRowIdentifier"
        FROM ${quoteSqlIdentifier(currentSourceRowsTableName)} AS "sourceRows"
        WHERE EXISTS (
          SELECT 1
          FROM ${quoteSqlIdentifier(boundaryCandidatesTableName)} AS "boundary"
          WHERE "boundary"."groupKey" IS NOT DISTINCT FROM "sourceRows"."groupKey"
            AND (
              ${options.fromTable.compareSortKeys(sqlExpression`"sourceRows"."rowSortKey"`, sqlExpression`"boundary"."boundarySortKey"`)} > 0
              OR (
                ${options.fromTable.compareSortKeys(sqlExpression`"sourceRows"."rowSortKey"`, sqlExpression`"boundary"."boundarySortKey"`)} = 0
                AND "sourceRows"."rowIdentifier" >= "boundary"."boundaryRowIdentifier"
              )
            )
        )
      `.toStatement(affectedSourceRowsTableName),
      sqlQuery`
        SELECT
          "affectedRows"."groupKey" AS "groupKey",
          "affectedRows"."rowIdentifier" AS "rowIdentifier",
          "affectedRows"."rowSortKey" AS "rowSortKey",
          "affectedRows"."rowData" AS "rowData",
          "affectedRows"."prevRowIdentifier" AS "prevRowIdentifier",
          "affectedRows"."nextRowIdentifier" AS "nextRowIdentifier"
        FROM ${quoteSqlIdentifier(affectedSourceRowsTableName)} AS "affectedRows"
        LEFT JOIN ${quoteSqlIdentifier(affectedSourceRowsTableName)} AS "affectedPrevRows"
          ON "affectedPrevRows"."groupKey" IS NOT DISTINCT FROM "affectedRows"."groupKey"
          AND "affectedPrevRows"."rowIdentifier" = "affectedRows"."prevRowIdentifier"
        WHERE "affectedPrevRows"."rowIdentifier" IS NULL
      `.toStatement(firstAffectedRowsTableName),
      sqlQuery`
        SELECT DISTINCT
          "rows"."groupKey" AS "groupKey",
          "rows"."rowIdentifier" AS "rowIdentifier"
        FROM ${quoteSqlIdentifier(affectedSourceRowsTableName)} AS "rows"

        UNION

        SELECT DISTINCT
          "changes"."groupKey" AS "groupKey",
          "changes"."rowIdentifier" AS "rowIdentifier"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."shouldRecompute" AND "changes"."hasOldRow"
      `.toStatement(rowsToClearTableName),
      sqlQuery`
        SELECT
          "rowsToClear"."groupKey" AS "groupKey",
          ${createExpandedRowIdentifier(
            sqlExpression`"rowsToClear"."rowIdentifier"`,
            sqlExpression`"flatRow"."flatIndex"`,
          )} AS "rowIdentifier",
          "stateRows"."value"->'rowSortKey' AS "rowSortKey",
          "flatRow"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(rowsToClearTableName)} AS "rowsToClear"
        INNER JOIN "BulldozerStorageEngine" AS "stateRows"
          ON "stateRows"."keyPath" = ${getGroupStatePath(
            sqlExpression`"rowsToClear"."groupKey"`,
            sqlExpression`to_jsonb("rowsToClear"."rowIdentifier"::text)`,
          )}::jsonb[]
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("stateRows"."value"->'emittedRowsData') = 'array' THEN "stateRows"."value"->'emittedRowsData'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      `.toStatement(oldFoldRowsTableName),
      sqlQuery`
        WITH RECURSIVE "recomputedRows" AS (
          SELECT
            "firstRows"."groupKey" AS "groupKey",
            "firstRows"."rowIdentifier" AS "rowIdentifier",
            "firstRows"."rowSortKey" AS "rowSortKey",
            "firstRows"."rowData" AS "rowData",
            "firstRows"."nextRowIdentifier" AS "nextRowIdentifier",
            "seed"."oldState" AS "oldState",
            "reduced"."newState" AS "newState",
            "reduced"."newRowsData" AS "newRowsData"
          FROM ${quoteSqlIdentifier(firstAffectedRowsTableName)} AS "firstRows"
          LEFT JOIN "BulldozerStorageEngine" AS "prevStateRows"
            ON "firstRows"."prevRowIdentifier" IS NOT NULL
            AND "prevStateRows"."keyPath" = ${getGroupStatePath(
              sqlExpression`"firstRows"."groupKey"`,
              sqlExpression`to_jsonb("firstRows"."prevRowIdentifier"::text)`,
            )}::jsonb[]
          CROSS JOIN LATERAL (
            SELECT
              CASE
                WHEN "firstRows"."prevRowIdentifier" IS NULL THEN to_jsonb(${options.initialState})
                ELSE COALESCE("prevStateRows"."value"->'stateAfter', to_jsonb(${options.initialState}))
              END AS "oldState"
          ) AS "seed"
          CROSS JOIN LATERAL (
            SELECT
              to_jsonb("reducerRows"."newState") AS "newState",
              CASE
                WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                ELSE '[]'::jsonb
              END AS "newRowsData"
            FROM (
              SELECT ${options.reducer}
              FROM (
                SELECT
                  "seed"."oldState" AS "oldState",
                  "firstRows"."rowData" AS "oldRowData"
              ) AS "reducerInput"
            ) AS "reducerRows"
          ) AS "reduced"

          UNION ALL

          SELECT
            "nextRows"."groupKey" AS "groupKey",
            "nextRows"."rowIdentifier" AS "rowIdentifier",
            "nextRows"."rowSortKey" AS "rowSortKey",
            "nextRows"."rowData" AS "rowData",
            "nextRows"."nextRowIdentifier" AS "nextRowIdentifier",
            "recomputedRows"."newState" AS "oldState",
            "reduced"."newState" AS "newState",
            "reduced"."newRowsData" AS "newRowsData"
          FROM "recomputedRows"
          INNER JOIN ${quoteSqlIdentifier(currentSourceRowsTableName)} AS "nextRows"
            ON "nextRows"."groupKey" IS NOT DISTINCT FROM "recomputedRows"."groupKey"
            AND "nextRows"."rowIdentifier" = "recomputedRows"."nextRowIdentifier"
          CROSS JOIN LATERAL (
            SELECT
              to_jsonb("reducerRows"."newState") AS "newState",
              CASE
                WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                ELSE '[]'::jsonb
              END AS "newRowsData"
            FROM (
              SELECT ${options.reducer}
              FROM (
                SELECT
                  "recomputedRows"."newState" AS "oldState",
                  "nextRows"."rowData" AS "oldRowData"
              ) AS "reducerInput"
            ) AS "reducerRows"
          ) AS "reduced"
        )
        SELECT
          "groupKey" AS "groupKey",
          "rowIdentifier" AS "rowIdentifier",
          "rowSortKey" AS "rowSortKey",
          "newState" AS "stateAfter",
          "newRowsData" AS "emittedRowsData"
        FROM "recomputedRows"
      `.toStatement(recomputedSourceStatesTableName),
      sqlQuery`
        SELECT
          "states"."groupKey" AS "groupKey",
          ${createExpandedRowIdentifier(
            sqlExpression`"states"."rowIdentifier"`,
            sqlExpression`"flatRow"."flatIndex"`,
          )} AS "rowIdentifier",
          "states"."rowSortKey" AS "rowSortKey",
          "flatRow"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)} AS "states"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("states"."emittedRowsData") = 'array' THEN "states"."emittedRowsData"
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
      `.toStatement(newFoldRowsTableName),
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          "insertRows"."keyPath",
          "insertRows"."value"
        FROM (
          SELECT DISTINCT
            ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupStatesPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newFoldRowsTableName)}
          UNION
          SELECT DISTINCT
            ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM ${quoteSqlIdentifier(newFoldRowsTableName)}
        ) AS "insertRows"
        ON CONFLICT ("keyPath") DO NOTHING
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "targetRows"
        USING ${quoteSqlIdentifier(oldFoldRowsTableName)} AS "oldRows"
        WHERE "targetRows"."keyPath" = ${getGroupRowPath(
          sqlExpression`"oldRows"."groupKey"`,
          sqlExpression`to_jsonb("oldRows"."rowIdentifier"::text)`,
        )}::jsonb[]
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "targetStates"
        USING ${quoteSqlIdentifier(rowsToClearTableName)} AS "rowsToClear"
        WHERE "targetStates"."keyPath" = ${getGroupStatePath(
          sqlExpression`"rowsToClear"."groupKey"`,
          sqlExpression`to_jsonb("rowsToClear"."rowIdentifier"::text)`,
        )}::jsonb[]
      `,
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          ${getGroupStatePath(
            sqlExpression`"states"."groupKey"`,
            sqlExpression`to_jsonb("states"."rowIdentifier"::text)`,
          )}::jsonb[],
          jsonb_build_object(
            'rowSortKey', "states"."rowSortKey",
            'stateAfter', "states"."stateAfter",
            'emittedRowsData', "states"."emittedRowsData"
          )
        FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)} AS "states"
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          ${getGroupRowPath(
            sqlExpression`"rows"."groupKey"`,
            sqlExpression`to_jsonb("rows"."rowIdentifier"::text)`,
          )}::jsonb[],
          jsonb_build_object(
            'rowSortKey', "rows"."rowSortKey",
            'rowData', "rows"."rowData"
          )
        FROM ${quoteSqlIdentifier(newFoldRowsTableName)} AS "rows"
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `,
      sqlStatement`
        DELETE FROM "BulldozerStorageEngine" AS "staleGroupPaths"
        USING ${quoteSqlIdentifier(touchedGroupsTableName)} AS "groups"
        WHERE "staleGroupPaths"."keyPath" IN (
          ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[],
          ${getGroupStatesPath(sqlExpression`"groups"."groupKey"`)}::jsonb[],
          ${getGroupKeyPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        )
          AND NOT EXISTS (
            SELECT 1
            FROM "BulldozerStorageEngine" AS "stateRows"
            WHERE "stateRows"."keyPathParent" = ${getGroupStatesPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "BulldozerStorageEngine" AS "foldRows"
            WHERE "foldRows"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
          )
      `,
      sqlQuery`
        SELECT
          COALESCE("newRows"."groupKey", "oldRows"."groupKey") AS "groupKey",
          COALESCE("newRows"."rowIdentifier", "oldRows"."rowIdentifier") AS "rowIdentifier",
          CASE WHEN "oldRows"."rowSortKey" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowSortKey" END AS "oldRowSortKey",
          CASE WHEN "newRows"."rowSortKey" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowSortKey" END AS "newRowSortKey",
          CASE WHEN "oldRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowData" END AS "oldRowData",
          CASE WHEN "newRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowData" END AS "newRowData"
        FROM ${quoteSqlIdentifier(oldFoldRowsTableName)} AS "oldRows"
        FULL OUTER JOIN ${quoteSqlIdentifier(newFoldRowsTableName)} AS "newRows"
          ON "oldRows"."groupKey" IS NOT DISTINCT FROM "newRows"."groupKey"
          AND "oldRows"."rowIdentifier" = "newRows"."rowIdentifier"
        WHERE "oldRows"."rowSortKey" IS DISTINCT FROM "newRows"."rowSortKey"
          OR "oldRows"."rowData" IS DISTINCT FROM "newRows"."rowData"
      `.toStatement(lfoldChangesTableName),
      ...[...triggers.values()].flatMap((trigger) => trigger(quoteSqlIdentifier(lfoldChangesTableName))),
    ];
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "lfold",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      initialStateSql: options.initialState.sql,
      reducerSql: options.reducer.sql,
    },
    compareGroupKeys: options.fromTable.compareGroupKeys,
    compareSortKeys: options.fromTable.compareSortKeys,
    init: () => {
      const allSourceRowsTableName = `all_source_rows_${generateSecureRandomString()}`;
      const firstSourceRowsTableName = `first_source_rows_${generateSecureRandomString()}`;
      const recomputedSourceStatesTableName = `recomputed_source_states_${generateSecureRandomString()}`;
      const newFoldRowsTableName = `new_fold_rows_${generateSecureRandomString()}`;
      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${sqlArray([...getTablePathSegments(options.tableId), quoteSqlJsonbLiteral("table")])}::jsonb[], 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${groupsPath}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        ...sourceSortTable.init(),
        sqlQuery`
          SELECT
            "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS "groupKey",
            ("sourceRows"."keyPath"[cardinality("sourceRows"."keyPath")] #>> '{}') AS "rowIdentifier",
            "sourceRows"."value"->'rowSortKey' AS "rowSortKey",
            "sourceRows"."value"->'rowData' AS "rowData",
            "sourceRows"."value"->>'prevRowIdentifier' AS "prevRowIdentifier",
            "sourceRows"."value"->>'nextRowIdentifier' AS "nextRowIdentifier"
          FROM "BulldozerStorageEngine" AS "groupPath"
          INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
            ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
          INNER JOIN "BulldozerStorageEngine" AS "sourceRows"
            ON "sourceRows"."keyPathParent" = "groupRowsPath"."keyPath"
          WHERE "groupPath"."keyPathParent" = ${getStorageEnginePath(sourceSortTableId, ["groups"])}::jsonb[]
            AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        `.toStatement(allSourceRowsTableName),
        sqlQuery`
          SELECT
            "sourceRows"."groupKey" AS "groupKey",
            "sourceRows"."rowIdentifier" AS "rowIdentifier",
            "sourceRows"."rowSortKey" AS "rowSortKey",
            "sourceRows"."rowData" AS "rowData",
            "sourceRows"."prevRowIdentifier" AS "prevRowIdentifier",
            "sourceRows"."nextRowIdentifier" AS "nextRowIdentifier"
          FROM ${quoteSqlIdentifier(allSourceRowsTableName)} AS "sourceRows"
          WHERE "sourceRows"."prevRowIdentifier" IS NULL
        `.toStatement(firstSourceRowsTableName),
        sqlQuery`
          WITH RECURSIVE "recomputedRows" AS (
            SELECT
              "firstRows"."groupKey" AS "groupKey",
              "firstRows"."rowIdentifier" AS "rowIdentifier",
              "firstRows"."rowSortKey" AS "rowSortKey",
              "firstRows"."rowData" AS "rowData",
              "firstRows"."nextRowIdentifier" AS "nextRowIdentifier",
              to_jsonb(${options.initialState}) AS "oldState",
              "reduced"."newState" AS "newState",
              "reduced"."newRowsData" AS "newRowsData"
            FROM ${quoteSqlIdentifier(firstSourceRowsTableName)} AS "firstRows"
            CROSS JOIN LATERAL (
              SELECT
                to_jsonb("reducerRows"."newState") AS "newState",
                CASE
                  WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                  ELSE '[]'::jsonb
                END AS "newRowsData"
              FROM (
                SELECT ${options.reducer}
                FROM (
                  SELECT
                    to_jsonb(${options.initialState}) AS "oldState",
                    "firstRows"."rowData" AS "oldRowData"
                ) AS "reducerInput"
              ) AS "reducerRows"
            ) AS "reduced"

            UNION ALL

            SELECT
              "nextRows"."groupKey" AS "groupKey",
              "nextRows"."rowIdentifier" AS "rowIdentifier",
              "nextRows"."rowSortKey" AS "rowSortKey",
              "nextRows"."rowData" AS "rowData",
              "nextRows"."nextRowIdentifier" AS "nextRowIdentifier",
              "recomputedRows"."newState" AS "oldState",
              "reduced"."newState" AS "newState",
              "reduced"."newRowsData" AS "newRowsData"
            FROM "recomputedRows"
            INNER JOIN ${quoteSqlIdentifier(allSourceRowsTableName)} AS "nextRows"
              ON "nextRows"."groupKey" IS NOT DISTINCT FROM "recomputedRows"."groupKey"
              AND "nextRows"."rowIdentifier" = "recomputedRows"."nextRowIdentifier"
            CROSS JOIN LATERAL (
              SELECT
                to_jsonb("reducerRows"."newState") AS "newState",
                CASE
                  WHEN jsonb_typeof(to_jsonb("reducerRows"."newRowsData")) = 'array' THEN to_jsonb("reducerRows"."newRowsData")
                  ELSE '[]'::jsonb
                END AS "newRowsData"
              FROM (
                SELECT ${options.reducer}
                FROM (
                  SELECT
                    "recomputedRows"."newState" AS "oldState",
                    "nextRows"."rowData" AS "oldRowData"
                ) AS "reducerInput"
              ) AS "reducerRows"
            ) AS "reduced"
          )
          SELECT
            "groupKey" AS "groupKey",
            "rowIdentifier" AS "rowIdentifier",
            "rowSortKey" AS "rowSortKey",
            "newState" AS "stateAfter",
            "newRowsData" AS "emittedRowsData"
          FROM "recomputedRows"
        `.toStatement(recomputedSourceStatesTableName),
        sqlQuery`
          SELECT
            "states"."groupKey" AS "groupKey",
            ${createExpandedRowIdentifier(
              sqlExpression`"states"."rowIdentifier"`,
              sqlExpression`"flatRow"."flatIndex"`,
            )} AS "rowIdentifier",
            "states"."rowSortKey" AS "rowSortKey",
            "flatRow"."rowData" AS "rowData"
          FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)} AS "states"
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof("states"."emittedRowsData") = 'array' THEN "states"."emittedRowsData"
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
        `.toStatement(newFoldRowsTableName),
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            "insertRows"."keyPath",
            "insertRows"."value"
          FROM (
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupStatesPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(newFoldRowsTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(newFoldRowsTableName)}
          ) AS "insertRows"
          ON CONFLICT ("keyPath") DO NOTHING
        `,
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            ${getGroupStatePath(
              sqlExpression`"states"."groupKey"`,
              sqlExpression`to_jsonb("states"."rowIdentifier"::text)`,
            )}::jsonb[],
            jsonb_build_object(
              'rowSortKey', "states"."rowSortKey",
              'stateAfter', "states"."stateAfter",
              'emittedRowsData', "states"."emittedRowsData"
            )
          FROM ${quoteSqlIdentifier(recomputedSourceStatesTableName)} AS "states"
          ON CONFLICT ("keyPath") DO UPDATE
          SET "value" = EXCLUDED."value"
        `,
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            ${getGroupRowPath(
              sqlExpression`"rows"."groupKey"`,
              sqlExpression`to_jsonb("rows"."rowIdentifier"::text)`,
            )}::jsonb[],
            jsonb_build_object(
              'rowSortKey', "rows"."rowSortKey",
              'rowData', "rows"."rowData"
            )
          FROM ${quoteSqlIdentifier(newFoldRowsTableName)} AS "rows"
          ON CONFLICT ("keyPath") DO UPDATE
          SET "value" = EXCLUDED."value"
        `,
      ];
    },
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
        UNION ALL
        SELECT "BulldozerStorageEngine"."keyPath" AS "path"
        FROM "BulldozerStorageEngine"
        INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
      )
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
    `],
    isInitialized: () => isInitializedExpression,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey
      FROM "BulldozerStorageEngine" AS "groupPath"
      WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
        AND EXISTS (
          SELECT 1
          FROM "BulldozerStorageEngine" AS "groupRowsPath"
          INNER JOIN "BulldozerStorageEngine" AS "groupRow"
            ON "groupRow"."keyPathParent" = "groupRowsPath"."keyPath"
          WHERE "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
            AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        )
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
              : sqlExpression`${options.fromTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
        }
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey ? sqlQuery`
      SELECT
        ("row"."keyPath"[cardinality("row"."keyPath")] #>> '{}') AS rowIdentifier,
        "row"."value"->'rowSortKey' AS rowSortKey,
        "row"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "row"
      WHERE "row"."keyPathParent" = ${getGroupRowsPath(groupKey)}::jsonb[]
        AND ${sortRangePredicate(sqlExpression`"row"."value"->'rowSortKey'`, { start, end, startInclusive, endInclusive })}
      ORDER BY rowSortKey ASC, rowIdentifier ASC
    ` : sqlQuery`
      SELECT
        "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        "rows"."value"->'rowSortKey' AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupPath"
      INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
        ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
      INNER JOIN "BulldozerStorageEngine" AS "rows"
        ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
      WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
        AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        AND ${sortRangePredicate(sqlExpression`"rows"."value"->'rowSortKey'`, { start, end, startInclusive, endInclusive })}
      ORDER BY groupKey ASC, rowSortKey ASC, rowIdentifier ASC
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
  };
}

export function declareLeftJoinTable<
  GK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
>(options: {
  tableId: TableId,
  leftTable: Table<GK, any, OldRD>,
  rightTable: Table<GK, any, NewRD>,
  on: SqlPredicate<{ leftRowIdentifier: RowIdentifier, leftRowData: OldRD, rightRowIdentifier: RowIdentifier | null, rightRowData: NewRD | null }>,
}): Table<GK, null, { leftRowData: OldRD, rightRowData: NewRD | null }> {
  const triggers = new Map<string, (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]>();
  const groupsPath = getStorageEnginePath(options.tableId, ["groups"]);
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const createJoinedRowIdentifier = (
    leftRowIdentifier: SqlExpression<RowIdentifier>,
    rightRowIdentifier: SqlExpression<RowIdentifier | null>,
  ): SqlExpression<RowIdentifier> => sqlExpression`
    (
      jsonb_build_array(
        to_jsonb(${leftRowIdentifier}::text),
        CASE
          WHEN ${rightRowIdentifier} IS NULL THEN 'null'::jsonb
          ELSE to_jsonb(${rightRowIdentifier}::text)
        END
      ) #>> '{}'
    )
  `;
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;
  const createJoinedRowsStatement = (optionsForStatement: {
    leftRowsTableName: string,
    rightRowsTableName: string,
    outputTableName: string,
  }): SqlStatement => sqlQuery`
    SELECT DISTINCT ON ("joinedRows"."groupKey", "joinedRows"."rowIdentifier")
      "joinedRows"."groupKey" AS "groupKey",
      "joinedRows"."rowIdentifier" AS "rowIdentifier",
      "joinedRows"."rowData" AS "rowData"
    FROM (
      SELECT
        "leftRows"."groupKey" AS "groupKey",
        ${createJoinedRowIdentifier(
          sqlExpression`"leftRows"."leftRowIdentifier"`,
          sqlExpression`"rightRows"."rightRowIdentifier"`,
        )} AS "rowIdentifier",
        jsonb_build_object(
          'leftRowData', "leftRows"."leftRowData",
          'rightRowData', "rightRows"."rightRowData"
        ) AS "rowData"
      FROM ${quoteSqlIdentifier(optionsForStatement.leftRowsTableName)} AS "leftRows"
      LEFT JOIN ${quoteSqlIdentifier(optionsForStatement.rightRowsTableName)} AS "rightRows"
        ON "rightRows"."groupKey" IS NOT DISTINCT FROM "leftRows"."groupKey"
        AND (
          SELECT ${options.on}
          FROM (
            SELECT
              "leftRows"."leftRowIdentifier" AS "leftRowIdentifier",
              "leftRows"."leftRowData" AS "leftRowData",
              "rightRows"."rightRowIdentifier" AS "rightRowIdentifier",
              "rightRows"."rightRowData" AS "rightRowData"
          ) AS "joinPredicateInput"
        )
    ) AS "joinedRows"
    ORDER BY "joinedRows"."groupKey", "joinedRows"."rowIdentifier"
  `.toStatement(optionsForStatement.outputTableName);

  const registerInputTrigger = <InputRD extends RowData>(optionsForTrigger: {
    inputTable: Table<GK, any, InputRD>,
    changedSide: "left" | "right",
  }) => {
    optionsForTrigger.inputTable.registerRowChangeTrigger((inputChangesTable) => {
      const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
      const affectedGroupsTableName = `affected_groups_${generateSecureRandomString()}`;
      const oldLeftJoinRowsTableName = `old_left_join_rows_${generateSecureRandomString()}`;
      const oldLeftRowsTableName = `old_left_rows_${generateSecureRandomString()}`;
      const oldRightRowsTableName = `old_right_rows_${generateSecureRandomString()}`;
      const newLeftRowsTableName = `new_left_rows_${generateSecureRandomString()}`;
      const newRightRowsTableName = `new_right_rows_${generateSecureRandomString()}`;
      const newLeftJoinRowsTableName = `new_left_join_rows_${generateSecureRandomString()}`;
      const leftJoinChangesTableName = `left_join_changes_${generateSecureRandomString()}`;

      return [
        sqlQuery`
          SELECT
            "changes"."groupKey" AS "groupKey",
            "changes"."rowIdentifier" AS "rowIdentifier",
            "changes"."oldRowData" AS "oldRowData",
            "changes"."newRowData" AS "newRowData",
            ("changes"."oldRowData" IS NOT NULL AND jsonb_typeof("changes"."oldRowData") = 'object') AS "hasOldRow",
            ("changes"."newRowData" IS NOT NULL AND jsonb_typeof("changes"."newRowData") = 'object') AS "hasNewRow"
          FROM ${inputChangesTable} AS "changes"
          WHERE ${isInitializedExpression}
        `.toStatement(normalizedChangesTableName),
        sqlQuery`
          SELECT DISTINCT "changes"."groupKey" AS "groupKey"
          FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
          WHERE "changes"."hasOldRow" OR "changes"."hasNewRow"
        `.toStatement(affectedGroupsTableName),
        sqlQuery`
          SELECT
            "groups"."groupKey" AS "groupKey",
            ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS "rowIdentifier",
            "rows"."value"->'rowData' AS "rowData"
          FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
          INNER JOIN "BulldozerStorageEngine" AS "rows"
            ON "rows"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        `.toStatement(oldLeftJoinRowsTableName),
        sqlQuery`
          SELECT
            "groups"."groupKey" AS "groupKey",
            "rows"."rowidentifier" AS "leftRowIdentifier",
            "rows"."rowdata" AS "leftRowData"
          FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${options.leftTable.listRowsInGroup({
              groupKey: sqlExpression`"groups"."groupKey"`,
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            })}
          ) AS "rows"
        `.toStatement(oldLeftRowsTableName),
        sqlQuery`
          SELECT
            "groups"."groupKey" AS "groupKey",
            "rows"."rowidentifier" AS "rightRowIdentifier",
            "rows"."rowdata" AS "rightRowData"
          FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${options.rightTable.listRowsInGroup({
              groupKey: sqlExpression`"groups"."groupKey"`,
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            })}
          ) AS "rows"
        `.toStatement(oldRightRowsTableName),
        optionsForTrigger.changedSide === "left" ? sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."leftRowIdentifier" AS "leftRowIdentifier",
            "rows"."leftRowData" AS "leftRowData"
          FROM ${quoteSqlIdentifier(oldLeftRowsTableName)} AS "rows"
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
            WHERE "changes"."hasOldRow"
              AND "changes"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
              AND "changes"."rowIdentifier" = "rows"."leftRowIdentifier"
          )
          UNION ALL
          SELECT
            "changes"."groupKey" AS "groupKey",
            "changes"."rowIdentifier" AS "leftRowIdentifier",
            "changes"."newRowData" AS "leftRowData"
          FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
          WHERE "changes"."hasNewRow"
        `.toStatement(newLeftRowsTableName) : sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."leftRowIdentifier" AS "leftRowIdentifier",
            "rows"."leftRowData" AS "leftRowData"
          FROM ${quoteSqlIdentifier(oldLeftRowsTableName)} AS "rows"
        `.toStatement(newLeftRowsTableName),
        optionsForTrigger.changedSide === "right" ? sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rightRowIdentifier" AS "rightRowIdentifier",
            "rows"."rightRowData" AS "rightRowData"
          FROM ${quoteSqlIdentifier(oldRightRowsTableName)} AS "rows"
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
            WHERE "changes"."hasOldRow"
              AND "changes"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
              AND "changes"."rowIdentifier" = "rows"."rightRowIdentifier"
          )
          UNION ALL
          SELECT
            "changes"."groupKey" AS "groupKey",
            "changes"."rowIdentifier" AS "rightRowIdentifier",
            "changes"."newRowData" AS "rightRowData"
          FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
          WHERE "changes"."hasNewRow"
        `.toStatement(newRightRowsTableName) : sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rightRowIdentifier" AS "rightRowIdentifier",
            "rows"."rightRowData" AS "rightRowData"
          FROM ${quoteSqlIdentifier(oldRightRowsTableName)} AS "rows"
        `.toStatement(newRightRowsTableName),
        createJoinedRowsStatement({
          leftRowsTableName: newLeftRowsTableName,
          rightRowsTableName: newRightRowsTableName,
          outputTableName: newLeftJoinRowsTableName,
        }),
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            "insertRows"."keyPath",
            "insertRows"."value"
          FROM (
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(newLeftJoinRowsTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(newLeftJoinRowsTableName)}
          ) AS "insertRows"
          ON CONFLICT ("keyPath") DO NOTHING
        `,
        sqlStatement`
          DELETE FROM "BulldozerStorageEngine" AS "target"
          USING ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
          WHERE "target"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        `,
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            ${getGroupRowPath(
              sqlExpression`"groupKey"`,
              sqlExpression`to_jsonb("rowIdentifier"::text)`,
            )}::jsonb[],
            jsonb_build_object('rowData', "rowData")
          FROM ${quoteSqlIdentifier(newLeftJoinRowsTableName)}
          ON CONFLICT ("keyPath") DO UPDATE
          SET "value" = EXCLUDED."value"
        `,
        sqlStatement`
          DELETE FROM "BulldozerStorageEngine" AS "staleGroupPath"
          USING ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
          WHERE "staleGroupPath"."keyPath" IN (
            ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[],
            ${getGroupKeyPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
          )
            AND NOT EXISTS (
              SELECT 1
              FROM ${quoteSqlIdentifier(newLeftJoinRowsTableName)} AS "newRows"
              WHERE "newRows"."groupKey" IS NOT DISTINCT FROM "groups"."groupKey"
            )
        `,
        sqlQuery`
          SELECT
            COALESCE("newRows"."groupKey", "oldRows"."groupKey") AS "groupKey",
            COALESCE("newRows"."rowIdentifier", "oldRows"."rowIdentifier") AS "rowIdentifier",
            'null'::jsonb AS "oldRowSortKey",
            'null'::jsonb AS "newRowSortKey",
            CASE WHEN "oldRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "oldRows"."rowData" END AS "oldRowData",
            CASE WHEN "newRows"."rowData" IS NULL THEN 'null'::jsonb ELSE "newRows"."rowData" END AS "newRowData"
          FROM ${quoteSqlIdentifier(oldLeftJoinRowsTableName)} AS "oldRows"
          FULL OUTER JOIN ${quoteSqlIdentifier(newLeftJoinRowsTableName)} AS "newRows"
            ON "oldRows"."groupKey" IS NOT DISTINCT FROM "newRows"."groupKey"
            AND "oldRows"."rowIdentifier" = "newRows"."rowIdentifier"
          WHERE "oldRows"."rowData" IS DISTINCT FROM "newRows"."rowData"
        `.toStatement(leftJoinChangesTableName),
        ...[...triggers.values()].flatMap((trigger) => trigger(quoteSqlIdentifier(leftJoinChangesTableName))),
      ];
    });
  };

  registerInputTrigger({
    inputTable: options.leftTable,
    changedSide: "left",
  });
  registerInputTrigger({
    inputTable: options.rightTable,
    changedSide: "right",
  });

  return {
    tableId: options.tableId,
    inputTables: [options.leftTable, options.rightTable],
    debugArgs: {
      operator: "leftJoin",
      tableId: tableIdToDebugString(options.tableId),
      leftTableId: tableIdToDebugString(options.leftTable.tableId),
      rightTableId: tableIdToDebugString(options.rightTable.tableId),
      onSql: options.on.sql,
    },
    compareGroupKeys: options.leftTable.compareGroupKeys,
    compareSortKeys: () => sqlExpression`0`,
    init: () => {
      const leftGroupsTableName = `left_groups_${generateSecureRandomString()}`;
      const leftRowsTableName = `left_rows_${generateSecureRandomString()}`;
      const rightRowsTableName = `right_rows_${generateSecureRandomString()}`;
      const leftJoinedRowsTableName = `left_joined_rows_${generateSecureRandomString()}`;

      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${groupsPath}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        options.leftTable.listGroups({
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).toStatement(leftGroupsTableName),
        sqlQuery`
          SELECT
            "groups"."groupkey" AS "groupKey",
            "rows"."rowidentifier" AS "leftRowIdentifier",
            "rows"."rowdata" AS "leftRowData"
          FROM ${quoteSqlIdentifier(leftGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${options.leftTable.listRowsInGroup({
              groupKey: sqlExpression`"groups"."groupkey"`,
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            })}
          ) AS "rows"
        `.toStatement(leftRowsTableName),
        sqlQuery`
          SELECT
            "groups"."groupkey" AS "groupKey",
            "rows"."rowidentifier" AS "rightRowIdentifier",
            "rows"."rowdata" AS "rightRowData"
          FROM ${quoteSqlIdentifier(leftGroupsTableName)} AS "groups"
          CROSS JOIN LATERAL (
            ${options.rightTable.listRowsInGroup({
              groupKey: sqlExpression`"groups"."groupkey"`,
              start: "start",
              end: "end",
              startInclusive: true,
              endInclusive: true,
            })}
          ) AS "rows"
        `.toStatement(rightRowsTableName),
        createJoinedRowsStatement({
          leftRowsTableName,
          rightRowsTableName,
          outputTableName: leftJoinedRowsTableName,
        }),
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            "insertRows"."keyPath",
            "insertRows"."value"
          FROM (
            SELECT DISTINCT
              ${getGroupKeyPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(leftJoinedRowsTableName)}
            UNION
            SELECT DISTINCT
              ${getGroupRowsPath(sqlExpression`"groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM ${quoteSqlIdentifier(leftJoinedRowsTableName)}
            UNION
            SELECT
              ${getGroupRowPath(
                sqlExpression`"groupKey"`,
                sqlExpression`to_jsonb("rowIdentifier"::text)`,
              )}::jsonb[] AS "keyPath",
              jsonb_build_object('rowData', "rowData") AS "value"
            FROM ${quoteSqlIdentifier(leftJoinedRowsTableName)}
          ) AS "insertRows"
        `,
      ];
    },
    delete: () => [sqlStatement`
      WITH RECURSIVE "pathsToDelete" AS (
        SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
        UNION ALL
        SELECT "BulldozerStorageEngine"."keyPath" AS "path"
        FROM "BulldozerStorageEngine"
        INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
      )
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
    `],
    isInitialized: () => isInitializedExpression,
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey
      FROM "BulldozerStorageEngine" AS "groupPath"
      WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
        AND EXISTS (
          SELECT 1
          FROM "BulldozerStorageEngine" AS "groupRowsPath"
          INNER JOIN "BulldozerStorageEngine" AS "groupRow"
            ON "groupRow"."keyPathParent" = "groupRowsPath"."keyPath"
          WHERE "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
            AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        )
        AND ${
          start === "start"
            ? sqlExpression`1 = 1`
            : startInclusive
              ? sqlExpression`${options.leftTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
              : sqlExpression`${options.leftTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${options.leftTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
              : sqlExpression`${options.leftTable.compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
        }
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey ? sqlQuery`
      SELECT
        ("row"."keyPath"[cardinality("row"."keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "row"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "row"
      WHERE "row"."keyPathParent" = ${getGroupRowsPath(groupKey)}::jsonb[]
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    ` : sqlQuery`
      SELECT
        "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupPath"
      INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
        ON "groupRowsPath"."keyPathParent" = "groupPath"."keyPath"
      INNER JOIN "BulldozerStorageEngine" AS "rows"
        ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
      WHERE "groupPath"."keyPathParent" = ${groupsPath}::jsonb[]
        AND "groupRowsPath"."keyPath"[cardinality("groupRowsPath"."keyPath")] = to_jsonb('rows'::text)
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
  };
}

// ====== Executing SQL Statements ======
const BULLDOZER_LOCK_ID = 7857391;  // random number to avoid conflicts with other applications
const BULLDOZER_SORT_HELPERS_SQL = deindent`
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.bulldozer_side_effects (
    "note" text
  ) ON COMMIT DROP;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_group_path(groups_path jsonb[], group_key jsonb)
  RETURNS jsonb[] LANGUAGE sql IMMUTABLE AS $$
    SELECT groups_path || ARRAY[group_key]::jsonb[]
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_group_metadata_path(groups_path jsonb[], group_key jsonb)
  RETURNS jsonb[] LANGUAGE sql IMMUTABLE AS $$
    SELECT pg_temp.bulldozer_sort_group_path(groups_path, group_key) || ARRAY[to_jsonb('metadata'::text)]::jsonb[]
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_group_rows_path(groups_path jsonb[], group_key jsonb)
  RETURNS jsonb[] LANGUAGE sql IMMUTABLE AS $$
    SELECT pg_temp.bulldozer_sort_group_path(groups_path, group_key) || ARRAY[to_jsonb('rows'::text)]::jsonb[]
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_group_row_path(groups_path jsonb[], group_key jsonb, row_identifier text)
  RETURNS jsonb[] LANGUAGE sql IMMUTABLE AS $$
    SELECT pg_temp.bulldozer_sort_group_rows_path(groups_path, group_key) || ARRAY[to_jsonb(row_identifier)]::jsonb[]
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_nullable_text_jsonb(input_text text)
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
      WHEN input_text IS NULL THEN 'null'::jsonb
      ELSE to_jsonb(input_text)
    END
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_make_group_metadata(root_row_identifier text, head_row_identifier text, tail_row_identifier text, row_count integer)
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
      'rootRowIdentifier', root_row_identifier,
      'headRowIdentifier', head_row_identifier,
      'tailRowIdentifier', tail_row_identifier,
      'rowCount', row_count
    )
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_make_row_value(
    row_sort_key jsonb,
    row_data jsonb,
    left_row_identifier text,
    right_row_identifier text,
    priority bigint,
    prev_row_identifier text,
    next_row_identifier text
  )
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
      'rowSortKey', row_sort_key,
      'rowData', row_data,
      'leftRowIdentifier', left_row_identifier,
      'rightRowIdentifier', right_row_identifier,
      'priority', priority,
      'prevRowIdentifier', prev_row_identifier,
      'nextRowIdentifier', next_row_identifier
    )
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_get_group_metadata(groups_path jsonb[], group_key jsonb)
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = pg_temp.bulldozer_sort_group_metadata_path(groups_path, group_key)
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_get_row(groups_path jsonb[], group_key jsonb, row_identifier text)
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = pg_temp.bulldozer_sort_group_row_path(groups_path, group_key, row_identifier)
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_compare_sort_keys(compare_sort_keys_sql text, left_sort_key jsonb, right_sort_key jsonb)
  RETURNS integer LANGUAGE plpgsql AS $$
  DECLARE
    cmp integer;
  BEGIN
    EXECUTE 'SELECT (' || compare_sort_keys_sql || ')::int'
      INTO cmp
      USING left_sort_key, right_sort_key;
    IF cmp < 0 THEN RETURN -1; END IF;
    IF cmp > 0 THEN RETURN 1; END IF;
    RETURN 0;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_compare_row_keys(
    compare_sort_keys_sql text,
    left_sort_key jsonb,
    left_row_identifier text,
    right_sort_key jsonb,
    right_row_identifier text
  )
  RETURNS integer LANGUAGE plpgsql AS $$
  DECLARE
    cmp integer;
  BEGIN
    cmp := pg_temp.bulldozer_sort_compare_sort_keys(compare_sort_keys_sql, left_sort_key, right_sort_key);
    IF cmp <> 0 THEN
      RETURN cmp;
    END IF;
    IF left_row_identifier < right_row_identifier THEN RETURN -1; END IF;
    IF left_row_identifier > right_row_identifier THEN RETURN 1; END IF;
    RETURN 0;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_put_group_metadata(groups_path jsonb[], group_key jsonb, root_row_identifier text, head_row_identifier text, tail_row_identifier text, row_count integer)
  RETURNS void LANGUAGE sql VOLATILE AS $$
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      pg_temp.bulldozer_sort_group_metadata_path(groups_path, group_key),
      pg_temp.bulldozer_sort_make_group_metadata(root_row_identifier, head_row_identifier, tail_row_identifier, row_count)
    )
    ON CONFLICT ("keyPath") DO UPDATE
    SET "value" = EXCLUDED."value"
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_put_row_value(groups_path jsonb[], group_key jsonb, row_identifier text, row_value jsonb)
  RETURNS void LANGUAGE sql VOLATILE AS $$
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      pg_temp.bulldozer_sort_group_row_path(groups_path, group_key, row_identifier),
      row_value
    )
    ON CONFLICT ("keyPath") DO UPDATE
    SET "value" = EXCLUDED."value"
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_put_row(
    groups_path jsonb[],
    group_key jsonb,
    row_identifier text,
    row_sort_key jsonb,
    row_data jsonb,
    left_row_identifier text,
    right_row_identifier text,
    priority bigint,
    prev_row_identifier text,
    next_row_identifier text
  )
  RETURNS void LANGUAGE sql VOLATILE AS $$
    SELECT pg_temp.bulldozer_sort_put_row_value(
      groups_path,
      group_key,
      row_identifier,
      pg_temp.bulldozer_sort_make_row_value(
        row_sort_key,
        row_data,
        left_row_identifier,
        right_row_identifier,
        priority,
        prev_row_identifier,
        next_row_identifier
      )
    )
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_delete_row_storage(groups_path jsonb[], group_key jsonb, row_identifier text)
  RETURNS void LANGUAGE sql VOLATILE AS $$
    DELETE FROM "BulldozerStorageEngine"
    WHERE "keyPath" = pg_temp.bulldozer_sort_group_row_path(groups_path, group_key, row_identifier)
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_random_priority()
  RETURNS bigint LANGUAGE sql VOLATILE AS $$
    SELECT abs(hashtextextended(gen_random_uuid()::text, 0))
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_ensure_group(groups_path jsonb[], group_key jsonb)
  RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    SELECT
      gen_random_uuid(),
      groups_path[1:"prefixLength"]::jsonb[],
      'null'::jsonb
    FROM generate_series(2, cardinality(groups_path)) AS "prefixLength"
    ON CONFLICT ("keyPath") DO NOTHING;

    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES
      (gen_random_uuid(), pg_temp.bulldozer_sort_group_path(groups_path, group_key), 'null'::jsonb),
      (gen_random_uuid(), pg_temp.bulldozer_sort_group_rows_path(groups_path, group_key), 'null'::jsonb)
    ON CONFLICT ("keyPath") DO NOTHING;

    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      pg_temp.bulldozer_sort_group_metadata_path(groups_path, group_key),
      pg_temp.bulldozer_sort_make_group_metadata(NULL, NULL, NULL, 0)
    )
    ON CONFLICT ("keyPath") DO NOTHING;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_find_predecessor(
    groups_path jsonb[],
    group_key jsonb,
    compare_sort_keys_sql text,
    target_row_identifier text,
    target_row_sort_key jsonb
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    metadata_value jsonb;
    current_row_identifier text;
    current_row_value jsonb;
    best_row_identifier text;
    cmp integer;
  BEGIN
    metadata_value := pg_temp.bulldozer_sort_get_group_metadata(groups_path, group_key);
    current_row_identifier := metadata_value->>'rootRowIdentifier';
    best_row_identifier := NULL;

    WHILE current_row_identifier IS NOT NULL LOOP
      current_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, current_row_identifier);
      cmp := pg_temp.bulldozer_sort_compare_row_keys(
        compare_sort_keys_sql,
        current_row_value->'rowSortKey',
        current_row_identifier,
        target_row_sort_key,
        target_row_identifier
      );
      IF cmp < 0 THEN
        best_row_identifier := current_row_identifier;
        current_row_identifier := current_row_value->>'rightRowIdentifier';
      ELSE
        current_row_identifier := current_row_value->>'leftRowIdentifier';
      END IF;
    END LOOP;

    RETURN best_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_find_successor(
    groups_path jsonb[],
    group_key jsonb,
    compare_sort_keys_sql text,
    target_row_identifier text,
    target_row_sort_key jsonb
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    metadata_value jsonb;
    current_row_identifier text;
    current_row_value jsonb;
    best_row_identifier text;
    cmp integer;
  BEGIN
    metadata_value := pg_temp.bulldozer_sort_get_group_metadata(groups_path, group_key);
    current_row_identifier := metadata_value->>'rootRowIdentifier';
    best_row_identifier := NULL;

    WHILE current_row_identifier IS NOT NULL LOOP
      current_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, current_row_identifier);
      cmp := pg_temp.bulldozer_sort_compare_row_keys(
        compare_sort_keys_sql,
        current_row_value->'rowSortKey',
        current_row_identifier,
        target_row_sort_key,
        target_row_identifier
      );
      IF cmp > 0 THEN
        best_row_identifier := current_row_identifier;
        current_row_identifier := current_row_value->>'leftRowIdentifier';
      ELSE
        current_row_identifier := current_row_value->>'rightRowIdentifier';
      END IF;
    END LOOP;

    RETURN best_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_merge(
    groups_path jsonb[],
    group_key jsonb,
    left_root_row_identifier text,
    right_root_row_identifier text
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    left_row_value jsonb;
    right_row_value jsonb;
    merged_child_row_identifier text;
  BEGIN
    IF left_root_row_identifier IS NULL THEN
      RETURN right_root_row_identifier;
    END IF;
    IF right_root_row_identifier IS NULL THEN
      RETURN left_root_row_identifier;
    END IF;

    left_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, left_root_row_identifier);
    right_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, right_root_row_identifier);

    IF COALESCE((left_row_value->>'priority')::bigint, 0) <= COALESCE((right_row_value->>'priority')::bigint, 0) THEN
      merged_child_row_identifier := pg_temp.bulldozer_sort_merge(
        groups_path,
        group_key,
        left_row_value->>'rightRowIdentifier',
        right_root_row_identifier
      );
      left_row_value := jsonb_set(left_row_value, '{rightRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(merged_child_row_identifier), true);
      PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, left_root_row_identifier, left_row_value);
      RETURN left_root_row_identifier;
    END IF;

    merged_child_row_identifier := pg_temp.bulldozer_sort_merge(
      groups_path,
      group_key,
      left_root_row_identifier,
      right_row_value->>'leftRowIdentifier'
    );
    right_row_value := jsonb_set(right_row_value, '{leftRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(merged_child_row_identifier), true);
    PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, right_root_row_identifier, right_row_value);
    RETURN right_root_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_split(
    groups_path jsonb[],
    group_key jsonb,
    root_row_identifier text,
    split_row_sort_key jsonb,
    split_row_identifier text,
    compare_sort_keys_sql text,
    OUT left_root_row_identifier text,
    OUT right_root_row_identifier text
  )
  RETURNS record LANGUAGE plpgsql AS $$
  DECLARE
    root_row_value jsonb;
    child_split_result record;
    cmp integer;
  BEGIN
    IF root_row_identifier IS NULL THEN
      left_root_row_identifier := NULL;
      right_root_row_identifier := NULL;
      RETURN;
    END IF;

    root_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, root_row_identifier);
    cmp := pg_temp.bulldozer_sort_compare_row_keys(
      compare_sort_keys_sql,
      root_row_value->'rowSortKey',
      root_row_identifier,
      split_row_sort_key,
      split_row_identifier
    );

    IF cmp < 0 THEN
      SELECT *
      INTO child_split_result
      FROM pg_temp.bulldozer_sort_split(
        groups_path,
        group_key,
        root_row_value->>'rightRowIdentifier',
        split_row_sort_key,
        split_row_identifier,
        compare_sort_keys_sql
      ) AS "splitResult";
      root_row_value := jsonb_set(root_row_value, '{rightRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(child_split_result.left_root_row_identifier), true);
      PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, root_row_identifier, root_row_value);
      left_root_row_identifier := root_row_identifier;
      right_root_row_identifier := child_split_result.right_root_row_identifier;
      RETURN;
    END IF;

    SELECT *
    INTO child_split_result
    FROM pg_temp.bulldozer_sort_split(
      groups_path,
      group_key,
      root_row_value->>'leftRowIdentifier',
      split_row_sort_key,
      split_row_identifier,
      compare_sort_keys_sql
    ) AS "splitResult";
    root_row_value := jsonb_set(root_row_value, '{leftRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(child_split_result.right_root_row_identifier), true);
    PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, root_row_identifier, root_row_value);
    left_root_row_identifier := child_split_result.left_root_row_identifier;
    right_root_row_identifier := root_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_insert(
    groups_path jsonb[],
    group_key jsonb,
    compare_sort_keys_sql text,
    row_identifier text,
    row_sort_key jsonb,
    row_data jsonb
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    metadata_value jsonb;
    predecessor_row_identifier text;
    successor_row_identifier text;
    predecessor_row_value jsonb;
    successor_row_value jsonb;
    split_left_root_row_identifier text;
    split_right_root_row_identifier text;
    merged_left_root_row_identifier text;
    new_root_row_identifier text;
    new_head_row_identifier text;
    new_tail_row_identifier text;
    row_count integer;
  BEGIN
    PERFORM pg_temp.bulldozer_sort_ensure_group(groups_path, group_key);
    metadata_value := pg_temp.bulldozer_sort_get_group_metadata(groups_path, group_key);
    row_count := COALESCE((metadata_value->>'rowCount')::int, 0);

    predecessor_row_identifier := pg_temp.bulldozer_sort_find_predecessor(
      groups_path,
      group_key,
      compare_sort_keys_sql,
      row_identifier,
      row_sort_key
    );
    successor_row_identifier := pg_temp.bulldozer_sort_find_successor(
      groups_path,
      group_key,
      compare_sort_keys_sql,
      row_identifier,
      row_sort_key
    );

    PERFORM pg_temp.bulldozer_sort_put_row(
      groups_path,
      group_key,
      row_identifier,
      row_sort_key,
      row_data,
      NULL,
      NULL,
      pg_temp.bulldozer_sort_random_priority(),
      predecessor_row_identifier,
      successor_row_identifier
    );

    IF predecessor_row_identifier IS NOT NULL THEN
      predecessor_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, predecessor_row_identifier);
      IF predecessor_row_value IS NOT NULL THEN
        predecessor_row_value := jsonb_set(predecessor_row_value, '{nextRowIdentifier}', to_jsonb(row_identifier), true);
        PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, predecessor_row_identifier, predecessor_row_value);
      END IF;
    END IF;
    IF successor_row_identifier IS NOT NULL THEN
      successor_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, successor_row_identifier);
      IF successor_row_value IS NOT NULL THEN
        successor_row_value := jsonb_set(successor_row_value, '{prevRowIdentifier}', to_jsonb(row_identifier), true);
        PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, successor_row_identifier, successor_row_value);
      END IF;
    END IF;

    SELECT "left_root_row_identifier", "right_root_row_identifier"
    INTO split_left_root_row_identifier, split_right_root_row_identifier
    FROM pg_temp.bulldozer_sort_split(
      groups_path,
      group_key,
      metadata_value->>'rootRowIdentifier',
      row_sort_key,
      row_identifier,
      compare_sort_keys_sql
    );
    merged_left_root_row_identifier := pg_temp.bulldozer_sort_merge(
      groups_path,
      group_key,
      split_left_root_row_identifier,
      row_identifier
    );
    new_root_row_identifier := pg_temp.bulldozer_sort_merge(
      groups_path,
      group_key,
      merged_left_root_row_identifier,
      split_right_root_row_identifier
    );

    new_head_row_identifier := COALESCE(metadata_value->>'headRowIdentifier', row_identifier);
    IF predecessor_row_identifier IS NULL THEN
      new_head_row_identifier := row_identifier;
    END IF;
    new_tail_row_identifier := COALESCE(metadata_value->>'tailRowIdentifier', row_identifier);
    IF successor_row_identifier IS NULL THEN
      new_tail_row_identifier := row_identifier;
    END IF;

    PERFORM pg_temp.bulldozer_sort_put_group_metadata(
      groups_path,
      group_key,
      new_root_row_identifier,
      new_head_row_identifier,
      new_tail_row_identifier,
      row_count + 1
    );
    RETURN row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_build_balanced_group(
    groups_path jsonb[],
    group_key jsonb,
    ordered_rows jsonb[],
    start_index integer,
    end_index integer,
    level integer
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    midpoint integer;
    current_row jsonb;
    row_identifier text;
    left_root_row_identifier text;
    right_root_row_identifier text;
    prev_row_identifier text;
    next_row_identifier text;
  BEGIN
    IF start_index > end_index THEN
      RETURN NULL;
    END IF;

    midpoint := (start_index + end_index) / 2;
    current_row := ordered_rows[midpoint];
    row_identifier := current_row->>'rowIdentifier';
    left_root_row_identifier := pg_temp.bulldozer_sort_build_balanced_group(
      groups_path,
      group_key,
      ordered_rows,
      start_index,
      midpoint - 1,
      level + 1
    );
    right_root_row_identifier := pg_temp.bulldozer_sort_build_balanced_group(
      groups_path,
      group_key,
      ordered_rows,
      midpoint + 1,
      end_index,
      level + 1
    );
    prev_row_identifier := CASE WHEN midpoint > 1 THEN ordered_rows[midpoint - 1]->>'rowIdentifier' ELSE NULL END;
    next_row_identifier := CASE WHEN midpoint < array_length(ordered_rows, 1) THEN ordered_rows[midpoint + 1]->>'rowIdentifier' ELSE NULL END;

    PERFORM pg_temp.bulldozer_sort_put_row(
      groups_path,
      group_key,
      row_identifier,
      current_row->'rowSortKey',
      current_row->'rowData',
      left_root_row_identifier,
      right_root_row_identifier,
      level,
      prev_row_identifier,
      next_row_identifier
    );
    RETURN row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_bulk_init_from_table(groups_path jsonb[], source_table_name text)
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    current_group_key jsonb;
    ordered_rows jsonb[];
    root_row_identifier text;
    row_count integer;
  BEGIN
    FOR current_group_key IN EXECUTE format('SELECT DISTINCT "groupKey" FROM %I', source_table_name)
    LOOP
      PERFORM pg_temp.bulldozer_sort_ensure_group(groups_path, current_group_key);
      EXECUTE format(
        'SELECT array_agg(jsonb_build_object(''rowIdentifier'', "rowIdentifier", ''rowSortKey'', "rowSortKey", ''rowData'', "rowData") ORDER BY "rowSortKey" ASC, "rowIdentifier" ASC) FROM %I WHERE "groupKey" IS NOT DISTINCT FROM $1',
        source_table_name
      )
      INTO ordered_rows
      USING current_group_key;

      row_count := COALESCE(array_length(ordered_rows, 1), 0);
      IF row_count = 0 THEN
        CONTINUE;
      END IF;

      root_row_identifier := pg_temp.bulldozer_sort_build_balanced_group(
        groups_path,
        current_group_key,
        ordered_rows,
        1,
        row_count,
        1
      );
      PERFORM pg_temp.bulldozer_sort_put_group_metadata(
        groups_path,
        current_group_key,
        root_row_identifier,
        ordered_rows[1]->>'rowIdentifier',
        ordered_rows[row_count]->>'rowIdentifier',
        row_count
      );
    END LOOP;

    RETURN source_table_name;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_delete_recursive(
    groups_path jsonb[],
    group_key jsonb,
    root_row_identifier text,
    compare_sort_keys_sql text,
    target_row_identifier text,
    target_row_sort_key jsonb
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    root_row_value jsonb;
    updated_child_row_identifier text;
    merged_row_identifier text;
    cmp integer;
  BEGIN
    IF root_row_identifier IS NULL THEN
      RETURN NULL;
    END IF;

    root_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, root_row_identifier);
    cmp := pg_temp.bulldozer_sort_compare_row_keys(
      compare_sort_keys_sql,
      target_row_sort_key,
      target_row_identifier,
      root_row_value->'rowSortKey',
      root_row_identifier
    );

    IF cmp < 0 THEN
      IF root_row_value->>'leftRowIdentifier' IS NULL THEN
        RETURN root_row_identifier;
      END IF;
      updated_child_row_identifier := pg_temp.bulldozer_sort_delete_recursive(
        groups_path,
        group_key,
        root_row_value->>'leftRowIdentifier',
        compare_sort_keys_sql,
        target_row_identifier,
        target_row_sort_key
      );
      root_row_value := jsonb_set(root_row_value, '{leftRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(updated_child_row_identifier), true);
      PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, root_row_identifier, root_row_value);
      RETURN root_row_identifier;
    END IF;

    IF cmp > 0 THEN
      IF root_row_value->>'rightRowIdentifier' IS NULL THEN
        RETURN root_row_identifier;
      END IF;
      updated_child_row_identifier := pg_temp.bulldozer_sort_delete_recursive(
        groups_path,
        group_key,
        root_row_value->>'rightRowIdentifier',
        compare_sort_keys_sql,
        target_row_identifier,
        target_row_sort_key
      );
      root_row_value := jsonb_set(root_row_value, '{rightRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(updated_child_row_identifier), true);
      PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, root_row_identifier, root_row_value);
      RETURN root_row_identifier;
    END IF;

    merged_row_identifier := pg_temp.bulldozer_sort_merge(
      groups_path,
      group_key,
      root_row_value->>'leftRowIdentifier',
      root_row_value->>'rightRowIdentifier'
    );
    PERFORM pg_temp.bulldozer_sort_delete_row_storage(groups_path, group_key, root_row_identifier);
    RETURN merged_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_delete(
    groups_path jsonb[],
    group_key jsonb,
    compare_sort_keys_sql text,
    row_identifier text
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    metadata_value jsonb;
    row_value jsonb;
    predecessor_row_identifier text;
    successor_row_identifier text;
    predecessor_row_value jsonb;
    successor_row_value jsonb;
    new_root_row_identifier text;
    current_head_row_identifier text;
    current_tail_row_identifier text;
    row_count integer;
  BEGIN
    metadata_value := pg_temp.bulldozer_sort_get_group_metadata(groups_path, group_key);
    IF metadata_value IS NULL THEN
      RETURN row_identifier;
    END IF;

    row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, row_identifier);
    IF row_value IS NULL THEN
      RETURN row_identifier;
    END IF;

    predecessor_row_identifier := row_value->>'prevRowIdentifier';
    successor_row_identifier := row_value->>'nextRowIdentifier';
    row_count := COALESCE((metadata_value->>'rowCount')::int, 0);

    IF predecessor_row_identifier IS NOT NULL THEN
      predecessor_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, predecessor_row_identifier);
      IF predecessor_row_value IS NOT NULL THEN
        predecessor_row_value := jsonb_set(predecessor_row_value, '{nextRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(successor_row_identifier), true);
        PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, predecessor_row_identifier, predecessor_row_value);
      END IF;
    END IF;
    IF successor_row_identifier IS NOT NULL THEN
      successor_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, successor_row_identifier);
      IF successor_row_value IS NOT NULL THEN
        successor_row_value := jsonb_set(successor_row_value, '{prevRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(predecessor_row_identifier), true);
        PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, successor_row_identifier, successor_row_value);
      END IF;
    END IF;

    new_root_row_identifier := pg_temp.bulldozer_sort_delete_recursive(
      groups_path,
      group_key,
      metadata_value->>'rootRowIdentifier',
      compare_sort_keys_sql,
      row_identifier,
      row_value->'rowSortKey'
    );

    IF row_count <= 1 THEN
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (
        pg_temp.bulldozer_sort_group_metadata_path(groups_path, group_key),
        pg_temp.bulldozer_sort_group_rows_path(groups_path, group_key),
        pg_temp.bulldozer_sort_group_path(groups_path, group_key)
      );
      RETURN row_identifier;
    END IF;

    current_head_row_identifier := metadata_value->>'headRowIdentifier';
    current_tail_row_identifier := metadata_value->>'tailRowIdentifier';
    IF current_head_row_identifier = row_identifier THEN
      current_head_row_identifier := successor_row_identifier;
    END IF;
    IF current_tail_row_identifier = row_identifier THEN
      current_tail_row_identifier := predecessor_row_identifier;
    END IF;

    PERFORM pg_temp.bulldozer_sort_put_group_metadata(
      groups_path,
      group_key,
      new_root_row_identifier,
      current_head_row_identifier,
      current_tail_row_identifier,
      row_count - 1
    );
    RETURN row_identifier;
  END;
  $$;
`;
export function toQueryableSqlQuery(query: SqlQuery): string {
  return query.sql;
}
export function toExecutableSqlStatements(statements: SqlStatement[]): string {
  const requiresSortHelpers = statements.some((statement) => statement.sql.includes("pg_temp.bulldozer_sort_"));
  const requiresSortSequentialExecutor = requiresSortHelpers;
  if (!requiresSortSequentialExecutor) {
    return deindent`
      WITH __dummy_statement_1__ AS (SELECT 1),
      ${statements.map(statement => deindent`
        ${quoteSqlIdentifier(statement.outputName ?? `unnamed_statement_${generateSecureRandomString().slice(0, 8)}`).sql} AS (
          ${statement.sql}
        ),
      `).join("\n")}
      __dummy_statement_2__ AS (SELECT 1)
      SELECT 1;
    `;
  }

  const executableStatements = statements.map((statement) => {
    if (statement.outputName == null) {
      return `${statement.sql};`;
    }
    return deindent`
      CREATE TEMP TABLE ${quoteSqlIdentifier(statement.outputName).sql} ON COMMIT DROP AS
      WITH "__statement_output" AS (
        ${statement.sql}
      )
      SELECT * FROM "__statement_output";
    `;
  }).join("\n\n");
  return deindent`
    ${BULLDOZER_SORT_HELPERS_SQL}

    ${executableStatements}
  `;
}
export function toExecutableSqlTransaction(statements: SqlStatement[]): string {
  return deindent`
    BEGIN;

    SET LOCAL jit = off;

    SELECT pg_advisory_xact_lock(${BULLDOZER_LOCK_ID});

    ${toExecutableSqlStatements(statements)}

    COMMIT;
  `;
}

// ====== Utilities ======
const sqlTemplateLiteral = <T>(type: T) => (strings: TemplateStringsArray, ...values: { sql: string }[]) => ({ type, sql: templateIdentity(strings, ...values.map(v => v.sql)) });
type SqlStatement = { type: "statement", outputName?: string, sql: string };
const sqlStatement = sqlTemplateLiteral<"statement">("statement");
type SqlQuery<R extends void | Iterable<unknown> = void> = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };
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
const sqlArray = (exprs: (SqlExpression<Json> | SqlMapper<any, any>)[]) => ({ type: "expression", sql: `ARRAY[${exprs.map(e => e.sql).join(", ")}]` } as const);
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
function quoteSqlJsonbLiteral(input: Json): SqlExpression<Json> {
  return { type: "expression", sql: `${quoteSqlStringLiteral(JSON.stringify(input)).sql}::jsonb` };
}
function getTablePath(tableId: TableId): SqlExpression<Json[]> {
  return sqlArray(getTablePathSegments(tableId));
}
function getStorageEnginePath(tableId: TableId, path: (string | SqlExpression<Json> | SqlMapper<any, any>)[]): SqlExpression<Json[]> {
  return sqlArray([
    ...getTablePathSegments(tableId),
    quoteSqlJsonbLiteral("storage"),
    ...path.map(p => typeof p === "string" ? quoteSqlJsonbLiteral(p) : p),
  ]);
}
function getTablePathSegments(tableId: TableId): SqlExpression<Json>[] {
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
  return [
    ...tableIdWithParents.reverse().flatMap(id => ["table", id]),
  ].map(id => quoteSqlJsonbLiteral(id));
}
function tableIdToDebugString(tableId: TableId): string {
  return typeof tableId === "string"
    ? tableId
    : JSON.stringify(tableId);
}
function singleNullSortKeyRangePredicate(options: {
  start: SqlExpression<unknown> | "start",
  end: SqlExpression<unknown> | "end",
  startInclusive: boolean,
  endInclusive: boolean,
}): SqlExpression<boolean> {
  return (options.start === "start" || options.startInclusive) && (options.end === "end" || options.endInclusive)
    ? sqlExpression`1 = 1`
    : sqlExpression`1 = 0`;
}
