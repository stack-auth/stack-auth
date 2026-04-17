import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import type { Table } from "..";
import { attachRowChangeTriggerMetadata, normalizeRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { RegisteredRowChangeTrigger } from "../row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlStatement, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  getTablePathSegments,
  quoteSqlIdentifier,
  quoteSqlJsonbLiteral,
  quoteSqlStringLiteral,
  singleNullSortKeyRangePredicate,
  sqlArray,
  sqlExpression,
  sqlQuery,
  sqlStatement,
  tableIdToDebugString,
} from "../utilities";

export function declareConcatTable<
  GK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  tables: Table<GK, any, RD>[],
}): Table<GK, null, RD> {
  const tables = [...options.tables];
  const firstTable = tables[0] ?? (() => {
    throw new StackAssertionError("declareConcatTable requires at least one input table", { tableId: options.tableId });
  })();
  const referenceCompareGroupKeysSql = firstTable.compareGroupKeys(sqlExpression`$1`, sqlExpression`$2`).sql;
  for (const table of tables) {
    const compareGroupKeysSql = table.compareGroupKeys(sqlExpression`$1`, sqlExpression`$2`).sql;
    if (compareGroupKeysSql !== referenceCompareGroupKeysSql) {
      throw new StackAssertionError("declareConcatTable requires group-comparator-compatible input tables", {
        tableId: options.tableId,
        tableDebugId: tableIdToDebugString(table.tableId),
      });
    }
  }
  const triggers = new Map<string, RegisteredRowChangeTrigger>();
  const rawExpression = <T>(sql: string): SqlExpression<T> => ({ type: "expression", sql });
  const isInitializedExpression = sqlExpression`
    EXISTS (
      SELECT 1 FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
    )
  `;
  const createConcatenatedRowIdentifierSql = (tableIndex: number, rowIdentifierSql: string) =>
    `${quoteSqlStringLiteral(`${tableIndex}:`).sql} || ${rowIdentifierSql}`;
  const getInputInitializedSql = (table: Table<GK, any, RD>) => table.isInitialized().sql;
  const getUnionedListGroupsSql = (queryOptions: Parameters<typeof firstTable.listGroups>[0]) => {
    return tables
      .map((table) => deindent`
        SELECT "sourceGroups"."groupkey" AS "groupKey"
        FROM (${table.listGroups(queryOptions).sql}) AS "sourceGroups"
        WHERE ${getInputInitializedSql(table)}
      `)
      .join("\nUNION ALL\n");
  };
  const getUnionedListRowsSql = (queryOptions: Parameters<typeof firstTable.listRowsInGroup>[0] & { allGroups: boolean }) => {
    return tables.map((table, tableIndex) => {
      if (queryOptions.allGroups) {
        return deindent`
          SELECT
            "sourceRows"."groupkey" AS "groupKey",
            ${createConcatenatedRowIdentifierSql(tableIndex, `"sourceRows"."rowidentifier"`)} AS "rowIdentifier",
            'null'::jsonb AS "rowSortKey",
            "sourceRows"."rowdata" AS "rowData"
          FROM (${table.listRowsInGroup({
            start: "start",
            end: "end",
            startInclusive: true,
            endInclusive: true,
          }).sql}) AS "sourceRows"
          WHERE ${getInputInitializedSql(table)}
        `;
      }
      const groupKey = queryOptions.groupKey ?? (() => {
        throw new StackAssertionError("declareConcatTable specific-group query requires a group key");
      })();
      return deindent`
        SELECT
          ${createConcatenatedRowIdentifierSql(tableIndex, `"sourceRows"."rowidentifier"`)} AS "rowIdentifier",
          'null'::jsonb AS "rowSortKey",
          "sourceRows"."rowdata" AS "rowData"
        FROM (${table.listRowsInGroup({
          groupKey,
          start: "start",
          end: "end",
          startInclusive: true,
          endInclusive: true,
        }).sql}) AS "sourceRows"
        WHERE ${getInputInitializedSql(table)}
      `;
    }).join("\nUNION ALL\n");
  };
  const createInputTriggerStatements = (
    table: Table<GK, any, RD>,
    tableIndex: number,
    changesTable: SqlExpression<{ __brand: "$SQL_Table" }>,
  ) => {
    const concatChangesTableName = `concat_changes_${generateSecureRandomString()}`;
    return [
      sqlQuery`
        SELECT
          "changes"."groupKey" AS "groupKey",
          ${rawExpression<RowIdentifier>(createConcatenatedRowIdentifierSql(tableIndex, `"changes"."rowIdentifier"`))} AS "rowIdentifier",
          'null'::jsonb AS "oldRowSortKey",
          'null'::jsonb AS "newRowSortKey",
          "changes"."oldRowData" AS "oldRowData",
          "changes"."newRowData" AS "newRowData"
        FROM ${changesTable} AS "changes"
        WHERE ${isInitializedExpression}
          AND ${rawExpression<boolean>(getInputInitializedSql(table))}
      `.toStatement(concatChangesTableName, '"groupKey" jsonb, "rowIdentifier" text, "oldRowSortKey" jsonb, "newRowSortKey" jsonb, "oldRowData" jsonb, "newRowData" jsonb'),
    ];
  };
  tables.forEach((table, tableIndex) => {
    const fromTableTrigger = attachRowChangeTriggerMetadata(
      (changesTable) => createInputTriggerStatements(table, tableIndex, changesTable),
      {
        targetTableId: tableIdToDebugString(options.tableId),
        targetTableTriggers: triggers,
      },
    );
    table.registerRowChangeTrigger(fromTableTrigger);
  });

  return {
    tableId: options.tableId,
    inputTables: tables,
    debugArgs: {
      operator: "concat",
      tableId: tableIdToDebugString(options.tableId),
      inputTableIds: tables.map((table) => tableIdToDebugString(table.tableId)),
    },
    listGroups: ({ start, end, startInclusive, endInclusive }) => sqlQuery`
      SELECT DISTINCT "concatGroups"."groupKey" AS groupKey
      FROM (${rawExpression(getUnionedListGroupsSql({ start, end, startInclusive, endInclusive }))}) AS "concatGroups"
      WHERE ${isInitializedExpression}
    `,
    listRowsInGroup: ({ groupKey, start, end, startInclusive, endInclusive }) => groupKey != null ? sqlQuery`
      SELECT
        "concatRows"."rowIdentifier" AS rowIdentifier,
        "concatRows"."rowSortKey" AS rowSortKey,
        "concatRows"."rowData" AS rowData
      FROM (${rawExpression(getUnionedListRowsSql({
        groupKey,
        start,
        end,
        startInclusive,
        endInclusive,
        allGroups: false,
      }))}) AS "concatRows"
      WHERE ${isInitializedExpression}
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    ` : sqlQuery`
      SELECT
        "concatRows"."groupKey" AS groupKey,
        "concatRows"."rowIdentifier" AS rowIdentifier,
        "concatRows"."rowSortKey" AS rowSortKey,
        "concatRows"."rowData" AS rowData
      FROM (${rawExpression(getUnionedListRowsSql({
        start,
        end,
        startInclusive,
        endInclusive,
        allGroups: true,
      }))}) AS "concatRows"
      WHERE ${isInitializedExpression}
        AND ${singleNullSortKeyRangePredicate({ start, end, startInclusive, endInclusive })}
    `,
    compareGroupKeys: firstTable.compareGroupKeys,
    compareSortKeys: () => sqlExpression`0`,
    init: () => {
      return [sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        VALUES
        (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
        (gen_random_uuid(), ${sqlArray([...getTablePathSegments(options.tableId), quoteSqlJsonbLiteral("table")])}::jsonb[], 'null'::jsonb),
        (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}::jsonb[], 'null'::jsonb),
        (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[], '{ "version": 1 }'::jsonb)
      `];
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
    registerRowChangeTrigger: (trigger) => {
      const id = generateSecureRandomString();
      triggers.set(id, normalizeRowChangeTrigger(trigger));
      return { deregister: () => triggers.delete(id) };
    },
    verifyDataIntegrity: () => sqlQuery`
      SELECT NULL::text AS errortype, NULL::jsonb AS groupkey, NULL::text AS rowidentifier, NULL::jsonb AS expected, NULL::jsonb AS actual
      WHERE false
    `,
  };
}
