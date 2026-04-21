import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

import { BULLDOZER_SORT_HELPERS_SQL } from "./bulldozer-sort-helpers-sql";
import type { BulldozerExecutionContext } from "./execution-context";
import { getBulldozerExecutionContext } from "./execution-context";
import type { RegisteredRowChangeTrigger, RowChangeTriggerInput } from "./row-change-trigger-dispatch";
import type { Json, RowData, RowIdentifier, SqlExpression, SqlQuery, SqlStatement, TableId } from "./utilities";
import { quoteSqlIdentifier, quoteSqlStringLiteral } from "./utilities";

// ====== Table implementations ======
// IMPORTANT NOTE: For every new table implementation, we should also add tests (unit, fuzzing, & perf; including an entry in the "hundreds of thousands" perf test), an example in the example schema, and support in Bulldozer Studio.

export type Table<GK extends Json, SK extends Json, RD extends RowData> = {
  tableId: TableId,
  inputTables: Table<any, any, any>[],
  debugArgs: Record<string, unknown>,

  // Query groups and rows
  listGroups(
    ctx: BulldozerExecutionContext,
    options: { start: SqlExpression<GK> | "start", end: SqlExpression<GK> | "end", startInclusive: boolean, endInclusive: boolean },
  ): SqlQuery<Iterable<{ groupKey: GK }>>,
  /**
   * Rows queried across all groups may include `groupKey`; rows queried for a specific `groupKey`
   * may omit it.
   */
  listRowsInGroup(
    ctx: BulldozerExecutionContext,
    options: { groupKey?: SqlExpression<GK>, start: SqlExpression<SK> | "start", end: SqlExpression<SK> | "end", startInclusive: boolean, endInclusive: boolean },
  ): SqlQuery<Iterable<{ groupKey?: GK, rowIdentifier: RowIdentifier, rowSortKey: SK, rowData: RD }>>,

  // Sorting and grouping
  compareGroupKeys(a: SqlExpression<GK>, b: SqlExpression<GK>): SqlExpression<number>,
  compareSortKeys(a: SqlExpression<SK>, b: SqlExpression<SK>): SqlExpression<number>,

  // Lifecycle/migration methods
  /** Called when the table should be created on the storage engine. */
  init(ctx: BulldozerExecutionContext): SqlStatement[],
  /** Called when the table should be deleted from the storage engine. */
  delete(ctx: BulldozerExecutionContext): SqlStatement[],
  isInitialized(ctx: BulldozerExecutionContext): SqlExpression<boolean>,

  // Internal methods, used only by table constructors to create relationships between them
  /**
   * @param trigger A SQL statement that can reference the changes table with columns `groupKey: GK`, `rowIdentifier: RowIdentifier`, `oldRowSortKey: SK | null`, `newRowSortKey: SK | null`, `oldRowData: RowData | null`, `newRowData: RowData | null`. Note that this trigger should be a no-op if the table that created this trigger is not initialized.
   */
  registerRowChangeTrigger(trigger: RowChangeTriggerInput): { deregister: () => void },

  /** Returns a query producing error rows if materialized data differs from re-derivation from inputs. Empty result = healthy. */
  verifyDataIntegrity(ctx: BulldozerExecutionContext): SqlQuery<Iterable<{ errorType: string, groupKey: GK | null, rowIdentifier: RowIdentifier | null, expected: Json | null, actual: Json | null }>>,
};

export type { RegisteredRowChangeTrigger };
export type { BulldozerExecutionContext } from "./execution-context";
export { createBulldozerExecutionContext, getBulldozerExecutionContext } from "./execution-context";

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
const BULLDOZER_SEQ_TABLE_NAME = "__bulldozer_seq";
const BULLDOZER_SEQ_TABLE_SQL = `CREATE TEMP TABLE IF NOT EXISTS "${BULLDOZER_SEQ_TABLE_NAME}" ("__output_name" text NOT NULL, "__output_row" jsonb NOT NULL) ON COMMIT DROP;`;

export function toQueryableSqlQuery(query: SqlQuery): string {
  return query.sql;
}

/**
 * Core body-builder shared by `toExecutableSqlTransaction` and
 * `toCascadeSqlBlock`. Serializes a list of `SqlStatement`s into a single
 * string suitable to drop into a plpgsql DO block, rewriting references to
 * named outputs into `__bulldozer_seq` subqueries.
 *
 * `seededSeqOutputs` lets callers pretend a given `__output_name` has
 * already been produced by an upstream statement. Used by the timefold
 * queue-drain cascade, which pre-populates `__bulldozer_seq` in plpgsql
 * BEFORE executing the stored cascade template.
 */
function buildExecutableStatementsBlock(
  statements: SqlStatement[],
  seededSeqOutputs: Map<string, string>,
): string {
  const seqOutputs = new Map<string, string>(seededSeqOutputs);
  return statements.map((statement) => {
    let sql = statement.sql;
    for (const [outputName, outputColumns] of seqOutputs) {
      const quotedOutputName = `"${outputName}"`;
      if (!sql.includes(quotedOutputName)) continue;
      const outputColumnsSelectList = outputColumns.split(",").map((columnDefinition) => {
        const trimmedColumnDefinition = columnDefinition.trim();
        const parts = trimmedColumnDefinition.split(/\s+/);
        const columnName = parts[0];
        const columnType = parts.slice(1).join(" ");
        if (columnType === "jsonb") {
          return `COALESCE(r.${columnName}, 'null'::jsonb) AS ${columnName}`;
        }
        return `r.${columnName}`;
      }).join(", ");
      const outputNameLiteral = quoteSqlStringLiteral(outputName).sql;
      const outputLookupSubquery = `(SELECT ${outputColumnsSelectList} FROM "${BULLDOZER_SEQ_TABLE_NAME}" AS "__s", LATERAL jsonb_to_record("__s"."__output_row") AS r(${outputColumns}) WHERE "__s"."__output_name" = ${outputNameLiteral})`;
      sql = sql.replaceAll(`${quotedOutputName} AS `, `${outputLookupSubquery} AS `);
      sql = sql.replaceAll(quotedOutputName, `${outputLookupSubquery} AS ${quotedOutputName}`);
    }

    const executableSql = statement.outputName == null
      ? sql
      : statement.outputColumns == null
        ? deindent`
            CREATE TEMP TABLE ${quoteSqlIdentifier(statement.outputName).sql} ON COMMIT DROP AS
            WITH "__statement_output" AS (
              ${sql}
            )
            SELECT * FROM "__statement_output"
          `
        : (() => {
            seqOutputs.set(statement.outputName, statement.outputColumns);
            const outputNameLiteral = quoteSqlStringLiteral(statement.outputName).sql;
            return deindent`
              INSERT INTO "${BULLDOZER_SEQ_TABLE_NAME}" ("__output_name", "__output_row")
              SELECT ${outputNameLiteral}, to_jsonb("__statement_output")
              FROM (
                ${sql}
              ) AS "__statement_output"
            `;
        })();

    const normalizedSql = executableSql.trimEnd();
    return normalizedSql.endsWith(";")
      ? normalizedSql
      : `${normalizedSql};`;
  }).join("\n\n");
}

export function toExecutableSqlTransaction(
  ctx: BulldozerExecutionContext,
  statements: SqlStatement[],
  options: { statementTimeout?: string } = {},
): string {
  const requiresSortHelpers = statements.some((statement) => statement.sql.includes("pg_temp.bulldozer_sort_"));
  const executableStatementsInDoBlock = buildExecutableStatementsBlock(statements, new Map());
  // Derive the outer DO-block delimiter from the execution context so nested `$$` that individual
  // statements legitimately use (e.g. `CREATE FUNCTION ... AS $$ ... $$`
  // in `reduce-table.ts`) don't collide with it, and so user-provided SQL
  // containing a literal `'$$'` string doesn't need to be rewritten. The helper
  // retries deterministically until it finds a safe tag. Same approach as
  // `toCascadeSqlBlock` below.
  const outerTag = chooseSafeDollarQuoteTag(ctx, executableStatementsInDoBlock, "bulldozer_tx");

  return deindent`
    BEGIN;

    SET LOCAL jit = off;
    ${options.statementTimeout ? `SET LOCAL statement_timeout = ${quoteSqlStringLiteral(options.statementTimeout).sql};` : ""}

    SELECT pg_advisory_xact_lock(${BULLDOZER_LOCK_ID});

    ${requiresSortHelpers ? BULLDOZER_SORT_HELPERS_SQL : ""}

    ${BULLDOZER_SEQ_TABLE_SQL}

    DO $${outerTag}$
    BEGIN
      ${executableStatementsInDoBlock}
    END;
    $${outerTag}$ LANGUAGE plpgsql;

    COMMIT;
  `;
}

/**
 * Picks a plpgsql dollar-quote tag that is guaranteed not to appear
 * verbatim inside `bodyContents`.
 *
 * We need this for any `DO $tag$ ... $tag$` block whose body is
 * concatenated from caller-supplied SQL: a naive fixed `$tag$` would
 * close the outer block prematurely if any embedded statement happened
 * to include the same literal `$tag$` (e.g. a user filter predicate
 * that references the string, or a comment, or a CASE branch).
 *
 * We derive suffixes deterministically from the execution context and
 * retry on collision with the body contents. This preserves deterministic
 * SQL generation while still ensuring the chosen tag is safe.
 */
function chooseSafeDollarQuoteTag(
  ctx: BulldozerExecutionContext,
  bodyContents: string,
  tagPrefix: string,
): string {
  const executionCtx = getBulldozerExecutionContext(ctx);
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const tag = `${tagPrefix}_${executionCtx.generateDeterministicUniqueString()}`;
    if (!bodyContents.includes(`$${tag}$`)) {
      return tag;
    }
  }
  throw new StackAssertionError("Could not find a safe deterministic dollar-quote tag", { tagPrefix });
}

/**
 * Compiles a downstream-trigger cascade into a plpgsql `DO` block body that
 * can be stored in `BulldozerTimeFoldDownstreamCascade.cascadeTemplate` and
 * EXECUTEd by `bulldozer_timefold_process_queue()` at runtime.
 *
 * The generated body:
 *  - Assumes the caller has already populated `__bulldozer_seq` under
 *    `cascadeInputName` with rows matching `cascadeInputColumns`.
 *  - Does NOT acquire the advisory lock or SET LOCAL settings — that
 *    responsibility belongs to the function wrapping the cascade.
 *  - Wraps the statement sequence in a `DO $<safe-tag>$ ... $<safe-tag>$`
 *    block so `EXECUTE` in plpgsql can run it as a single dispatch. The
 *    tag is deterministically derived from the execution context and retried
 *    until safe, so user-supplied SQL can never contain a literal copy of it
 *    and close the outer DO block early
 *    (see `chooseSafeDollarQuoteTag`).
 *
 * If the downstream trigger graph is empty (no filters/maps/etc. registered),
 * returns `null`. Callers should skip the EXECUTE in that case.
 */
export function toCascadeSqlBlock(ctx: BulldozerExecutionContext, options: {
  cascadeInputName: string,
  cascadeInputColumns: string,
  statements: SqlStatement[],
}): string | null {
  if (options.statements.length === 0) return null;
  const seeded = new Map<string, string>([[options.cascadeInputName, options.cascadeInputColumns]]);
  const body = buildExecutableStatementsBlock(options.statements, seeded);
  const requiresSortHelpers = options.statements.some((statement) => statement.sql.includes("pg_temp.bulldozer_sort_"));
  // Sort helpers use their own $$ dollar quoting inside `CREATE OR REPLACE
  // FUNCTION` bodies. They live inside the outer DO so they share the
  // enclosing transaction's pg_temp scope with the cascade statements. The
  // outer tag is generated deterministically below so nested $$ (or any other fixed tag in
  // user SQL) can't close it.
  const prelude = requiresSortHelpers ? BULLDOZER_SORT_HELPERS_SQL : "";
  const outerTag = chooseSafeDollarQuoteTag(ctx, `${prelude}\n${body}`, "tf_cascade");
  return deindent`
    DO $${outerTag}$
    BEGIN
      ${prelude}
      ${body}
    END;
    $${outerTag}$ LANGUAGE plpgsql;
  `;
}
