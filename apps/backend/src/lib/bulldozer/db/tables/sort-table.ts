import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlMapper, SqlPredicate, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  quoteSqlIdentifier,
  quoteSqlStringLiteral,
  sqlExpression,
  sqlQuery,
  sqlStatement,
  singleNullSortKeyRangePredicate,
  tableIdToDebugString,
} from "../utilities";
import type { Table } from "../table-type";

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
