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
        "groupRows"."keyPath"[cardinality("groupRows"."keyPath") - 1] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupRows"
      INNER JOIN "BulldozerStorageEngine" AS "rows" ON "rows"."keyPathParent" = "groupRows"."keyPath"
      WHERE "groupRows"."keyPathParent"[1:cardinality(${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[])] = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND cardinality("groupRows"."keyPath") = cardinality(${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]) + 2
        AND "groupRows"."keyPath"[cardinality("groupRows"."keyPath")] = to_jsonb('rows'::text)
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
        "groupRows"."keyPath"[cardinality("groupRows"."keyPath") - 1] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupRows"
      INNER JOIN "BulldozerStorageEngine" AS "rows" ON "rows"."keyPathParent" = "groupRows"."keyPath"
      WHERE "groupRows"."keyPathParent"[1:cardinality(${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[])] = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND cardinality("groupRows"."keyPath") = cardinality(${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]) + 2
        AND "groupRows"."keyPath"[cardinality("groupRows"."keyPath")] = to_jsonb('rows'::text)
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
        "groupRows"."keyPath"[cardinality("groupRows"."keyPath") - 1] AS groupKey,
        ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS rowIdentifier,
        "rows"."value"->'rowSortKey' AS rowSortKey,
        "rows"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "groupRows"
      INNER JOIN "BulldozerStorageEngine" AS "rows" ON "rows"."keyPathParent" = "groupRows"."keyPath"
      WHERE "groupRows"."keyPathParent"[1:cardinality(${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[])] = ${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]
        AND cardinality("groupRows"."keyPath") = cardinality(${getStorageEnginePath(options.tableId, ["groups"])}::jsonb[]) + 2
        AND "groupRows"."keyPath"[cardinality("groupRows"."keyPath")] = to_jsonb('rows'::text)
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

export declare function declareConcatTable<
  GK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  tables: Table<GK, any, RD>[],
}): Table<GK, null, RD>;

export declare function declareSortTable<
  GK extends Json,
  OldSK extends Json,
  NewSK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, OldSK, RD>,
  getSortKey: SqlMapper<{ rowIdentifier: RowIdentifier, oldSortKey: OldSK, rowData: RD }, { newSortKey: NewSK }>,
  compareSortKeys: (a: SqlExpression<NewSK>, b: SqlExpression<NewSK>) => SqlExpression<number>,
}): Table<GK, NewSK, RD>;

export declare function declareLFoldTable<
  GK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
  S extends Json,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, OldRD>,
  initialState: SqlExpression<S>,
  reducer: SqlMapper<{ oldState: S, oldRowData: OldRD }, { newState: S, newRowData: NewRD }>,
}): Table<GK, null, NewRD>;

// ====== Executing SQL Statements ======
const BULLDOZER_LOCK_ID = 7857391;  // random number to avoid conflicts with other applications
export function toQueryableSqlQuery(query: SqlQuery): string {
  return query.sql;
}
export function toExecutableSqlTransaction(statements: SqlStatement[]): string {
  return deindent`
    BEGIN;

    SET LOCAL jit = off;

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
