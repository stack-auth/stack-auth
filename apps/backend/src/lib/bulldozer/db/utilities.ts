import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { templateIdentity } from "@stackframe/stack-shared/dist/utils/strings";

const sqlTemplateLiteral = <T>(type: T) => (strings: TemplateStringsArray, ...values: { sql: string }[]) => ({ type, sql: templateIdentity(strings, ...values.map(v => v.sql)) });

export type SqlStatement = { type: "statement", outputName?: string, outputColumns?: string, sql: string, requiresSequentialExecution?: boolean };
export const sqlStatement = sqlTemplateLiteral<"statement">("statement");

export type SqlQuery<R extends void | Iterable<unknown> = void> = { type: "query", sql: string, toStatement(outputName?: string, outputColumns?: string): SqlStatement };
export const sqlQuery = (...args: Parameters<ReturnType<typeof sqlTemplateLiteral<"query">>>) => {
  return {
    ...sqlTemplateLiteral<"query">("query")(...args),
    toStatement(outputName?: string, outputColumns?: string) {
      return { type: "statement", outputName, outputColumns, sql: this.sql } as const;
    }
  };
};

export type SqlExpression<T> = { type: "expression", sql: string };
export const sqlExpression = sqlTemplateLiteral<"expression">("expression");

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];
export type RowData = Record<string, Json>;
export type Timestamp = string;
export type SqlMapper<OldRD extends RowData, NewRD extends RowData> = { type: "mapper", sql: string };  // ex.: "row.id AS id, row.old_value + 1 AS new_value"
export const sqlMapper = sqlTemplateLiteral<"mapper">("mapper");
export type SqlPredicate<RD extends RowData> = { type: "predicate", sql: string };  // ex.: "user_id = 123"
export const sqlPredicate = sqlTemplateLiteral<"predicate">("predicate");

export const sqlArray = (exprs: (SqlExpression<Json> | SqlMapper<any, any>)[]) => ({ type: "expression", sql: `ARRAY[${exprs.map(e => e.sql).join(", ")}]` } as const);

export type RowIdentifier = string;
export type TableId = string | { "tableType": "internal", "internalId": string, "parent": null | TableId };

export function quoteSqlIdentifier(input: string): SqlExpression<string> {
  if (input.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) == null) {
    throw new StackAssertionError("Invalid SQL identifier", { input });
  }
  return { type: "expression", sql: `"${input}"` };
}
export function quoteSqlStringLiteral(input: string): SqlExpression<string> {
  return { type: "expression", sql: `'${input.replaceAll("'", "''")}'` };
}
export function quoteSqlJsonbLiteral(input: Json): SqlExpression<Json> {
  return { type: "expression", sql: `${quoteSqlStringLiteral(JSON.stringify(input)).sql}::jsonb` };
}
export function getTablePath(tableId: TableId): SqlExpression<Json[]> {
  return sqlArray(getTablePathSegments(tableId));
}
export function getStorageEnginePath(tableId: TableId, path: (string | SqlExpression<Json> | SqlMapper<any, any>)[]): SqlExpression<Json[]> {
  return sqlArray([
    ...getTablePathSegments(tableId),
    quoteSqlJsonbLiteral("storage"),
    ...path.map(p => typeof p === "string" ? quoteSqlJsonbLiteral(p) : p),
  ]);
}
export function getTablePathSegments(tableId: TableId): SqlExpression<Json>[] {
  const tableIdWithParents = [];
  let currentTableId = tableId;
  while (true) {
    if (typeof currentTableId === "string") {
      tableIdWithParents.push(`external:${currentTableId}`);
      break;
    } else {
      tableIdWithParents.push(`internal:${currentTableId.internalId}`);
      if (currentTableId.parent === null) break;
      currentTableId = currentTableId.parent;
    }
  }
  return [
    ...tableIdWithParents.reverse().flatMap(id => ["table", id]),
  ].map(id => quoteSqlJsonbLiteral(id));
}
export function tableIdToDebugString(tableId: TableId): string {
  return typeof tableId === "string"
    ? tableId
    : JSON.stringify(tableId);
}
export function singleNullSortKeyRangePredicate(options: {
  start: SqlExpression<unknown> | "start",
  end: SqlExpression<unknown> | "end",
  startInclusive: boolean,
  endInclusive: boolean,
}): SqlExpression<boolean> {
  return (options.start === "start" || options.startInclusive) && (options.end === "end" || options.endInclusive)
    ? sqlExpression`1 = 1`
    : sqlExpression`1 = 0`;
}
