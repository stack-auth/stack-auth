import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
import { createTableRowChangeTrigger, normalizeRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { RegisteredRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlMapper, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  quoteSqlIdentifier,
  singleNullSortKeyRangePredicate,
  sqlExpression,
  sqlQuery,
  sqlStatement,
  tableIdToDebugString
} from "../utilities";

export function declareFlatMapTable<
  GK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, OldRD>,
  mapper: SqlMapper<OldRD, { rows: NewRD[] }>,
}): Table<GK, null, NewRD> {
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
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
  const createFromTableTriggerStatements = (
    fromChangesTable: SqlExpression<{ __brand: "$SQL_Table" }>,
    outputChangesTableName: string,
  ) => {
    const mappedChangesTableName = `mapped_changes_${generateSecureRandomString()}`;
    const oldFlatRowsTableName = `old_flat_rows_${generateSecureRandomString()}`;
    const newFlatRowsTableName = `new_flat_rows_${generateSecureRandomString()}`;
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
      `.toStatement(mappedChangesTableName, '"groupKey" jsonb, "sourceRowIdentifier" text, "hasOldRow" boolean, "hasNewRow" boolean, "oldMappedRows" jsonb, "newMappedRows" jsonb'),
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
      `.toStatement(oldFlatRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb'),
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
      `.toStatement(newFlatRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb'),
      sqlStatement`
        WITH "distinctGroups" AS (
          SELECT DISTINCT "groupKey"
          FROM ${quoteSqlIdentifier(newFlatRowsTableName)}
        )
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          "insertRows"."keyPath",
          "insertRows"."value"
        FROM (
          SELECT
            ${getGroupKeyPath(sqlExpression`"distinctGroups"."groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM "distinctGroups"

          UNION ALL

          SELECT
            ${getGroupRowsPath(sqlExpression`"distinctGroups"."groupKey"`)}::jsonb[] AS "keyPath",
            'null'::jsonb AS "value"
          FROM "distinctGroups"
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
      `.toStatement(outputChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
    ];
  };
  const fromTableTrigger = createTableRowChangeTrigger({
    targetTableId: tableIdToDebugString(options.tableId),
    createStatements: (fromChangesTable, outputChangesTableName) =>
      createFromTableTriggerStatements(fromChangesTable, outputChangesTableName),
    getTriggeredTables: () => [...triggers.values()],
  });
  options.fromTable.registerRowChangeTrigger(fromTableTrigger);

  const table: ReturnType<typeof declareFlatMapTable<GK, OldRD, NewRD>> = {
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
        }).toStatement(fromGroupsTableName, '"groupkey" jsonb'),
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
        `.toStatement(fromRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb'),
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
        `.toStatement(mappedRowsTableName, '"groupKey" jsonb, "sourceRowIdentifier" text, "mappedRows" jsonb'),
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
        `.toStatement(flatRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb'),
        sqlStatement`
          WITH "distinctGroups" AS (
            SELECT DISTINCT "groupKey"
            FROM ${quoteSqlIdentifier(flatRowsTableName)}
          )
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          SELECT
            gen_random_uuid(),
            "insertRows"."keyPath",
            "insertRows"."value"
          FROM (
            SELECT
              ${getGroupKeyPath(sqlExpression`"distinctGroups"."groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM "distinctGroups"

            UNION ALL

            SELECT
              ${getGroupRowsPath(sqlExpression`"distinctGroups"."groupKey"`)}::jsonb[] AS "keyPath",
              'null'::jsonb AS "value"
            FROM "distinctGroups"

            UNION ALL

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
    delete: () => {
      return [sqlStatement`
        WITH RECURSIVE "pathsToDelete" AS (
          SELECT ${getTablePath(options.tableId)}::jsonb[] AS "path"
          UNION ALL
          SELECT "BulldozerStorageEngine"."keyPath" AS "path"
          FROM "BulldozerStorageEngine"
          INNER JOIN "pathsToDelete" ON "BulldozerStorageEngine"."keyPathParent" = "pathsToDelete"."path"
        )
        DELETE FROM "BulldozerStorageEngine"
        WHERE "keyPath" IN (SELECT "path" FROM "pathsToDelete")
      `];
    },
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
      triggers.set(id, normalizeRowChangeTrigger(trigger));
      return { deregister: () => triggers.delete(id) };
    },
    verifyDataIntegrity: () => {
      const allInputRows = options.fromTable.listRowsInGroup({
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      const allActualRows = table.listRowsInGroup({
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      return sqlQuery`
        WITH "expected" AS (
          SELECT
            "source"."groupkey" AS "groupKey",
            ${createExpandedRowIdentifier(
              sqlExpression`"source"."rowidentifier"`,
              sqlExpression`"flatRow"."flatIndex"`,
            )} AS "rowIdentifier",
            "flatRow"."rowData" AS "rowData"
          FROM (${allInputRows}) AS "source"
          LEFT JOIN LATERAL (
            SELECT "mapped"."rows" AS "mappedRows"
            FROM (
              SELECT ${options.mapper}
              FROM (
                SELECT "source"."rowidentifier" AS "rowIdentifier", "source"."rowdata" AS "rowData"
              ) AS "mapperInput"
            ) AS "mapped"
          ) AS "mapped" ON true
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof("mapped"."mappedRows") = 'array' THEN "mapped"."mappedRows" ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS "flatRow"("rowData", "flatIndex")
        ),
        "actual" AS (
          SELECT "r"."groupkey" AS "groupKey", "r"."rowidentifier" AS "rowIdentifier", "r"."rowdata" AS "rowData"
          FROM (${allActualRows}) AS "r"
        )
        SELECT
          CASE
            WHEN "expected"."rowIdentifier" IS NULL THEN 'extra_row'
            WHEN "actual"."rowIdentifier" IS NULL THEN 'missing_row'
            ELSE 'data_mismatch'
          END AS errortype,
          COALESCE("expected"."groupKey", "actual"."groupKey") AS groupkey,
          COALESCE("expected"."rowIdentifier", "actual"."rowIdentifier") AS rowidentifier,
          "expected"."rowData" AS expected,
          "actual"."rowData" AS actual
        FROM "expected"
        FULL OUTER JOIN "actual"
          ON "expected"."groupKey" IS NOT DISTINCT FROM "actual"."groupKey"
          AND "expected"."rowIdentifier" = "actual"."rowIdentifier"
        WHERE ("expected"."rowIdentifier" IS NULL
          OR "actual"."rowIdentifier" IS NULL
          OR "expected"."rowData" IS DISTINCT FROM "actual"."rowData")
          AND ${isInitializedExpression}
      `;
    },
  };
  return table;
}
