import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
import type { Json, RowData, SqlExpression, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  quoteSqlIdentifier,
  sqlExpression,
  sqlQuery,
  sqlStatement,
  tableIdToDebugString
} from "../utilities";

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
    const groupsWithNonNullOldSortKeysTableName = `groups_with_non_null_old_sort_keys_${generateSecureRandomString()}`;
    const groupsWithNonNullNewSortKeysTableName = `groups_with_non_null_new_sort_keys_${generateSecureRandomString()}`;
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
        SELECT DISTINCT "rows"."groupKey" AS "groupKey"
        FROM ${quoteSqlIdentifier(oldGroupRowsTableName)} AS "rows"
        WHERE "rows"."rowSortKey" IS NOT NULL
          AND "rows"."rowSortKey" <> 'null'::jsonb
      `.toStatement(groupsWithNonNullOldSortKeysTableName),
      sqlQuery`
        SELECT DISTINCT "rows"."groupKey" AS "groupKey"
        FROM ${quoteSqlIdentifier(newGroupRowsTableName)} AS "rows"
        WHERE "rows"."rowSortKey" IS NOT NULL
          AND "rows"."rowSortKey" <> 'null'::jsonb
      `.toStatement(groupsWithNonNullNewSortKeysTableName),
      sqlQuery`
        SELECT
          "rows"."groupKey" AS "groupKey",
          "rows"."rowIdentifier" AS "rowIdentifier",
          "rows"."rowSortKey" AS "rowSortKey",
          "rows"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(oldGroupRowsTableName)} AS "rows"
        INNER JOIN ${quoteSqlIdentifier(groupsWithNonNullOldSortKeysTableName)} AS "nonNullGroups"
          ON "nonNullGroups"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
        WHERE (
          SELECT COUNT(*)
          FROM ${quoteSqlIdentifier(oldGroupRowsTableName)} AS "betterRows"
          WHERE "betterRows"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
            AND (
              ${options.fromTable.compareSortKeys(sqlExpression`"betterRows"."rowSortKey"`, sqlExpression`"rows"."rowSortKey"`)} < 0
              OR (
                ${options.fromTable.compareSortKeys(sqlExpression`"betterRows"."rowSortKey"`, sqlExpression`"rows"."rowSortKey"`)} = 0
                AND "betterRows"."rowIdentifier" < "rows"."rowIdentifier"
              )
            )
        ) < ${normalizedLimit}
        UNION ALL
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
              ORDER BY "rows"."rowIdentifier" ASC
            ) AS "rank"
          FROM ${quoteSqlIdentifier(oldGroupRowsTableName)} AS "rows"
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(groupsWithNonNullOldSortKeysTableName)} AS "nonNullGroups"
            WHERE "nonNullGroups"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
          )
        ) AS "rankedRows"
        WHERE "rankedRows"."rank" <= ${normalizedLimit}
      `.toStatement(oldLimitedRowsTableName),
      sqlQuery`
        SELECT
          "rows"."groupKey" AS "groupKey",
          "rows"."rowIdentifier" AS "rowIdentifier",
          "rows"."rowSortKey" AS "rowSortKey",
          "rows"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(newGroupRowsTableName)} AS "rows"
        INNER JOIN ${quoteSqlIdentifier(groupsWithNonNullNewSortKeysTableName)} AS "nonNullGroups"
          ON "nonNullGroups"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
        WHERE (
          SELECT COUNT(*)
          FROM ${quoteSqlIdentifier(newGroupRowsTableName)} AS "betterRows"
          WHERE "betterRows"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
            AND (
              ${options.fromTable.compareSortKeys(sqlExpression`"betterRows"."rowSortKey"`, sqlExpression`"rows"."rowSortKey"`)} < 0
              OR (
                ${options.fromTable.compareSortKeys(sqlExpression`"betterRows"."rowSortKey"`, sqlExpression`"rows"."rowSortKey"`)} = 0
                AND "betterRows"."rowIdentifier" < "rows"."rowIdentifier"
              )
            )
        ) < ${normalizedLimit}
        UNION ALL
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
              ORDER BY "rows"."rowIdentifier" ASC
            ) AS "rank"
          FROM ${quoteSqlIdentifier(newGroupRowsTableName)} AS "rows"
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${quoteSqlIdentifier(groupsWithNonNullNewSortKeysTableName)} AS "nonNullGroups"
            WHERE "nonNullGroups"."groupKey" IS NOT DISTINCT FROM "rows"."groupKey"
          )
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
            WITH "sourceRows" AS (
              SELECT
                "sourceRows"."rowidentifier" AS "rowidentifier",
                "sourceRows"."rowsortkey" AS "rowsortkey",
                "sourceRows"."rowdata" AS "rowdata"
              FROM (
                ${options.fromTable.listRowsInGroup({
                  groupKey: sqlExpression`"groups"."groupkey"`,
                  start: "start",
                  end: "end",
                  startInclusive: true,
                  endInclusive: true,
                })}
              ) AS "sourceRows"
            ),
            "sortKeyPresence" AS (
              SELECT EXISTS (
                SELECT 1
                FROM "sourceRows"
                WHERE "rowsortkey" IS NOT NULL
                  AND "rowsortkey" <> 'null'::jsonb
              ) AS "hasNonNullSortKey"
            )
            SELECT
              "selectedRows"."rowidentifier" AS "rowidentifier",
              "selectedRows"."rowsortkey" AS "rowsortkey",
              "selectedRows"."rowdata" AS "rowdata"
            FROM (
              SELECT
                "sourceRows"."rowidentifier" AS "rowidentifier",
                "sourceRows"."rowsortkey" AS "rowsortkey",
                "sourceRows"."rowdata" AS "rowdata"
              FROM "sourceRows"
              CROSS JOIN "sortKeyPresence"
              WHERE "sortKeyPresence"."hasNonNullSortKey"
              LIMIT ${normalizedLimit}
            ) AS "selectedRows"
            UNION ALL
            SELECT
              "selectedRows"."rowidentifier" AS "rowidentifier",
              "selectedRows"."rowsortkey" AS "rowsortkey",
              "selectedRows"."rowdata" AS "rowdata"
            FROM (
              SELECT
                "sourceRows"."rowidentifier" AS "rowidentifier",
                "sourceRows"."rowsortkey" AS "rowsortkey",
                "sourceRows"."rowdata" AS "rowdata"
              FROM "sourceRows"
              CROSS JOIN "sortKeyPresence"
              WHERE NOT "sortKeyPresence"."hasNonNullSortKey"
              ORDER BY "sourceRows"."rowidentifier" ASC
              LIMIT ${normalizedLimit}
            ) AS "selectedRows"
          ) AS "rows"
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
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey
      ? sqlQuery`
        WITH "limitedRows" AS (
          SELECT
            ("row"."keyPath"[cardinality("row"."keyPath")] #>> '{}') AS "rowIdentifier",
            "row"."value"->'rowSortKey' AS "rowSortKey",
            "row"."value"->'rowData' AS "rowData"
          FROM "BulldozerStorageEngine" AS "row"
          WHERE "row"."keyPathParent" = ${getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"])}::jsonb[]
        ),
        "sortKeyPresence" AS (
          SELECT EXISTS (
            SELECT 1
            FROM "limitedRows"
            WHERE "rowSortKey" IS NOT NULL
              AND "rowSortKey" <> 'null'::jsonb
          ) AS "hasNonNullSortKey"
        ),
        "selectedRows" AS (
          SELECT
            "sourceRows"."rowidentifier" AS "rowIdentifier",
            "sourceRows"."rowsortkey" AS "rowSortKey",
            "sourceRows"."rowdata" AS "rowData",
            0::int AS "branchOrder",
            row_number() OVER () AS "rowOrder"
          FROM (
            ${options.fromTable.listRowsInGroup({
              groupKey,
              start,
              end,
              startInclusive,
              endInclusive,
            })}
          ) AS "sourceRows"
          CROSS JOIN "sortKeyPresence"
          WHERE "sortKeyPresence"."hasNonNullSortKey"
            AND EXISTS (
              SELECT 1
              FROM "limitedRows"
              WHERE "limitedRows"."rowIdentifier" = "sourceRows"."rowidentifier"
            )

          UNION ALL

          SELECT
            "limitedRows"."rowIdentifier" AS "rowIdentifier",
            "limitedRows"."rowSortKey" AS "rowSortKey",
            "limitedRows"."rowData" AS "rowData",
            1::int AS "branchOrder",
            row_number() OVER (ORDER BY "limitedRows"."rowIdentifier" ASC) AS "rowOrder"
          FROM "limitedRows"
          CROSS JOIN "sortKeyPresence"
          WHERE NOT "sortKeyPresence"."hasNonNullSortKey"
            AND ${
              start === "start"
                ? sqlExpression`1 = 1`
                : startInclusive
                  ? sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"limitedRows"."rowSortKey"`, start)} >= 0`
                  : sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"limitedRows"."rowSortKey"`, start)} > 0`
            }
            AND ${
              end === "end"
                ? sqlExpression`1 = 1`
                : endInclusive
                  ? sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"limitedRows"."rowSortKey"`, end)} <= 0`
                  : sqlExpression`${options.fromTable.compareSortKeys(sqlExpression`"limitedRows"."rowSortKey"`, end)} < 0`
            }
        )
        SELECT
          "selectedRows"."rowIdentifier" AS rowIdentifier,
          "selectedRows"."rowSortKey" AS rowSortKey,
          "selectedRows"."rowData" AS rowData
        FROM "selectedRows"
        ORDER BY "selectedRows"."branchOrder" ASC, "selectedRows"."rowOrder" ASC
      `
      : sqlQuery`
      SELECT
        "sourceRows"."groupkey" AS groupKey,
        "sourceRows"."rowidentifier" AS rowIdentifier,
        "sourceRows"."rowsortkey" AS rowSortKey,
        "sourceRows"."rowdata" AS rowData
      FROM (
        ${options.fromTable.listRowsInGroup({
          start,
          end,
          startInclusive,
          endInclusive,
        })}
      ) AS "sourceRows"
      WHERE EXISTS (
        SELECT 1
        FROM "BulldozerStorageEngine" AS "limitedRows"
        WHERE "limitedRows"."keyPath" = ${getGroupRowPath(
          sqlExpression`"sourceRows"."groupkey"`,
          sqlExpression`to_jsonb("sourceRows"."rowidentifier"::text)`,
        )}::jsonb[]
      )
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, trigger);
      return { deregister: () => triggers.delete(id) };
    },
  };
}
