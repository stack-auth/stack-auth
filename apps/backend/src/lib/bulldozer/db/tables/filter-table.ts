import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import type { Table } from "..";
import type { Json, RowData, SqlPredicate, TableId } from "../utilities";
import {
  getStorageEnginePath,
  getTablePath,
  getTablePathSegments,
  quoteSqlJsonbLiteral,
  sqlArray,
  sqlExpression,
  sqlMapper,
  sqlStatement,
  tableIdToDebugString
} from "../utilities";
import { declareFlatMapTable } from "./flat-map-table";

export function declareFilterTable<
  GK extends Json,
  RD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, RD>,
  filter: SqlPredicate<RD>,
}): Table<GK, null, RD> {
  const nestedFlatMapTable = declareFlatMapTable({
    tableId: { tableType: "internal", internalId: "filter", parent: options.tableId },
    fromTable: options.fromTable,
    mapper: sqlMapper`
      CASE
        WHEN ${options.filter}
          THEN jsonb_build_array("rowData")
        ELSE '[]'::jsonb
      END AS "rows"
    `,
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "filter",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      filterSql: options.filter.sql,
    },
    init: (ctx) => [
      sqlStatement`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        VALUES
        (gen_random_uuid(), ${getTablePath(options.tableId)}, 'null'::jsonb),
        (gen_random_uuid(), ${sqlArray([...getTablePathSegments(options.tableId), quoteSqlJsonbLiteral("table")])}::jsonb[], 'null'::jsonb),
        (gen_random_uuid(), ${getStorageEnginePath(options.tableId, [])}::jsonb[], 'null'::jsonb),
        (gen_random_uuid(), ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[], '{ "version": 1 }'::jsonb)
      `,
      ...nestedFlatMapTable.init(ctx),
    ],
    delete: (_ctx) => [sqlStatement`
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
    isInitialized: (_ctx) => sqlExpression`
      EXISTS (
        SELECT 1 FROM "BulldozerStorageEngine"
        WHERE "keyPath" = ${getStorageEnginePath(options.tableId, ["metadata"])}::jsonb[]
      )
    `,
    ...pick(nestedFlatMapTable, [
      "compareGroupKeys",
      "compareSortKeys",
      "listGroups",
      "listRowsInGroup",
      "registerRowChangeTrigger",
      "verifyDataIntegrity",
    ]),
  };
}
