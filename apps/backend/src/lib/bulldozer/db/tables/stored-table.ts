import type { Table } from "..";
import type { BulldozerExecutionContext } from "../execution-context";
import { getBulldozerExecutionContext } from "../execution-context";
import { collectRowChangeTriggerStatements, normalizeRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { RegisteredRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { RowData, RowIdentifier, SqlExpression, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  quoteSqlIdentifier,
  quoteSqlStringLiteral,
  singleNullSortKeyRangePredicate,
  sqlExpression,
  sqlQuery,
  sqlStatement,
  tableIdToDebugString,
} from "../utilities";

export function declareStoredTable<RD extends RowData>(options: {
  tableId: TableId,
}): Table<null, null, RD> & {
  setRow(ctx: BulldozerExecutionContext, rowIdentifier: RowIdentifier, rowData: SqlExpression<RD>): SqlStatement[],
  deleteRow(ctx: BulldozerExecutionContext, rowIdentifier: RowIdentifier): SqlStatement[],
} {
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
  let triggerRegistrationCount = 0;

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
    init: (_ctx) => [sqlStatement`
      INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
      VALUES
      (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
      (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}, 'null'::jsonb),
      (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["rows"])}, 'null'::jsonb),
      (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}, '{ "version": 1 }'::jsonb)
    `],
    delete: (_ctx) => [sqlStatement`
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getTablePath(options.tableId)}::jsonb[]
    `],
    isInitialized: (_ctx) => sqlExpression`
      EXISTS (
        SELECT 1 FROM "BulldozerStorageEngine"
        WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
      )
    `,
    listGroups: (_ctx, { start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT 'null'::jsonb AS groupKey
      WHERE ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    `,
    listRowsInGroup: (_ctx, { groupKey, start, end, startInclusive, endInclusive }) => groupKey == null ? sqlQuery`
      SELECT
        'null'::jsonb AS groupKey,
        ("keyPath"[cardinality("keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine"
      WHERE "keyPathParent" = ${getStorageEnginePath(options.tableId, ["rows"])}::jsonb[]
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    ` : sqlQuery`
      SELECT
        ("keyPath"[cardinality("keyPath")] #>> '{}') AS rowIdentifier,
        'null'::jsonb AS rowSortKey,
        "value"->'rowData' AS rowData
      FROM "BulldozerStorageEngine"
      WHERE "keyPathParent" = ${getStorageEnginePath(options.tableId, ["rows"])}::jsonb[]
        AND ${groupKey} IS NOT DISTINCT FROM 'null'::jsonb
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    `,
    registerRowChangeTrigger: (trigger) => {
      const id = `trigger_registration_${triggerRegistrationCount.toString(36).padStart(10, "0")}`;
      triggerRegistrationCount++;
      triggers.set(id, normalizeRowChangeTrigger(trigger));
      return { deregister: () => triggers.delete(id) };
    },
    verifyDataIntegrity: (_ctx) => sqlQuery`
      SELECT NULL::text AS errortype, NULL::jsonb AS groupkey, NULL::text AS rowidentifier, NULL::jsonb AS expected, NULL::jsonb AS actual
      WHERE false
    `,
    setRow: (ctx, rowIdentifier, rowData) => {
      const executionCtx = getBulldozerExecutionContext(ctx);
      const oldRowsTableName = `old_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const upsertedRowsTableName = `upserted_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const changesTableName = `changes_${executionCtx.generateDeterministicUniqueString()}`;
      const collectedTriggers = collectRowChangeTriggerStatements(executionCtx, {
        sourceTableId: tableIdToDebugString(options.tableId),
        sourceChangesTable: quoteSqlIdentifier(changesTableName),
        sourceTableTriggers: triggers,
      });
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
        `.toStatement(oldRowsTableName, '"oldRowData" jsonb'),
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
            "oldRowData" AS "oldRowData",
            "newRowData" AS "newRowData"
          FROM ${quoteSqlIdentifier(upsertedRowsTableName)}
          LEFT JOIN ${quoteSqlIdentifier(oldRowsTableName)} ON true
        `.toStatement(changesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
        ...collectedTriggers.statements,
      ];
    },
    deleteRow: (ctx, rowIdentifier) => {
      const executionCtx = getBulldozerExecutionContext(ctx);
      const deletedRowsTableName = `deleted_rows_${executionCtx.generateDeterministicUniqueString()}`;
      const changesTableName = `changes_${executionCtx.generateDeterministicUniqueString()}`;
      const collectedTriggers = collectRowChangeTriggerStatements(executionCtx, {
        sourceTableId: tableIdToDebugString(options.tableId),
        sourceChangesTable: quoteSqlIdentifier(changesTableName),
        sourceTableTriggers: triggers,
      });
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
        `.toStatement(changesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
        ...collectedTriggers.statements,
      ];
    },
  };
}
