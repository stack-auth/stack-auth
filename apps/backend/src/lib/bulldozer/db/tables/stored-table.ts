import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import type { Table } from "..";
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
  setRow(rowIdentifier: RowIdentifier, rowData: SqlExpression<RD>): SqlStatement[],
  deleteRow(rowIdentifier: RowIdentifier): SqlStatement[],
} {
  const triggers = new Map<string, RegisteredRowChangeTrigger>();

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
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getTablePath(options.tableId)}::jsonb[]
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
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey == null ? sqlQuery`
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
      const id = generateSecureRandomString();
      triggers.set(id, normalizeRowChangeTrigger(trigger));
      return { deregister: () => triggers.delete(id) };
    },
    verifyDataIntegrity: () => sqlQuery`
      SELECT NULL::text AS errortype, NULL::jsonb AS groupkey, NULL::text AS rowidentifier, NULL::jsonb AS expected, NULL::jsonb AS actual
      WHERE false
    `,
    setRow: (rowIdentifier, rowData) => {
      const oldRowsTableName = `old_rows_${generateSecureRandomString()}`;
      const upsertedRowsTableName = `upserted_rows_${generateSecureRandomString()}`;
      const changesTableName = `changes_${generateSecureRandomString()}`;
      const collectedTriggers = collectRowChangeTriggerStatements({
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
    deleteRow: (rowIdentifier) => {
      const deletedRowsTableName = `deleted_rows_${generateSecureRandomString()}`;
      const changesTableName = `changes_${generateSecureRandomString()}`;
      const collectedTriggers = collectRowChangeTriggerStatements({
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
