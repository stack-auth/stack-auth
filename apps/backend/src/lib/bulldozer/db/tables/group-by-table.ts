import type { Table } from "..";
import { getBulldozerExecutionContext } from "../execution-context";
import { attachRowChangeTriggerMetadata, normalizeRowChangeTrigger } from "../row-change-trigger-dispatch";
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

export function declareGroupByTable<
  GK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, RD>,
  groupBy: SqlMapper<{ rowIdentifier: RowIdentifier, rowData: RD }, { groupKey: GK }>,
}): Table<GK, null, RD> {
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
  let triggerRegistrationCount = 0;
  const getGroupKeyPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey]);
  const getGroupRowsPath = (groupKey: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows"]);
  const getGroupRowPath = (groupKey: SqlExpression<Json>, rowIdentifier: SqlExpression<Json>) => getStorageEnginePath(options.tableId, ["groups", groupKey, "rows", rowIdentifier]);
  const compareGroupKeys = (a: SqlExpression<GK>, b: SqlExpression<GK>) => sqlExpression`
    ((${a}) > (${b}))::int - ((${a}) < (${b}))::int
  `;
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;
  const createFromTableTriggerStatements = (
    fromChangesTable: SqlExpression<{ __brand: "$SQL_Table" }>,
    ctx: { generateDeterministicUniqueString: () => string },
  ) => {
    const mappedChangesTableName = `mapped_changes_${ctx.generateDeterministicUniqueString()}`;
    const groupedChangesTableName = `grouped_changes_${ctx.generateDeterministicUniqueString()}`;

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
          AND (
            NOT (
              "changes"."oldRowData" IS NOT NULL
              AND jsonb_typeof("changes"."oldRowData") = 'object'
              AND "changes"."newRowData" IS NOT NULL
              AND jsonb_typeof("changes"."newRowData") = 'object'
            )
            OR "changes"."oldRowData" IS DISTINCT FROM "changes"."newRowData"
            OR "oldGroup"."groupKey" IS DISTINCT FROM "newGroup"."groupKey"
          )
      `.toStatement(mappedChangesTableName, '"rowIdentifier" text, "oldRowData" jsonb, "newRowData" jsonb, "hasOldRow" boolean, "hasNewRow" boolean, "oldGroupKey" jsonb, "newGroupKey" jsonb'),
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
      `.toStatement(groupedChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
    ];
  };
  const fromTableTrigger = attachRowChangeTriggerMetadata(
    (ctx, fromChangesTable) => createFromTableTriggerStatements(fromChangesTable, getBulldozerExecutionContext(ctx)),
    {
      targetTableId: tableIdToDebugString(options.tableId),
      targetTableTriggers: triggers,
    },
  );
  options.fromTable.registerRowChangeTrigger(fromTableTrigger);

  const table: ReturnType<typeof declareGroupByTable<GK, RD>> = {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "groupBy",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      groupBySql: options.groupBy.sql,
    },
    compareGroupKeys,
    compareSortKeys: (a, b) => sqlExpression` 0 `,
    init: (ctx) => {
      const executionCtx = getBulldozerExecutionContext(ctx);
      const fromTableAllRowsTableName = `from_table_all_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const fromTableRowsWithGroupKeyTableName = `from_table_rows_with_group_key_${executionCtx.generateDeterministicUniqueString()}`;

      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["groups"])}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        options.fromTable.listRowsInGroup(executionCtx, {
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).toStatement(fromTableAllRowsTableName, '"groupkey" jsonb, "rowidentifier" text, "rowsortkey" jsonb, "rowdata" jsonb'),
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
        `.toStatement(fromTableRowsWithGroupKeyTableName, '"rowIdentifier" text, "rowData" jsonb, "groupKey" jsonb'),
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
    delete: (_ctx) => {
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
    isInitialized: (_ctx) => sqlExpression`
      EXISTS (
        SELECT 1 FROM "BulldozerStorageEngine"
        WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
      )
    `,
    listGroups: (_ctx, { start, end, startInclusive, endInclusive }) => sqlQuery`
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
              ? sqlExpression`${compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} >= 0`
              : sqlExpression`${compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, start)} > 0`
        }
        AND ${
          end === "end"
            ? sqlExpression`1 = 1`
            : endInclusive
              ? sqlExpression`${compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} <= 0`
              : sqlExpression`${compareGroupKeys(sqlExpression`"groupPath"."keyPath"[cardinality("groupPath"."keyPath")]`, end)} < 0`
        }
      ORDER BY "groupPath"."keyPath"[cardinality("groupPath"."keyPath")] ASC
    `,
    listRowsInGroup: (_ctx, { groupKey, start, end, startInclusive, endInclusive }) => groupKey ? sqlQuery`
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
      const id = `trigger_registration_${triggerRegistrationCount.toString(36).padStart(10, "0")}`;
      triggerRegistrationCount++;
      triggers.set(id, normalizeRowChangeTrigger(trigger));
      return { deregister: () => triggers.delete(id) };
    },
    verifyDataIntegrity: (ctx) => {
      const executionCtx = getBulldozerExecutionContext(ctx);
      const allInputRows = options.fromTable.listRowsInGroup(executionCtx, {
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      const allActualRows = table.listRowsInGroup(executionCtx, {
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      return sqlQuery`
        WITH "expected" AS (
          SELECT
            "mapped"."groupKey" AS "groupKey",
            "source"."rowidentifier" AS "rowIdentifier",
            "source"."rowdata" AS "rowData"
          FROM (${allInputRows}) AS "source"
          LEFT JOIN LATERAL (
            SELECT "mapped"."groupKey"
            FROM (
              SELECT ${options.groupBy}
              FROM (
                SELECT "source"."rowidentifier" AS "rowIdentifier", "source"."rowdata" AS "rowData"
              ) AS "groupByInput"
            ) AS "mapped"
          ) AS "mapped" ON true
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
