import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
import { attachRowChangeTriggerMetadata, normalizeRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { RegisteredRowChangeTrigger } from "../row-change-trigger-dispatch";
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
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
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
  const createFromTableTriggerStatements = (fromChangesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => {
    const normalizedChangesTableName = `normalized_changes_${generateSecureRandomString()}`;
    const affectedGroupsTableName = `affected_groups_${generateSecureRandomString()}`;
    const oldLimitedRowsTableName = `old_limited_rows_${generateSecureRandomString()}`;
    const newLimitedRowsTableName = `new_limited_rows_${generateSecureRandomString()}`;
    const limitChangesTableName = `limit_changes_${generateSecureRandomString()}`;
    return [
      {
        ...sqlQuery`
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
      `.toStatement(normalizedChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb, "hasOldRow" boolean, "hasNewRow" boolean'),
        requiresSequentialExecution: true,
      },
      sqlQuery`
        SELECT DISTINCT "changes"."groupKey" AS "groupKey"
        FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
        WHERE "changes"."hasOldRow" OR "changes"."hasNewRow"
      `.toStatement(affectedGroupsTableName, '"groupKey" jsonb'),
      sqlQuery`
        SELECT
          "groups"."groupKey" AS "groupKey",
          ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS "rowIdentifier",
          "rows"."value"->'rowSortKey' AS "rowSortKey",
          "rows"."value"->'rowData' AS "rowData"
        FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        INNER JOIN "BulldozerStorageEngine" AS "groupRowsPath"
          ON "groupRowsPath"."keyPath" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        INNER JOIN "BulldozerStorageEngine" AS "rows"
          ON "rows"."keyPathParent" = "groupRowsPath"."keyPath"
      `.toStatement(oldLimitedRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
      sqlQuery`
        SELECT
          "groups"."groupKey" AS "groupKey",
          "rows"."rowIdentifier" AS "rowIdentifier",
          "rows"."rowSortKey" AS "rowSortKey",
          "rows"."rowData" AS "rowData"
        FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
        CROSS JOIN LATERAL (
          WITH "sourceRows" AS (
            SELECT
              "sourceRows"."rowidentifier" AS "rowidentifier",
              "sourceRows"."rowsortkey" AS "rowsortkey",
              "sourceRows"."rowdata" AS "rowdata"
            FROM (
              ${options.fromTable.listRowsInGroup({
                groupKey: sqlExpression`"groups"."groupKey"`,
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
            "selectedRows"."rowidentifier" AS "rowIdentifier",
            "selectedRows"."rowsortkey" AS "rowSortKey",
            "selectedRows"."rowdata" AS "rowData"
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
            "selectedRows"."rowidentifier" AS "rowIdentifier",
            "selectedRows"."rowsortkey" AS "rowSortKey",
            "selectedRows"."rowdata" AS "rowData"
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
      `.toStatement(newLimitedRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
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
      `.toStatement(limitChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
    ];
  };
  const fromTableTrigger = attachRowChangeTriggerMetadata(
    (fromChangesTable) => createFromTableTriggerStatements(fromChangesTable),
    {
      targetTableId: tableIdToDebugString(options.tableId),
      targetTableTriggers: triggers,
    },
  );
  options.fromTable.registerRowChangeTrigger(fromTableTrigger);

  const table: ReturnType<typeof declareLimitTable<GK, SK, RD>> = {
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
        }).toStatement(fromGroupsTableName, '"groupkey" jsonb'),
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
        `.toStatement(limitedRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb'),
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
        WITH "inputRows" AS (
          SELECT "r"."groupkey" AS "groupKey", "r"."rowidentifier" AS "rowIdentifier", "r"."rowdata" AS "rowData"
          FROM (${allInputRows}) AS "r"
        ),
        "actual" AS (
          SELECT "r"."groupkey" AS "groupKey", "r"."rowidentifier" AS "rowIdentifier", "r"."rowdata" AS "rowData"
          FROM (${allActualRows}) AS "r"
        ),
        "extraRows" AS (
          SELECT 'extra_row' AS errortype,
            "actual"."groupKey" AS groupkey, "actual"."rowIdentifier" AS rowidentifier,
            NULL::jsonb AS expected, "actual"."rowData" AS actual
          FROM "actual"
          LEFT JOIN "inputRows"
            ON "inputRows"."groupKey" IS NOT DISTINCT FROM "actual"."groupKey"
            AND "inputRows"."rowIdentifier" = "actual"."rowIdentifier"
          WHERE "inputRows"."rowIdentifier" IS NULL
        ),
        "overLimit" AS (
          SELECT 'over_limit' AS errortype,
            "counts"."groupKey" AS groupkey, NULL::text AS rowidentifier,
            to_jsonb("counts"."cnt") AS expected, to_jsonb(${normalizedLimit}) AS actual
          FROM (
            SELECT "groupKey", COUNT(*)::int AS "cnt" FROM "actual" GROUP BY "groupKey"
          ) AS "counts"
          WHERE "counts"."cnt" > ${normalizedLimit}
        )
        SELECT * FROM "extraRows" WHERE ${isInitializedExpression}
        UNION ALL
        SELECT * FROM "overLimit" WHERE ${isInitializedExpression}
      `;
    },
  };
  return table;
}
