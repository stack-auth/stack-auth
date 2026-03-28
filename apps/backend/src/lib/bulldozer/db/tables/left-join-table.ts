import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlPredicate, SqlStatement, TableId } from "../utilities";
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
