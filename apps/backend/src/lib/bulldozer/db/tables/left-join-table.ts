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

export function declareLeftJoinTable<
  GK extends Json,
  JK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
>(options: {
  tableId: TableId,
  leftTable: Table<GK, any, OldRD>,
  rightTable: Table<GK, any, NewRD>,
  leftJoinKey: SqlMapper<{ rowIdentifier: RowIdentifier, rowData: OldRD }, { joinKey: JK }>,
  rightJoinKey: SqlMapper<{ rowIdentifier: RowIdentifier, rowData: NewRD }, { joinKey: JK }>,
}): Table<GK, null, { leftRowData: OldRD, rightRowData: NewRD | null }> {
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
  let triggerRegistrationCount = 0;
  const rawExpression = <T>(sql: string): SqlExpression<T> => ({ type: "expression", sql });
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
        AND "rightRows"."rightJoinKey" IS NOT DISTINCT FROM "leftRows"."leftJoinKey"
    ) AS "joinedRows"
    ORDER BY "joinedRows"."groupKey", "joinedRows"."rowIdentifier"
  `.toStatement(optionsForStatement.outputTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb');
  const createLeftRowsStatement = (optionsForRows: {
    groupsTableName: string,
    groupKeySql: string,
    outputTableName: string,
    ctx: Parameters<typeof options.leftTable.listRowsInGroup>[0],
  }): SqlStatement => sqlQuery`
    SELECT
      ${rawExpression<GK>(optionsForRows.groupKeySql)} AS "groupKey",
      "rows"."rowidentifier" AS "leftRowIdentifier",
      "rows"."rowdata" AS "leftRowData",
      to_jsonb("mapped"."joinKey") AS "leftJoinKey"
    FROM ${quoteSqlIdentifier(optionsForRows.groupsTableName)} AS "groups"
    CROSS JOIN LATERAL (
      ${options.leftTable.listRowsInGroup(optionsForRows.ctx, {
        groupKey: rawExpression<GK>(optionsForRows.groupKeySql),
        start: "start",
        end: "end",
        startInclusive: true,
        endInclusive: true,
      })}
    ) AS "rows"
    LEFT JOIN LATERAL (
      SELECT "mapped"."joinKey"
      FROM (
        SELECT ${options.leftJoinKey}
        FROM (
          SELECT
            "rows"."rowidentifier" AS "rowIdentifier",
            "rows"."rowdata" AS "rowData"
        ) AS "joinKeyInput"
      ) AS "mapped"
    ) AS "mapped" ON true
  `.toStatement(optionsForRows.outputTableName, '"groupKey" jsonb, "leftRowIdentifier" text, "leftRowData" jsonb, "leftJoinKey" jsonb');
  const createRightRowsStatement = (optionsForRows: {
    groupsTableName: string,
    groupKeySql: string,
    outputTableName: string,
    ctx: Parameters<typeof options.rightTable.listRowsInGroup>[0],
  }): SqlStatement => sqlQuery`
    SELECT
      ${rawExpression<GK>(optionsForRows.groupKeySql)} AS "groupKey",
      "rows"."rowidentifier" AS "rightRowIdentifier",
      "rows"."rowdata" AS "rightRowData",
      to_jsonb("mapped"."joinKey") AS "rightJoinKey"
    FROM ${quoteSqlIdentifier(optionsForRows.groupsTableName)} AS "groups"
    CROSS JOIN LATERAL (
      ${options.rightTable.listRowsInGroup(optionsForRows.ctx, {
        groupKey: rawExpression<GK>(optionsForRows.groupKeySql),
        start: "start",
        end: "end",
        startInclusive: true,
        endInclusive: true,
      })}
    ) AS "rows"
    LEFT JOIN LATERAL (
      SELECT "mapped"."joinKey"
      FROM (
        SELECT ${options.rightJoinKey}
        FROM (
          SELECT
            "rows"."rowidentifier" AS "rowIdentifier",
            "rows"."rowdata" AS "rowData"
        ) AS "joinKeyInput"
      ) AS "mapped"
    ) AS "mapped" ON true
  `.toStatement(optionsForRows.outputTableName, '"groupKey" jsonb, "rightRowIdentifier" text, "rightRowData" jsonb, "rightJoinKey" jsonb');

  const registerInputTrigger = <InputRD extends RowData>(optionsForTrigger: {
    inputTable: Table<GK, any, InputRD>,
    changedSide: "left" | "right",
  }) => {
    const inputTrigger = (
      ctx: Parameters<typeof getBulldozerExecutionContext>[0],
      inputChangesTable: SqlExpression<{ __brand: "$SQL_Table" }>,
    ) => {
      const executionCtx = getBulldozerExecutionContext(ctx);
      const normalizedChangesTableName = `normalized_changes_${executionCtx.generateDeterministicUniqueString()}`;
      const affectedGroupsTableName = `affected_groups_${executionCtx.generateDeterministicUniqueString()}`;
      const oldLeftJoinRowsTableName = `old_left_join_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const oldLeftRowsTableName = `old_left_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const oldRightRowsTableName = `old_right_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const newLeftRowsTableName = `new_left_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const newRightRowsTableName = `new_right_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const newLeftJoinRowsTableName = `new_left_join_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const leftJoinChangesTableName = `left_join_changes_${executionCtx.generateDeterministicUniqueString()}`;

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
        `.toStatement(normalizedChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowData" jsonb, "newRowData" jsonb, "hasOldRow" boolean, "hasNewRow" boolean'),
        sqlQuery`
          SELECT DISTINCT "changes"."groupKey" AS "groupKey"
          FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
          WHERE "changes"."hasOldRow" OR "changes"."hasNewRow"
        `.toStatement(affectedGroupsTableName, '"groupKey" jsonb'),
        sqlQuery`
          SELECT
            "groups"."groupKey" AS "groupKey",
            ("rows"."keyPath"[cardinality("rows"."keyPath")] #>> '{}') AS "rowIdentifier",
            "rows"."value"->'rowData' AS "rowData"
          FROM ${quoteSqlIdentifier(affectedGroupsTableName)} AS "groups"
          INNER JOIN "BulldozerStorageEngine" AS "rows"
            ON "rows"."keyPathParent" = ${getGroupRowsPath(sqlExpression`"groups"."groupKey"`)}::jsonb[]
        `.toStatement(oldLeftJoinRowsTableName, '"groupKey" jsonb, "rowIdentifier" text, "rowData" jsonb'),
        createLeftRowsStatement({
          groupsTableName: affectedGroupsTableName,
          groupKeySql: `"groups"."groupKey"`,
          outputTableName: oldLeftRowsTableName,
          ctx: executionCtx,
        }),
        createRightRowsStatement({
          groupsTableName: affectedGroupsTableName,
          groupKeySql: `"groups"."groupKey"`,
          outputTableName: oldRightRowsTableName,
          ctx: executionCtx,
        }),
        optionsForTrigger.changedSide === "left" ? sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."leftRowIdentifier" AS "leftRowIdentifier",
            "rows"."leftRowData" AS "leftRowData",
            "rows"."leftJoinKey" AS "leftJoinKey"
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
            "changes"."newRowData" AS "leftRowData",
            to_jsonb("mapped"."joinKey") AS "leftJoinKey"
          FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
          LEFT JOIN LATERAL (
            SELECT "mapped"."joinKey"
            FROM (
              SELECT ${options.leftJoinKey}
              FROM (
                SELECT
                  "changes"."rowIdentifier" AS "rowIdentifier",
                  "changes"."newRowData" AS "rowData"
              ) AS "joinKeyInput"
            ) AS "mapped"
          ) AS "mapped" ON true
          WHERE "changes"."hasNewRow"
        `.toStatement(newLeftRowsTableName, '"groupKey" jsonb, "leftRowIdentifier" text, "leftRowData" jsonb, "leftJoinKey" jsonb') : sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."leftRowIdentifier" AS "leftRowIdentifier",
            "rows"."leftRowData" AS "leftRowData",
            "rows"."leftJoinKey" AS "leftJoinKey"
          FROM ${quoteSqlIdentifier(oldLeftRowsTableName)} AS "rows"
        `.toStatement(newLeftRowsTableName, '"groupKey" jsonb, "leftRowIdentifier" text, "leftRowData" jsonb, "leftJoinKey" jsonb'),
        optionsForTrigger.changedSide === "right" ? sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rightRowIdentifier" AS "rightRowIdentifier",
            "rows"."rightRowData" AS "rightRowData",
            "rows"."rightJoinKey" AS "rightJoinKey"
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
            "changes"."newRowData" AS "rightRowData",
            to_jsonb("mapped"."joinKey") AS "rightJoinKey"
          FROM ${quoteSqlIdentifier(normalizedChangesTableName)} AS "changes"
          LEFT JOIN LATERAL (
            SELECT "mapped"."joinKey"
            FROM (
              SELECT ${options.rightJoinKey}
              FROM (
                SELECT
                  "changes"."rowIdentifier" AS "rowIdentifier",
                  "changes"."newRowData" AS "rowData"
              ) AS "joinKeyInput"
            ) AS "mapped"
          ) AS "mapped" ON true
          WHERE "changes"."hasNewRow"
        `.toStatement(newRightRowsTableName, '"groupKey" jsonb, "rightRowIdentifier" text, "rightRowData" jsonb, "rightJoinKey" jsonb') : sqlQuery`
          SELECT
            "rows"."groupKey" AS "groupKey",
            "rows"."rightRowIdentifier" AS "rightRowIdentifier",
            "rows"."rightRowData" AS "rightRowData",
            "rows"."rightJoinKey" AS "rightJoinKey"
          FROM ${quoteSqlIdentifier(oldRightRowsTableName)} AS "rows"
        `.toStatement(newRightRowsTableName, '"groupKey" jsonb, "rightRowIdentifier" text, "rightRowData" jsonb, "rightJoinKey" jsonb'),
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
        `.toStatement(leftJoinChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
      ];
    };
    const triggerWithMetadata = attachRowChangeTriggerMetadata(inputTrigger, {
      targetTableId: tableIdToDebugString(options.tableId),
      targetTableTriggers: triggers,
    });
    return optionsForTrigger.inputTable.registerRowChangeTrigger(triggerWithMetadata);
  };
  registerInputTrigger({
    inputTable: options.leftTable,
    changedSide: "left",
  });
  registerInputTrigger({
    inputTable: options.rightTable,
    changedSide: "right",
  });

  const table: ReturnType<typeof declareLeftJoinTable<GK, JK, OldRD, NewRD>> = {
    tableId: options.tableId,
    inputTables: [options.leftTable, options.rightTable],
    debugArgs: {
      operator: "leftJoin",
      tableId: tableIdToDebugString(options.tableId),
      leftTableId: tableIdToDebugString(options.leftTable.tableId),
      rightTableId: tableIdToDebugString(options.rightTable.tableId),
      leftJoinKeySql: options.leftJoinKey.sql,
      rightJoinKeySql: options.rightJoinKey.sql,
    },
    compareGroupKeys: options.leftTable.compareGroupKeys,
    compareSortKeys: () => sqlExpression`0`,
    init: (ctx) => {
      const executionCtx = getBulldozerExecutionContext(ctx);
      const leftGroupsTableName = `left_groups_${executionCtx.generateDeterministicUniqueString()}`;
      const leftRowsTableName = `left_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const rightRowsTableName = `right_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const leftJoinedRowsTableName = `left_joined_rows_${executionCtx.generateDeterministicUniqueString()}`;

      return [
        sqlStatement`
          INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
          VALUES
          (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
          (gen_random_uuid(), ${groupsPath}, 'null'::jsonb),
          (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
        `,
        options.leftTable.listGroups(executionCtx, {
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).toStatement(leftGroupsTableName, '"groupkey" jsonb'),
        createLeftRowsStatement({
          groupsTableName: leftGroupsTableName,
          groupKeySql: `"groups"."groupkey"`,
          outputTableName: leftRowsTableName,
          ctx: executionCtx,
        }),
        createRightRowsStatement({
          groupsTableName: leftGroupsTableName,
          groupKeySql: `"groups"."groupkey"`,
          outputTableName: rightRowsTableName,
          ctx: executionCtx,
        }),
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
    isInitialized: (_ctx) => isInitializedExpression,
    listGroups: (_ctx, { start, end, startInclusive, endInclusive }) => sqlQuery`
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
    listRowsInGroup: (_ctx, { groupKey, start, end, startInclusive, endInclusive }) => groupKey ? sqlQuery`
      SELECT
        ("row"."keyPath"[cardinality("row"."keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "row"."value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine" AS "row"
      WHERE "row"."keyPathParent" = ${getGroupRowsPath(groupKey)}::jsonb[]
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
      ORDER BY rowIdentifier ASC
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
      ORDER BY groupKey ASC, rowIdentifier ASC
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = `trigger_registration_${triggerRegistrationCount.toString(36).padStart(10, "0")}`;
      triggerRegistrationCount++;
      triggers.set(id, normalizeRowChangeTrigger(trigger));
      return { deregister: () => triggers.delete(id) };
    },
    verifyDataIntegrity: (ctx) => {
      const executionCtx = getBulldozerExecutionContext(ctx);
      const allLeftRows = options.leftTable.listRowsInGroup(executionCtx, {
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      const allRightRows = options.rightTable.listRowsInGroup(executionCtx, {
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      const allActualRows = table.listRowsInGroup(executionCtx, {
        start: "start", end: "end", startInclusive: true, endInclusive: true,
      });
      return sqlQuery`
        WITH "leftRows" AS (
          SELECT
            "source"."groupkey" AS "groupKey",
            "source"."rowidentifier" AS "leftRowIdentifier",
            "source"."rowdata" AS "leftRowData",
            "joinKey"."joinKey" AS "leftJoinKey"
          FROM (${allLeftRows}) AS "source"
          LEFT JOIN LATERAL (
            SELECT "mapped"."joinKey"
            FROM (
              SELECT ${options.leftJoinKey}
              FROM (SELECT "source"."rowidentifier" AS "rowIdentifier", "source"."rowdata" AS "rowData") AS "joinKeyInput"
            ) AS "mapped"
          ) AS "joinKey" ON true
        ),
        "rightRows" AS (
          SELECT
            "source"."groupkey" AS "groupKey",
            "source"."rowidentifier" AS "rightRowIdentifier",
            "source"."rowdata" AS "rightRowData",
            "joinKey"."joinKey" AS "rightJoinKey"
          FROM (${allRightRows}) AS "source"
          LEFT JOIN LATERAL (
            SELECT "mapped"."joinKey"
            FROM (
              SELECT ${options.rightJoinKey}
              FROM (SELECT "source"."rowidentifier" AS "rowIdentifier", "source"."rowdata" AS "rowData") AS "joinKeyInput"
            ) AS "mapped"
          ) AS "joinKey" ON true
        ),
        "expected" AS (
          SELECT DISTINCT ON ("joined"."groupKey", "joined"."rowIdentifier")
            "joined"."groupKey" AS "groupKey",
            "joined"."rowIdentifier" AS "rowIdentifier",
            "joined"."rowData" AS "rowData"
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
            FROM "leftRows"
            LEFT JOIN "rightRows"
              ON "rightRows"."groupKey" IS NOT DISTINCT FROM "leftRows"."groupKey"
              AND "rightRows"."rightJoinKey" IS NOT DISTINCT FROM "leftRows"."leftJoinKey"
          ) AS "joined"
          ORDER BY "joined"."groupKey", "joined"."rowIdentifier"
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
