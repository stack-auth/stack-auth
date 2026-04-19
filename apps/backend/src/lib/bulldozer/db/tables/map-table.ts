import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import type { Table } from "..";
import type { Json, RowData, SqlMapper, TableId } from "../utilities";
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

export function declareMapTable<
  GK extends Json,
  OldRD extends RowData,
  NewRD extends RowData,
>(options: {
  tableId: TableId,
  fromTable: Table<GK, any, OldRD>,
  mapper: SqlMapper<OldRD, NewRD>,
}): Table<GK, null, NewRD> {
  const nestedFlatMapTable = declareFlatMapTable({
    tableId: { tableType: "internal", internalId: "map", parent: options.tableId },
    fromTable: options.fromTable,
    mapper: sqlMapper`
      jsonb_build_array(
        COALESCE(
          (
            SELECT to_jsonb("mapped")
            FROM (
              SELECT ${options.mapper}
            ) AS "mapped"
          ),
          'null'::jsonb
        )
      ) AS "rows"
    `,
  });

  return {
    tableId: options.tableId,
    inputTables: [options.fromTable],
    debugArgs: {
      operator: "map",
      tableId: tableIdToDebugString(options.tableId),
      fromTableId: tableIdToDebugString(options.fromTable.tableId),
      mapperSql: options.mapper.sql,
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
