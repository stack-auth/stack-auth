import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

import { BULLDOZER_SORT_HELPERS_SQL } from "./bulldozer-sort-helpers-sql";
import type { RegisteredRowChangeTrigger, RowChangeTriggerInput } from "./row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlQuery, SqlStatement, TableId } from "./utilities";
import { quoteSqlIdentifier } from "./utilities";

// ====== Table implementations ======
// IMPORTANT NOTE: For every new table implementation, we should also add tests (unit, fuzzing, & perf; including an entry in the "hundreds of thousands" perf test), an example in the example schema, and support in Bulldozer Studio.

export type Table<GK extends Json, SK extends Json, RD extends RowData> = {
  tableId: TableId,
  inputTables: Table<any, any, any>[],
  debugArgs: Record<string, unknown>,

  // Query groups and rows
  listGroups(options: { start: SqlExpression<GK> | "start", end: SqlExpression<GK> | "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery<Iterable<{ groupKey: GK }>>,
  /**
   * Rows queried across all groups may include `groupKey`; rows queried for a specific `groupKey`
   * may omit it.
   */
  listRowsInGroup(options: { groupKey?: SqlExpression<GK>, start: SqlExpression<SK> | "start", end: SqlExpression<SK> | "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery<Iterable<{ groupKey?: GK, rowIdentifier: RowIdentifier, rowSortKey: SK, rowData: RD }>>,

  // Sorting and grouping
  compareGroupKeys(a: SqlExpression<GK>, b: SqlExpression<GK>): SqlExpression<number>,
  compareSortKeys(a: SqlExpression<SK>, b: SqlExpression<SK>): SqlExpression<number>,

  // Lifecycle/migration methods
  /** Called when the table should be created on the storage engine. */
  init(): SqlStatement[],
  /** Called when the table should be deleted from the storage engine. */
  delete(): SqlStatement[],
  isInitialized(): SqlExpression<boolean>,

  // Internal methods, used only by table constructors to create relationships between them
  /**
   * @param trigger A SQL statement that can reference the changes table with columns `groupKey: GK`, `rowIdentifier: RowIdentifier`, `oldRowSortKey: SK | null`, `newRowSortKey: SK | null`, `oldRowData: RowData | null`, `newRowData: RowData | null`. Note that this trigger should be a no-op if the table that created this trigger is not initialized.
   */
  registerRowChangeTrigger(trigger: RowChangeTriggerInput): { deregister: () => void },

  /** Returns a query producing error rows if materialized data differs from re-derivation from inputs. Empty result = healthy. */
  verifyDataIntegrity(): SqlQuery<Iterable<{ errorType: string, groupKey: GK | null, rowIdentifier: RowIdentifier | null, expected: Json | null, actual: Json | null }>>,
};

export type { RegisteredRowChangeTrigger };

export { declareCompactTable } from "./tables/compact-table";
export { declareConcatTable } from "./tables/concat-table";
export { declareFilterTable } from "./tables/filter-table";
export { declareFlatMapTable } from "./tables/flat-map-table";
export { declareGroupByTable } from "./tables/group-by-table";
export { declareLFoldTable } from "./tables/l-fold-table";
export { declareLeftJoinTable } from "./tables/left-join-table";
export { declareLimitTable } from "./tables/limit-table";
export { declareMapTable } from "./tables/map-table";
export { declareReduceTable } from "./tables/reduce-table";
export { declareSortTable } from "./tables/sort-table";
export { declareStoredTable } from "./tables/stored-table";
export { declareTimeFoldTable } from "./tables/time-fold-table";

const BULLDOZER_LOCK_ID = 7857391;  // random number to avoid conflicts with other applications

export function toQueryableSqlQuery(query: SqlQuery): string {
  return query.sql;
}
export function toExecutableSqlStatements(statements: SqlStatement[]): string {
  const requiresSortHelpers = statements.some((statement) => statement.sql.includes("pg_temp.bulldozer_sort_"));
  const requiresSequentialExecutor = requiresSortHelpers || statements.some((statement) => statement.requiresSequentialExecution === true);
  if (!requiresSequentialExecutor) {
    return deindent`
      WITH __dummy_statement_1__ AS (SELECT 1),
      ${statements.map(statement => deindent`
        ${quoteSqlIdentifier(statement.outputName ?? `unnamed_statement_${generateSecureRandomString().slice(0, 8)}`).sql} AS (
          ${statement.sql}
        ),
      `).join("\n")}
      __dummy_statement_2__ AS (SELECT 1)
      SELECT 1;
    `;
  }

  const seqOutputs = new Map<string, string>();
  const executableStatements = statements.map((statement) => {
    let sql = statement.sql;
    for (const [name, columns] of seqOutputs) {
      const quotedName = `"${name}"`;
      if (sql.includes(quotedName)) {
        const colList = columns.split(",").map(c => {
          const trimmed = c.trim();
          const parts = trimmed.split(/\s+/);
          const colName = parts[0];
          const colType = parts.slice(1).join(" ");
          if (colType === "jsonb") {
            return `COALESCE(r.${colName}, 'null'::jsonb) AS ${colName}`;
          }
          return `r.${colName}`;
        }).join(", ");
        const subquery = `(SELECT ${colList} FROM "__bulldozer_seq" AS "__s", LATERAL jsonb_to_record("__s"."__output_row") AS r(${columns}) WHERE "__s"."__output_name" = '${name}')`;
        sql = sql.replaceAll(`${quotedName} AS `, `${subquery} AS `);
        sql = sql.replaceAll(quotedName, `${subquery} AS ${quotedName}`);
      }
    }
    if (statement.outputName == null) {
      return `${sql};`;
    }
    if (statement.outputColumns == null) {
      return deindent`
        CREATE TEMP TABLE ${quoteSqlIdentifier(statement.outputName).sql} ON COMMIT DROP AS
        WITH "__statement_output" AS (
          ${sql}
        )
        SELECT * FROM "__statement_output";
      `;
    }
    seqOutputs.set(statement.outputName, statement.outputColumns);
    return deindent`
      INSERT INTO "__bulldozer_seq" ("__output_name", "__output_row")
      SELECT '${statement.outputName}', to_jsonb("__statement_output")
      FROM (
        ${sql}
      ) AS "__statement_output";
    `;
  }).join("\n\n");
  return deindent`
    ${requiresSortHelpers ? BULLDOZER_SORT_HELPERS_SQL : ""}

    CREATE TEMP TABLE IF NOT EXISTS "__bulldozer_seq" ("__output_name" text NOT NULL, "__output_row" jsonb NOT NULL) ON COMMIT DROP;

    ${executableStatements}
  `;
}
export function toExecutableSqlTransaction(statements: SqlStatement[], options: { statementTimeout?: string } = {}): string {
  return deindent`
    BEGIN;

    SET LOCAL jit = off;
    ${options.statementTimeout ? `SET LOCAL statement_timeout = '${options.statementTimeout}';` : ""}

    SELECT pg_advisory_xact_lock(${BULLDOZER_LOCK_ID});

    ${toExecutableSqlStatements(statements)}

    COMMIT;
  `;
}
