import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent, stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import ELK from "elkjs/lib/elk.bundled.js";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { exampleFungibleLedgerSchema } from "../src/lib/bulldozer/db/example-schema";
import { toExecutableSqlTransaction, toQueryableSqlQuery } from "../src/lib/bulldozer/db/index";
import { quoteSqlJsonbLiteral, quoteSqlStringLiteral } from "../src/lib/bulldozer/db/utilities";
import { createPaymentsSchema } from "../src/lib/payments/schema/index";
import { globalPrismaClient, retryTransaction } from "../src/prisma-client";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type SqlExpression<T> = { type: "expression", sql: string };
type SqlStatement = { type: "statement", sql: string, outputName?: string, requiresSequentialExecution?: boolean };
type SqlQuery = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };
type AutoExplainMetadata = {
  enabled: boolean,
  setupError: string | null,
  logReadError: string | null,
  logPath: string | null,
  logReadBytes: number,
  markerFound: boolean,
  parsedEntryCount: number,
  parseErrorCount: number,
  rawLogExcerpt: string | null,
};
type StatementExecutionMetrics = {
  durationMs: number,
  statementCount: number,
  logicalStatementCount: number,
  executableStatementCount: number,
  sequentialStatementCount: number,
  uniqueTableReferenceCount: number,
  sqlScriptLength: number,
  sqlScript: string,
  firstStatementPreviews: Array<{ index: number, outputName: string | null, sqlPreview: string }>,
  lastStatementPreviews: Array<{ index: number, outputName: string | null, sqlPreview: string }>,
  topTableReferences: Array<{ tableId: string, statementReferences: number }>,
  timingBreakdown: {
    statementWallMsTotal: number,
    totalPlanningMs: number,
    totalExecutionMs: number,
    totalAutoExplainDurationMs: number,
    explainedStatementCount: number,
    notExplainedStatementCount: number,
  },
  slowestStatements: Array<{
    index: number,
    kind: string,
    outputName: string | null,
    wallMs: number,
    planningMs: number | null,
    executionMs: number | null,
    rootNodeType: string | null,
    actualRows: number | null,
    sharedHitBlocks: number | null,
    sharedReadBlocks: number | null,
    tempWrittenBlocks: number | null,
    walBytes: number | null,
    sqlPreview: string,
  }>,
  autoExplain: AutoExplainMetadata,
};

type StudioTable = {
  tableId: unknown,
  inputTables?: StudioTable[],
  debugArgs?: Record<string, unknown>,
  listGroups(options: { start: SqlExpression<unknown> | "start", end: SqlExpression<unknown> | "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery,
  listRowsInGroup(options: { groupKey?: SqlExpression<unknown>, start: SqlExpression<unknown> | "start", end: SqlExpression<unknown> | "end", startInclusive: boolean, endInclusive: boolean }): SqlQuery,
  init(): SqlStatement[],
  delete(): SqlStatement[],
  isInitialized(): SqlExpression<boolean>,
  registerRowChangeTrigger(trigger: (changesTable: SqlExpression<{ __brand: "$SQL_Table" }>) => SqlStatement[]): { deregister: () => void },
};

type StudioStoredTable = StudioTable & {
  setRow(rowIdentifier: string, rowData: SqlExpression<Record<string, JsonValue>>): SqlStatement[],
  deleteRow(rowIdentifier: string): SqlStatement[],
};

type StudioTableRecord = {
  id: string,
  name: string,
  table: StudioTable,
};

const STUDIO_PORT = Number(`${getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81")}39`);
const STUDIO_HOST = "127.0.0.1";
const BULLDOZER_LOCK_ID = 7857391;
const STUDIO_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const STUDIO_AUTH_TOKEN = getEnvVariable("STACK_BULLDOZER_STUDIO_AUTH_TOKEN", STUDIO_INSTANCE_ID);
const STUDIO_AUTH_HEADER = "x-stack-bulldozer-studio-token";
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const GRAPH_NODE_WIDTH = 260;
const GRAPH_NODE_HEIGHT = 126;
const GRAPH_LEVEL_GAP_Y = 230;
const GRAPH_COLUMN_GAP_X = 320;
const GRAPH_SCENE_MARGIN = 40;
const STATEMENT_SQL_PREVIEW_CHARS = 260;
const SLOW_STATEMENT_LIMIT = 20;
const AUTO_EXPLAIN_LOG_SAMPLE_BYTES = 8 * 1024 * 1024;
const AUTO_EXPLAIN_MAX_LOG_SAMPLE_BYTES = 24 * 1024 * 1024;
const AUTO_EXPLAIN_LOG_EXCERPT_CHARS = 12_000;
const elk = new ELK();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStudioTable(value: unknown): value is StudioTable {
  if (!isRecord(value)) return false;
  return typeof Reflect.get(value, "listGroups") === "function"
    && typeof Reflect.get(value, "listRowsInGroup") === "function"
    && typeof Reflect.get(value, "init") === "function"
    && typeof Reflect.get(value, "delete") === "function"
    && typeof Reflect.get(value, "isInitialized") === "function"
    && typeof Reflect.get(value, "registerRowChangeTrigger") === "function";
}

function isStudioStoredTable(value: StudioTable): value is StudioStoredTable {
  return typeof Reflect.get(value, "setRow") === "function"
    && typeof Reflect.get(value, "deleteRow") === "function";
}

function requireRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!isRecord(value)) throw new StackAssertionError(errorMessage);
  return value;
}

function requireString(value: unknown, errorMessage: string): string {
  if (typeof value !== "string") throw new StackAssertionError(errorMessage);
  return value;
}

function requireStringArray(value: unknown, errorMessage: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new StackAssertionError(errorMessage);
  }
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  if (isRecord(value)) {
    return Object.values(value).every((item) => isJsonValue(item));
  }
  return false;
}

function requireJsonValue(value: unknown, errorMessage: string): JsonValue {
  if (!isJsonValue(value)) {
    throw new StackAssertionError(errorMessage);
  }
  return value;
}

function keyPathSqlLiteral(pathSegments: string[]): string {
  if (pathSegments.length === 0) return "ARRAY[]::jsonb[]";
  return `ARRAY[${pathSegments.map((segment) => quoteSqlJsonbLiteral(segment).sql).join(", ")}]::jsonb[]`;
}

type AutoExplainParseResult = {
  parsedEntries: StatementExecutionMetrics["slowestStatements"],
  parseErrorCount: number,
};

type PostgresLogSnapshot = { path: string, size: number };

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toSqlPreview(sql: string): string {
  return sql.length <= STATEMENT_SQL_PREVIEW_CHARS
    ? sql
    : `${sql.slice(0, STATEMENT_SQL_PREVIEW_CHARS)}...`;
}

function statementKindFromSql(sql: string): string {
  const withoutLeadingComments = sql.replace(/^(\s*--[^\n]*\n)+/g, "").trimStart();
  const match = withoutLeadingComments.match(/^[A-Za-z]+/);
  return (match?.[0] ?? "UNKNOWN").toUpperCase();
}

function toNonNegativeInteger(value: unknown): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed == null || parsed < 0) return null;
  return Math.floor(parsed);
}

async function getCurrentPostgresLogSnapshot(): Promise<{ snapshot: PostgresLogSnapshot | null, error: string | null }> {
  try {
    const logPathRows = await globalPrismaClient.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT pg_current_logfile() AS "path"`);
    const logPath = typeof logPathRows[0]?.path === "string" ? logPathRows[0].path : null;
    if (logPath == null || logPath.trim() === "") {
      return { snapshot: null, error: "pg_current_logfile returned no active log file" };
    }
    const logPathLiteral = quoteSqlStringLiteral(logPath).sql;
    const logSizeRows = await globalPrismaClient.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT (pg_stat_file(${logPathLiteral})).size AS "size"`);
    const logSize = toNonNegativeInteger(logSizeRows[0]?.size);
    if (logSize == null) {
      return { snapshot: null, error: "Unable to read PostgreSQL log file size" };
    }
    return { snapshot: { path: logPath, size: logSize }, error: null };
  } catch (error) {
    return { snapshot: null, error: normalizeErrorMessage(error) };
  }
}

async function readPostgresLogChunk(path: string, offset: number, length: number): Promise<{ content: string | null, error: string | null }> {
  try {
    const pathLiteral = quoteSqlStringLiteral(path).sql;
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLength = Math.max(0, Math.floor(length));
    const rows = await globalPrismaClient.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT pg_read_file(${pathLiteral}, ${safeOffset}, ${safeLength}) AS "content"`);
    const content = typeof rows[0]?.content === "string" ? rows[0].content : null;
    if (content == null) {
      return { content: null, error: "pg_read_file returned no content" };
    }
    return { content, error: null };
  } catch (error) {
    return { content: null, error: normalizeErrorMessage(error) };
  }
}

function extractTextBetweenMarkers(content: string, startMarker: string, endMarker: string): { text: string, markerFound: boolean, startIndex: number, endIndex: number } {
  const startIndex = content.indexOf(startMarker);
  if (startIndex < 0) {
    return { text: content, markerFound: false, startIndex: -1, endIndex: -1 };
  }
  const endIndex = content.indexOf(endMarker, startIndex + startMarker.length);
  if (endIndex < 0) {
    return { text: content.slice(startIndex), markerFound: false, startIndex, endIndex: -1 };
  }
  return {
    text: content.slice(startIndex, endIndex + endMarker.length),
    markerFound: true,
    startIndex,
    endIndex,
  };
}

function extractBalancedJsonValue(input: string, startIndex: number): { jsonText: string, endIndex: number } | null {
  const opener = input[startIndex];
  if (opener !== "{" && opener !== "[") return null;
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let index = startIndex; index < input.length; index++) {
    const current = input[index];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (current === "\\") {
        isEscaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }
    if (current === "\"") {
      inString = true;
      continue;
    }
    if (current === opener) {
      depth += 1;
      continue;
    }
    if (current === closer) {
      depth -= 1;
      if (depth === 0) {
        return {
          jsonText: input.slice(startIndex, index + 1),
          endIndex: index + 1,
        };
      }
    }
  }
  return null;
}

function parseAutoExplainEntries(logChunk: string): AutoExplainParseResult {
  const parsedEntries: StatementExecutionMetrics["slowestStatements"] = [];
  let parseErrorCount = 0;
  let searchIndex = 0;
  while (searchIndex < logChunk.length) {
    const planIndex = logChunk.indexOf("plan:", searchIndex);
    if (planIndex < 0) break;
    const durationFragment = logChunk.slice(Math.max(0, planIndex - 180), planIndex);
    const durationMatch = durationFragment.match(/duration:\s*([0-9]+(?:\.[0-9]+)?)\s*ms/i);
    const jsonStart = logChunk.slice(planIndex).search(/[\[{]/);
    if (jsonStart < 0) {
      searchIndex = planIndex + 5;
      continue;
    }
    const jsonStartIndex = planIndex + jsonStart;
    const extracted = extractBalancedJsonValue(logChunk, jsonStartIndex);
    if (extracted == null) {
      parseErrorCount += 1;
      searchIndex = jsonStartIndex + 1;
      continue;
    }
    try {
      const parsed = JSON.parse(extracted.jsonText) as unknown;
      const explainEntry = isRecord(parsed)
        ? parsed
        : (Array.isArray(parsed) ? parsed.find((entry) => isRecord(entry) && isRecord(entry.Plan)) as Record<string, unknown> | undefined : undefined) ?? null;
      if (explainEntry == null) {
        searchIndex = extracted.endIndex;
        continue;
      }
      const plan = isRecord(explainEntry.Plan) ? explainEntry.Plan : null;
      const queryText = typeof explainEntry["Query Text"] === "string"
        ? explainEntry["Query Text"]
        : "";
      let executionMs = readFiniteNumber(explainEntry["Execution Time"]);
      let planningMs = readFiniteNumber(explainEntry["Planning Time"]);
      const durationMs = durationMatch == null ? null : Number(durationMatch[1]);
      const actualTotalTimeMs = readFiniteNumber(plan?.["Actual Total Time"]);
      if (executionMs == null && actualTotalTimeMs != null) {
        executionMs = actualTotalTimeMs;
      }
      if (planningMs == null && durationMs != null && executionMs != null) {
        planningMs = Math.max(0, Number((durationMs - executionMs).toFixed(3)));
      }
      parsedEntries.push({
        index: parsedEntries.length,
        kind: statementKindFromSql(queryText),
        outputName: null,
        wallMs: Number((durationMs ?? executionMs ?? planningMs ?? 0).toFixed(3)),
        planningMs,
        executionMs,
        rootNodeType: typeof plan?.["Node Type"] === "string" ? plan["Node Type"] : null,
        actualRows: readFiniteNumber(plan?.["Actual Rows"]),
        sharedHitBlocks: readFiniteNumber(plan?.["Shared Hit Blocks"]),
        sharedReadBlocks: readFiniteNumber(plan?.["Shared Read Blocks"]),
        tempWrittenBlocks: readFiniteNumber(plan?.["Temp Written Blocks"]),
        walBytes: readFiniteNumber(plan?.["WAL Bytes"]),
        sqlPreview: toSqlPreview(queryText),
      });
    } catch {
      parseErrorCount += 1;
    }
    searchIndex = extracted.endIndex;
  }
  return { parsedEntries, parseErrorCount };
}

function tableIdToString(tableId: unknown): string {
  if (typeof tableId === "string") return tableId;
  return JSON.stringify(tableId);
}

type CategoryRecord = { id: string, label: string, color: string, tableIds: string[] };

function createTableRegistry(schema: Record<string, unknown>): {
  tables: StudioTableRecord[],
  tableById: Map<string, StudioTableRecord>,
  idByTable: Map<StudioTable, string>,
  categories: CategoryRecord[],
} {
  const tables: StudioTableRecord[] = [];
  const idByTable = new Map<StudioTable, string>();
  const seen = new Set<StudioTable>();

  function addTable(name: string, value: unknown) {
    if (!isStudioTable(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    const record: StudioTableRecord = { id: name, name, table: value };
    tables.push(record);
    idByTable.set(value, name);
  }

  function walk(obj: Record<string, unknown>, prefix: string) {
    for (const [key, value] of Object.entries(obj)) {
      if (key === "_categories") continue;
      if (isStudioTable(value)) {
        addTable(key, value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (isStudioTable(item)) {
            const tableId = typeof item.tableId === "string" ? item.tableId : `${prefix}${key}`;
            addTable(tableId, item);
          }
        }
      } else if (isRecord(value) && !seen.has(value as any)) {
        walk(value as Record<string, unknown>, `${prefix}${key}.`);
      }
    }
  }
  walk(schema, "");

  if (tables.length === 0) {
    throw new StackAssertionError("No studio-compatible tables found in schema object.");
  }

  const categories: CategoryRecord[] = [];
  const rawCategories = schema._categories;
  if (isRecord(rawCategories)) {
    for (const [catId, catValue] of Object.entries(rawCategories)) {
      if (!isRecord(catValue)) continue;
      const label = typeof catValue.label === "string" ? catValue.label : catId;
      const color = typeof catValue.color === "string" ? catValue.color : "rgba(128,128,128,0.08)";
      const catTables = Array.isArray(catValue.tables) ? catValue.tables : [];
      const tableIds = catTables
        .filter((t): t is StudioTable => isStudioTable(t))
        .map((t) => idByTable.get(t))
        .filter((id): id is string => id != null);
      if (tableIds.length > 0) {
        categories.push({ id: catId, label, color, tableIds });
      }
    }
  }

  const tableById = new Map(tables.map((table) => [table.id, table]));
  return { tables, tableById, idByTable, categories };
}

const AVAILABLE_SCHEMAS: Record<string, () => Record<string, unknown>> = {
  "example": () => exampleFungibleLedgerSchema,
  "payments": () => createPaymentsSchema(),
};
let currentSchemaName = getEnvVariable("STACK_BULLDOZER_STUDIO_SCHEMA", "example");
let registry = createTableRegistry(
  (AVAILABLE_SCHEMAS[currentSchemaName] ?? AVAILABLE_SCHEMAS["example"])()
);
function switchSchema(name: string): void {
  const factory = Reflect.get(AVAILABLE_SCHEMAS, name);
  if (typeof factory !== "function") {
    throw new StackAssertionError(`Unknown schema "${name}". Available: ${Object.keys(AVAILABLE_SCHEMAS).join(", ")}`);
  }
  currentSchemaName = name;
  registry = createTableRegistry(factory());
}

async function executeStatements(statements: SqlStatement[]): Promise<StatementExecutionMetrics> {
  const startedAt = performance.now();
  const sqlScript = toExecutableSqlTransaction(statements);
  const autoExplainStartMarker = `bulldozer_studio_auto_explain_start:${STUDIO_INSTANCE_ID}:${Math.random().toString(36).slice(2, 10)}`;
  const autoExplainEndMarker = `bulldozer_studio_auto_explain_end:${STUDIO_INSTANCE_ID}:${Math.random().toString(36).slice(2, 10)}`;
  const autoExplainSetupSql = deindent`
    LOAD 'auto_explain';
    SET LOCAL auto_explain.log_min_duration = 0;
    SET LOCAL auto_explain.log_analyze = on;
    SET LOCAL auto_explain.log_nested_statements = on;
    SET LOCAL auto_explain.log_buffers = on;
    SET LOCAL auto_explain.log_wal = on;
    SET LOCAL auto_explain.log_timing = on;
    SET LOCAL auto_explain.log_settings = on;
    SET LOCAL auto_explain.log_format = 'json';
    SET LOCAL auto_explain.log_level = 'log';
  `;
  const instrumentedSqlScript = sqlScript.includes("BEGIN;")
    ? sqlScript.replace("BEGIN;", `BEGIN;\n${autoExplainSetupSql}`)
    : sqlScript;
  const wrappedInstrumentedSqlScript = deindent`
    DO $$ BEGIN RAISE LOG ${quoteSqlStringLiteral(autoExplainStartMarker).sql}; END $$;
    ${instrumentedSqlScript}
    DO $$ BEGIN RAISE LOG ${quoteSqlStringLiteral(autoExplainEndMarker).sql}; END $$;
  `;
  const logSnapshotBefore = await getCurrentPostgresLogSnapshot();
  const executionStartedAt = performance.now();
  let autoExplainSetupError: string | null = null;
  try {
    await globalPrismaClient.$executeRawUnsafe(wrappedInstrumentedSqlScript);
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const autoExplainFailure = /auto_explain|unrecognized configuration parameter|could not access file|permission denied/i.test(message);
    if (!autoExplainFailure) {
      throw error;
    }
    autoExplainSetupError = message;
    await globalPrismaClient.$executeRawUnsafe(sqlScript);
  }
  const statementWallMsTotal = Number((performance.now() - executionStartedAt).toFixed(1));
  const logSnapshotAfter = await getCurrentPostgresLogSnapshot();
  let autoExplainLogPath: string | null = null;
  let autoExplainLogReadBytes = 0;
  const snapshotErrors = [...new Set([logSnapshotBefore.error, logSnapshotAfter.error].filter((value): value is string => value != null))];
  let autoExplainLogReadError = snapshotErrors.length > 0 ? snapshotErrors.join("; ") : null;
  let autoExplainMarkerFound = false;
  let autoExplainParseErrorCount = 0;
  let autoExplainEntries: StatementExecutionMetrics["slowestStatements"] = [];
  let autoExplainRawLogExcerpt: string | null = null;
  if (autoExplainSetupError == null && logSnapshotBefore.snapshot != null && logSnapshotAfter.snapshot != null) {
    const requestedReadWindowBytes = Math.max(
      AUTO_EXPLAIN_LOG_SAMPLE_BYTES,
      Math.min(AUTO_EXPLAIN_MAX_LOG_SAMPLE_BYTES, Math.floor(sqlScript.length * 4)),
    );
    const logPathRotated = logSnapshotBefore.snapshot.path !== logSnapshotAfter.snapshot.path;
    autoExplainLogPath = logPathRotated
      ? `${logSnapshotBefore.snapshot.path} -> ${logSnapshotAfter.snapshot.path}`
      : logSnapshotAfter.snapshot.path;

    let logContent = "";
    const chunkReadErrors: string[] = [];
    const pushChunk = (chunk: { content: string | null, error: string | null }, context: string) => {
      if (chunk.error != null) {
        chunkReadErrors.push(`${context}: ${chunk.error}`);
        return;
      }
      if (chunk.content != null) {
        logContent += chunk.content;
        autoExplainLogReadBytes += chunk.content.length;
      }
    };

    if (!logPathRotated) {
      const readStartOffset = Math.max(
        logSnapshotBefore.snapshot.size,
        logSnapshotAfter.snapshot.size - requestedReadWindowBytes,
      );
      const readLength = Math.max(logSnapshotAfter.snapshot.size - readStartOffset, 0);
      const readLogChunkResult = await readPostgresLogChunk(logSnapshotAfter.snapshot.path, readStartOffset, readLength);
      pushChunk(readLogChunkResult, "active-log");
    } else {
      const readFromOldFile = await readPostgresLogChunk(
        logSnapshotBefore.snapshot.path,
        logSnapshotBefore.snapshot.size,
        requestedReadWindowBytes,
      );
      pushChunk(readFromOldFile, "rotated-old-log");
      if (logContent.length > 0) {
        logContent += "\n";
      }
      const readFromNewFile = await readPostgresLogChunk(
        logSnapshotAfter.snapshot.path,
        0,
        Math.min(logSnapshotAfter.snapshot.size, requestedReadWindowBytes),
      );
      pushChunk(readFromNewFile, "rotated-new-log");
    }

    if (logContent.length === 0 && chunkReadErrors.length > 0) {
      autoExplainLogReadError = chunkReadErrors.join("; ");
    } else if (logContent.length > 0) {
      if (chunkReadErrors.length > 0) {
        console.warn(`[studio] partial auto_explain log read: ${chunkReadErrors.join("; ")}`);
      }
      const betweenMarkers = extractTextBetweenMarkers(
        logContent,
        autoExplainStartMarker,
        autoExplainEndMarker,
      );
      autoExplainMarkerFound = betweenMarkers.markerFound;
      const autoExplainLogSection = logContent;
      const parsedAutoExplainEntries = parseAutoExplainEntries(autoExplainLogSection);
      autoExplainEntries = parsedAutoExplainEntries.parsedEntries;
      autoExplainParseErrorCount = parsedAutoExplainEntries.parseErrorCount;
      const preferredExcerptSource = betweenMarkers.text.includes("plan:")
        ? betweenMarkers.text
        : autoExplainLogSection;
      autoExplainRawLogExcerpt = preferredExcerptSource.length <= AUTO_EXPLAIN_LOG_EXCERPT_CHARS
        ? preferredExcerptSource
        : preferredExcerptSource.slice(-AUTO_EXPLAIN_LOG_EXCERPT_CHARS);
    } else if (autoExplainLogReadError == null) {
      autoExplainLogReadError = "PostgreSQL log chunk was empty";
    }
  } else if (autoExplainSetupError == null && autoExplainLogReadError == null) {
    autoExplainLogReadError = "PostgreSQL log snapshot unavailable (pg_current_logfile / pg_stat_file returned no path/size)";
  }

  const autoExplainCaptureAvailable = autoExplainSetupError == null
    && autoExplainLogReadError == null
    && autoExplainLogPath != null
    && autoExplainMarkerFound;

  const tableReferenceCounts = new Map<string, number>();
  for (const statement of statements) {
    const matches = statement.sql.match(/external:[A-Za-z0-9-]+/g) ?? [];
    const uniqueTableIds = new Set(matches);
    for (const tableId of uniqueTableIds) {
      tableReferenceCounts.set(tableId, (tableReferenceCounts.get(tableId) ?? 0) + 1);
    }
  }
  const topTableReferences = [...tableReferenceCounts.entries()]
    .sort((a, b) => b[1] - a[1] || stringCompare(a[0], b[0]))
    .slice(0, 8)
    .map(([tableId, statementReferences]) => ({ tableId, statementReferences }));
  const toStatementPreview = (statement: SqlStatement, index: number) => ({
    index,
    outputName: statement.outputName ?? null,
    sqlPreview: statement.sql.length <= STATEMENT_SQL_PREVIEW_CHARS
      ? statement.sql
      : `${statement.sql.slice(0, STATEMENT_SQL_PREVIEW_CHARS)}...`,
  });
  const lastPreviewStartIndex = Math.max(statements.length - 5, 0);
  const slowestStatements = [...autoExplainEntries]
    .sort((a, b) => b.wallMs - a.wallMs)
    .slice(0, SLOW_STATEMENT_LIMIT);
  const totalPlanningMs = autoExplainEntries.reduce((sum, entry) => sum + (entry.planningMs ?? 0), 0);
  const totalExecutionMs = autoExplainEntries.reduce((sum, entry) => sum + (entry.executionMs ?? 0), 0);
  const totalAutoExplainDurationMs = autoExplainEntries.reduce((sum, entry) => sum + entry.wallMs, 0);
  const explainedStatementCount = autoExplainEntries.length;
  const notExplainedStatementCount = Math.max(statements.length - explainedStatementCount, 0);
  const metrics: StatementExecutionMetrics = {
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    statementCount: statements.length,
    logicalStatementCount: statements.length,
    executableStatementCount: statements.length,
    sequentialStatementCount: statements.length,
    uniqueTableReferenceCount: tableReferenceCounts.size,
    sqlScriptLength: sqlScript.length,
    sqlScript,
    firstStatementPreviews: statements.slice(0, 5).map((statement, index) => toStatementPreview(statement, index)),
    lastStatementPreviews: statements.slice(lastPreviewStartIndex).map((statement, index) => toStatementPreview(statement, lastPreviewStartIndex + index)),
    topTableReferences,
    timingBreakdown: {
      statementWallMsTotal,
      totalPlanningMs: Number(totalPlanningMs.toFixed(1)),
      totalExecutionMs: Number(totalExecutionMs.toFixed(1)),
      totalAutoExplainDurationMs: Number(totalAutoExplainDurationMs.toFixed(1)),
      explainedStatementCount,
      notExplainedStatementCount,
    },
    slowestStatements,
    autoExplain: {
      enabled: autoExplainCaptureAvailable,
      setupError: autoExplainSetupError,
      logReadError: autoExplainLogReadError,
      logPath: autoExplainLogPath,
      logReadBytes: autoExplainLogReadBytes,
      markerFound: autoExplainMarkerFound,
      parsedEntryCount: autoExplainEntries.length,
      parseErrorCount: autoExplainParseErrorCount,
      rawLogExcerpt: autoExplainRawLogExcerpt,
    },
  };
  if (metrics.durationMs >= 1000) {
    const topSummary = metrics.topTableReferences
      .slice(0, 3)
      .map((entry) => `${entry.tableId}(${entry.statementReferences})`)
      .join(", ");
    const timingSummary = `auto_explain_duration=${metrics.timingBreakdown.totalAutoExplainDurationMs}ms planning=${metrics.timingBreakdown.totalPlanningMs}ms execution=${metrics.timingBreakdown.totalExecutionMs}ms entries=${metrics.timingBreakdown.explainedStatementCount}`;
    console.log(`[studio] slow mutation ${metrics.durationMs}ms (${metrics.statementCount} statements) ${timingSummary} topRefs=${topSummary}`);
  }
  return metrics;
}

async function queryRows(query: SqlQuery): Promise<unknown[]> {
  const rows = await retryTransaction(globalPrismaClient, async (tx) => {
    return await tx.$queryRawUnsafe<unknown[]>(toQueryableSqlQuery(query));
  });
  if (!Array.isArray(rows)) throw new StackAssertionError("Expected SQL query to return an array of rows.");
  return rows;
}

async function readBoolean(expression: SqlExpression<boolean>): Promise<boolean> {
  const rows = await retryTransaction(globalPrismaClient, async (tx) => {
    return await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT (${expression.sql}) AS "value"`);
  });
  if (!Array.isArray(rows) || rows.length === 0 || !isRecord(rows[0])) {
    throw new StackAssertionError("Expected boolean expression query to return one row.");
  }
  return Reflect.get(rows[0], "value") === true;
}

function valueFromRow(row: unknown, key: string): unknown {
  if (!isRecord(row)) return null;
  return Reflect.get(row, key);
}

async function getTableSnapshot(record: StudioTableRecord): Promise<{
  id: string,
  name: string,
  tableId: string,
  operator: string,
  dependencies: string[],
  debugArgs: Record<string, unknown>,
  supportsSetRow: boolean,
  supportsDeleteRow: boolean,
  initialized: boolean,
}> {
  const inputTables = record.table.inputTables ?? [];
  const debugArgs = record.table.debugArgs ?? {};
  const dependsOn = inputTables.map((inputTable) => {
    return registry.idByTable.get(inputTable) ?? tableIdToString(inputTable.tableId);
  });
  const operatorValue = Reflect.get(debugArgs, "operator");
  const operator = typeof operatorValue === "string" ? operatorValue : "unknown";

  return {
    id: record.id,
    name: record.name,
    tableId: tableIdToString(record.table.tableId),
    operator,
    dependencies: dependsOn,
    debugArgs,
    supportsSetRow: isStudioStoredTable(record.table),
    supportsDeleteRow: isStudioStoredTable(record.table),
    initialized: await readBoolean(record.table.isInitialized()),
  };
}

function topologicallySortTableIds(
  tables: Array<Awaited<ReturnType<typeof getTableSnapshot>>>,
): string[] {
  const ids = new Set(tables.map((table) => table.id));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const table of tables) {
    outgoing.set(table.id, []);
    inDegree.set(table.id, 0);
  }

  for (const table of tables) {
    for (const dependencyId of table.dependencies) {
      if (!ids.has(dependencyId)) continue;
      const next = outgoing.get(dependencyId);
      if (next == null) continue;
      next.push(table.id);
      const currentInDegree = inDegree.get(table.id);
      if (currentInDegree == null) continue;
      inDegree.set(table.id, currentInDegree + 1);
    }
  }

  const queue = [...inDegree.entries()]
    .filter((entry) => entry[1] === 0)
    .map((entry) => entry[0])
    .sort(stringCompare);
  const ordered: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id == null) continue;
    ordered.push(id);
    const nextIds = outgoing.get(id) ?? [];
    for (const nextId of nextIds) {
      const currentInDegree = inDegree.get(nextId);
      if (currentInDegree == null) continue;
      const updatedInDegree = currentInDegree - 1;
      inDegree.set(nextId, updatedInDegree);
      if (updatedInDegree === 0) {
        queue.push(nextId);
        queue.sort(stringCompare);
      }
    }
  }

  if (ordered.length === tables.length) return ordered;

  const remaining = [...ids].filter((id) => !ordered.includes(id)).sort(stringCompare);
  return [...ordered, ...remaining];
}

async function rebindInitializedDerivedTables(): Promise<void> {
  const snapshots = await Promise.all(registry.tables.map((table) => getTableSnapshot(table)));
  const initializedDerivedTableIds = new Set(
    snapshots
      .filter((table) => table.initialized && !table.supportsSetRow)
      .map((table) => table.id),
  );
  if (initializedDerivedTableIds.size === 0) return;

  const sortedIds = topologicallySortTableIds(snapshots);
  const recordsToDelete = [...sortedIds]
    .reverse()
    .map((id) => registry.tableById.get(id))
    .filter((record): record is StudioTableRecord => record != null && initializedDerivedTableIds.has(record.id));
  const recordsToInit = sortedIds
    .map((id) => registry.tableById.get(id))
    .filter((record): record is StudioTableRecord => record != null && initializedDerivedTableIds.has(record.id));

  for (const record of recordsToDelete) {
    await executeStatements(record.table.delete());
  }
  for (const record of recordsToInit) {
    await executeStatements(record.table.init());
  }

  console.log(`[studio] rebound ${recordsToInit.length} initialized derived tables`);
}

async function initAllTablesInTopologicalOrder(): Promise<string[]> {
  const snapshots = await Promise.all(registry.tables.map((table) => getTableSnapshot(table)));
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const sortedIds = topologicallySortTableIds(snapshots);
  const initializedIds: string[] = [];

  for (const id of sortedIds) {
    const snapshot = snapshotById.get(id);
    if (snapshot == null || snapshot.initialized) continue;
    const record = registry.tableById.get(id);
    if (record == null) continue;
    await executeStatements(record.table.init());
    initializedIds.push(id);
  }

  return initializedIds;
}

async function computeStudioLayout(tables: Array<Awaited<ReturnType<typeof getTableSnapshot>>>): Promise<null | {
  positions: Record<string, { x: number, y: number }>,
  sceneWidth: number,
  sceneHeight: number,
}> {
  try {
    const layout = await elk.layout({
      id: "bulldozer-studio",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.padding": `[top=${GRAPH_SCENE_MARGIN},left=${GRAPH_SCENE_MARGIN},bottom=${GRAPH_SCENE_MARGIN},right=${GRAPH_SCENE_MARGIN}]`,
        "elk.spacing.nodeNode": String(Math.floor(GRAPH_COLUMN_GAP_X / 2)),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(Math.floor(GRAPH_LEVEL_GAP_Y / 2)),
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.thoroughness": "40",
      },
      children: tables.map((table) => ({
        id: table.id,
        width: GRAPH_NODE_WIDTH,
        height: GRAPH_NODE_HEIGHT,
      })),
      edges: tables.flatMap((table) => {
        return table.dependencies.map((dependencyId, index) => ({
          id: `${dependencyId}->${table.id}:${index}`,
          sources: [dependencyId],
          targets: [table.id],
        }));
      }),
    });

    const positions = new Map<string, { x: number, y: number }>();
    for (const child of layout.children ?? []) {
      if (typeof child.id !== "string") continue;
      positions.set(child.id, {
        x: Number(child.x ?? 0),
        y: Number(child.y ?? 0),
      });
    }

    return {
      positions: Object.fromEntries(positions),
      sceneWidth: Number(Reflect.get(layout, "width") ?? 600),
      sceneHeight: Number(Reflect.get(layout, "height") ?? 600),
    };
  } catch (error) {
    return null;
  }
}

async function getTableDetails(record: StudioTableRecord): Promise<{
  table: Awaited<ReturnType<typeof getTableSnapshot>>,
  groups: Array<{ groupKey: unknown, rows: Array<{ rowIdentifier: unknown, rowSortKey: unknown, rowData: unknown }> }>,
  totalRows: number,
}> {
  const table = record.table;
  const tableSnapshot = await getTableSnapshot(record);
  const groupsRaw = await queryRows(table.listGroups({
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));
  const allRowsRaw = await queryRows(table.listRowsInGroup({
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));

  const rowsByGroup = new Map<string, { groupKey: unknown, rows: Array<{ rowIdentifier: unknown, rowSortKey: unknown, rowData: unknown }> }>();

  for (const groupRow of groupsRaw) {
    const groupKey = valueFromRow(groupRow, "groupkey");
    const key = JSON.stringify(groupKey);
    rowsByGroup.set(key, { groupKey, rows: [] });
  }

  for (const row of allRowsRaw) {
    const hasGroupKey = isRecord(row) && Reflect.has(row, "groupkey");
    const groupKey = hasGroupKey ? valueFromRow(row, "groupkey") : null;
    const key = JSON.stringify(groupKey);
    const existing = rowsByGroup.get(key) ?? { groupKey, rows: [] };
    existing.rows.push({
      rowIdentifier: valueFromRow(row, "rowidentifier"),
      rowSortKey: valueFromRow(row, "rowsortkey"),
      rowData: valueFromRow(row, "rowdata"),
    });
    rowsByGroup.set(key, existing);
  }

  const groups = [...rowsByGroup.values()].sort((a, b) => {
    return stringCompare(JSON.stringify(a.groupKey), JSON.stringify(b.groupKey));
  });

  return {
    table: tableSnapshot,
    groups,
    totalRows: allRowsRaw.length,
  };
}

async function getTimefoldDebugSnapshot(): Promise<{
  queueTableExists: boolean,
  metadataTableExists: boolean,
  pgCronInstalled: boolean,
  lastProcessedAt: unknown,
  queue: Array<Record<string, unknown>>,
}> {
  return await retryTransaction(globalPrismaClient, async (tx) => {
    const relationRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT
        to_regclass('"BulldozerTimeFoldQueue"') IS NOT NULL AS "queueTableExists",
        to_regclass('"BulldozerTimeFoldMetadata"') IS NOT NULL AS "metadataTableExists",
        to_regclass('cron.job') IS NOT NULL AS "pgCronInstalled"
    `);
    const relationRow = requireRecord(relationRows[0], "timefold relation probe returned invalid row");
    const queueTableExists = Reflect.get(relationRow, "queueTableExists") === true || Reflect.get(relationRow, "queuetableexists") === true;
    const metadataTableExists = Reflect.get(relationRow, "metadataTableExists") === true || Reflect.get(relationRow, "metadatatableexists") === true;
    const pgCronInstalled = Reflect.get(relationRow, "pgCronInstalled") === true || Reflect.get(relationRow, "pgcroninstalled") === true;

    let lastProcessedAt: unknown = null;
    if (metadataTableExists) {
      const metadataRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT "lastProcessedAt"
        FROM "BulldozerTimeFoldMetadata"
        WHERE "key" = 'singleton'
        LIMIT 1
      `);
      if (metadataRows.length > 0) {
        const metadataRow = requireRecord(metadataRows[0], "timefold metadata query returned invalid row");
        lastProcessedAt = Reflect.get(metadataRow, "lastProcessedAt") ?? Reflect.get(metadataRow, "lastprocessedat") ?? null;
      }
    }

    let queue: Array<Record<string, unknown>> = [];
    if (queueTableExists) {
      queue = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT
          "id",
          "tableStoragePath",
          "groupKey",
          "rowIdentifier",
          "scheduledAt",
          "stateAfter",
          "rowData",
          "reducerSql",
          "createdAt",
          "updatedAt"
        FROM "BulldozerTimeFoldQueue"
        ORDER BY "scheduledAt" ASC, "id" ASC
        LIMIT 500
      `);
    }

    return {
      queueTableExists,
      metadataTableExists,
      pgCronInstalled,
      lastProcessedAt,
      queue,
    };
  });
}

async function getRawNode(pathSegments: string[]): Promise<{
  path: string[],
  value: unknown,
  children: Array<{ segment: string, hasChildren: boolean }>,
}> {
  const keyPathLiteral = keyPathSqlLiteral(pathSegments);
  const { valueRows, childrenRows } = await retryTransaction(globalPrismaClient, async (tx) => {
    const valueRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT "value"
      FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ${keyPathLiteral}
    `);
    const childrenRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT
        ("child"."keyPath"[cardinality("child"."keyPath")] #>> '{}') AS "segment",
        EXISTS (
          SELECT 1
          FROM "BulldozerStorageEngine" AS "grandChild"
          WHERE "grandChild"."keyPathParent" = "child"."keyPath"
        ) AS "hasChildren"
      FROM "BulldozerStorageEngine" AS "child"
      WHERE "child"."keyPathParent" = ${keyPathLiteral}
      ORDER BY "segment"
    `);
    return { valueRows, childrenRows };
  });

  const children = childrenRows
    .filter((row) => isRecord(row) && typeof Reflect.get(row, "segment") === "string")
    .map((row) => ({
      segment: requireString(Reflect.get(row, "segment"), "Expected segment to be a string."),
      hasChildren: Reflect.get(row, "hasChildren") === true,
    }));

  return {
    path: pathSegments,
    value: Array.isArray(valueRows) && valueRows.length > 0 ? valueFromRow(valueRows[0], "value") : null,
    children,
  };
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += chunkBuffer.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new StackAssertionError("Request body exceeds maximum size.", {
        maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
        receivedBytes: totalBytes,
      });
    }
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunkBuffer);
    } else if (typeof chunk === "string") {
      chunks.push(chunkBuffer);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const rawBody = await readRequestBody(request);
  if (rawBody.trim() === "") return {};
  return JSON.parse(rawBody);
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendHtml(response: http.ServerResponse, html: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (remoteAddress == null) return false;
  return remoteAddress === "127.0.0.1"
    || remoteAddress === "::1"
    || remoteAddress === "::ffff:127.0.0.1";
}

function requireAuthorizedMutationRequest(request: http.IncomingMessage, requestUrl: URL): void {
  const authHeader = request.headers[STUDIO_AUTH_HEADER];
  const token = typeof authHeader === "string" ? authHeader : null;
  if (token !== STUDIO_AUTH_TOKEN) {
    throw new StackAssertionError("Invalid or missing studio mutation token.");
  }

  const originHeader = request.headers.origin;
  if (typeof originHeader === "string") {
    let originUrl: URL;
    try {
      originUrl = new URL(originHeader);
    } catch {
      throw new StackAssertionError("Mutation origin is not allowed.", {
        origin: originHeader,
        path: requestUrl.pathname,
      });
    }

    const portMatches = originUrl.port === String(STUDIO_PORT);
    const hostname = originUrl.hostname.toLowerCase();
    const hostnameAllowed = hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname.endsWith(".localhost");
    if (!portMatches || !hostnameAllowed) {
      throw new StackAssertionError("Mutation origin is not allowed.", {
        origin: originHeader,
        path: requestUrl.pathname,
      });
    }
  }
}

function getStudioPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bulldozer Studio</title>
  <style>
    :root {
      --bg: #111111;
      --bg-alt: #171717;
      --panel: #1f1f1f;
      --line: #343434;
      --grid: rgba(220, 220, 220, 0.08);
      --text: #f2f2f2;
      --muted: #b0b0b0;
      --accent: #66a3ff;
      --filter: #f7b955;
      --danger: #ff5f56;
      --ok: #35c769;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    body[data-theme="light"] {
      --bg: #f5f5f5;
      --bg-alt: #ececec;
      --panel: #ffffff;
      --line: #cfcfcf;
      --grid: rgba(0, 0, 0, 0.08);
      --text: #111111;
      --muted: #555555;
      --accent: #245ee9;
      --filter: #b06b00;
      --danger: #d72638;
      --ok: #118a3e;
    }
    * {
      box-sizing: border-box;
      border-radius: 0 !important;
    }
    html, body {
      height: 100%;
    }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Segoe UI", Inter, sans-serif;
      overflow: hidden;
    }
    .app {
      display: grid;
      grid-template-rows: 52px 1fr;
      height: 100vh;
    }
    .toolbar {
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
      background: var(--bg-alt);
      gap: 10px;
    }
    .toolbar-left, .toolbar-right {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .title {
      font-weight: 700;
      letter-spacing: 0.02em;
      margin-right: 10px;
      white-space: nowrap;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(580px, 58%) 1fr;
      min-height: 0;
    }
    .graph-pane {
      border-right: 1px solid var(--line);
      display: grid;
      grid-template-rows: 1fr;
      min-height: 0;
    }
    .details-pane {
      overflow: auto;
      padding: 10px;
      min-height: 0;
    }
    .graph-shell {
      position: relative;
      overflow: hidden;
      min-height: 0;
      cursor: grab;
      background-image:
        linear-gradient(to right, var(--grid) 1px, transparent 1px),
        linear-gradient(to bottom, var(--grid) 1px, transparent 1px);
      background-size: 24px 24px;
      background-position: 0 0;
      border-top: 1px solid var(--line);
    }
    .graph-shell.dragging {
      cursor: grabbing;
    }
    .graph-scene {
      position: absolute;
      left: 0;
      top: 0;
      transform-origin: 0 0;
      will-change: transform;
    }
    .graph-edges {
      position: absolute;
      left: 0;
      top: 0;
      pointer-events: none;
      overflow: visible;
    }
    .graph-nodes {
      position: absolute;
      left: 0;
      top: 0;
    }
    .node {
      position: absolute;
      width: 260px;
      min-height: 126px;
      border: 1px solid var(--line);
      background: var(--panel);
      padding: 8px;
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      gap: 6px;
      transition: border-color 0.15s ease;
      cursor: grab;
      user-select: none;
    }
    .node:hover {
      border-color: var(--accent);
    }
    .node.active {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .node.dragging {
      cursor: grabbing;
      z-index: 4;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22), inset 0 0 0 1px var(--accent);
    }
    .node-type {
      font-size: 28px;
      font-weight: 800;
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-family: var(--mono);
    }
    .node-type.stored {
      color: var(--ok);
    }
    .node-type.derived {
      color: var(--accent);
    }
    .node-type.filter {
      color: var(--filter);
    }
    .node-type.map {
      color: var(--accent);
    }
    .node-type.flatmap {
      color: color-mix(in srgb, var(--accent) 70%, var(--ok));
    }
    .node-type.groupby {
      color: color-mix(in srgb, var(--accent) 80%, white);
    }
    .node-type.limit {
      color: color-mix(in srgb, var(--filter) 75%, var(--text));
    }
    .node-type.concat {
      color: color-mix(in srgb, var(--accent) 60%, var(--filter));
    }
    .node-type.sort {
      color: color-mix(in srgb, var(--accent) 75%, var(--ok));
    }
    .node-type.lfold {
      color: color-mix(in srgb, var(--accent) 60%, var(--danger));
    }
    .node-type.leftjoin {
      color: color-mix(in srgb, var(--accent) 55%, var(--ok));
    }
    .node-type.timefold {
      color: color-mix(in srgb, var(--filter) 60%, var(--danger));
    }
    .node-name {
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-name.stored {
      color: var(--ok);
    }
    .node-name.derived {
      color: var(--text);
    }
    .node-name.filter {
      color: var(--filter);
    }
    .node-name.limit {
      color: color-mix(in srgb, var(--filter) 85%, var(--text));
    }
    .node-name.concat {
      color: color-mix(in srgb, var(--accent) 55%, var(--filter));
    }
    .node-name.sort {
      color: color-mix(in srgb, var(--accent) 80%, var(--ok));
    }
    .node-name.lfold {
      color: color-mix(in srgb, var(--accent) 70%, var(--danger));
    }
    .node-name.leftjoin {
      color: color-mix(in srgb, var(--accent) 60%, var(--ok));
    }
    .node-name.timefold {
      color: color-mix(in srgb, var(--filter) 65%, var(--danger));
    }
    .node-meta {
      font-size: 11px;
      color: var(--muted);
      font-family: var(--mono);
    }
    .node-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    .mono {
      font-family: var(--mono);
    }
    .btn {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.1;
      transition: border-color 0.15s ease;
    }
    .btn:hover {
      border-color: var(--accent);
    }
    .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .btn.icon {
      width: 30px;
      min-width: 30px;
      padding: 5px;
      text-align: center;
      font-size: 14px;
    }
    .btn.good {
      border-color: color-mix(in srgb, var(--ok) 40%, var(--line));
    }
    .btn.bad {
      border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
    }
    .btn.active {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .status-pill {
      font-size: 11px;
      border: 1px solid var(--line);
      padding: 3px 6px;
      white-space: nowrap;
      color: var(--muted);
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .detail-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .detail-title {
      font-size: 16px;
      font-weight: 700;
    }
    .detail-section {
      border: 1px solid var(--line);
      margin-bottom: 10px;
      padding: 8px;
      background: var(--panel);
    }
    .kv {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 6px 8px;
      font-size: 12px;
      align-items: start;
    }
    .kv-key {
      color: var(--muted);
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid var(--line);
      background: var(--bg-alt);
      padding: 8px;
      font-size: 12px;
      font-family: var(--mono);
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      background: var(--bg-alt);
      color: var(--text);
      font-family: var(--mono);
      font-size: 12px;
      padding: 6px 7px;
    }
    textarea {
      min-height: 120px;
      resize: vertical;
    }
    .row {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 5px 6px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--bg-alt);
      font-weight: 600;
    }
    details {
      border: 1px solid var(--line);
      margin-bottom: 8px;
      background: var(--panel);
    }
    summary {
      cursor: pointer;
      padding: 6px 7px;
      border-bottom: 1px solid var(--line);
      font-size: 12px;
      font-family: var(--mono);
      background: var(--bg-alt);
    }
    .raw-children {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    dialog {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      width: min(760px, 90vw);
      max-height: 75vh;
      padding: 0;
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.45);
    }
    .dialog-content {
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .dialog-title {
      font-weight: 700;
      color: var(--danger);
    }
    .muted {
      color: var(--muted);
    }
    .metrics-visual {
      display: grid;
      gap: 8px;
      font-size: 12px;
    }
    .metrics-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .metrics-card {
      border: 1px solid var(--line);
      background: var(--bg-alt);
      padding: 8px;
      display: grid;
      gap: 6px;
    }
    .metrics-card-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .metrics-big-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    }
    .metrics-kv {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .metrics-bar {
      height: 8px;
      border: 1px solid var(--line);
      background: var(--panel);
      position: relative;
      overflow: hidden;
    }
    .metrics-bar-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0%;
      background: var(--accent);
    }
    .metrics-bar-fill.good {
      background: var(--ok);
    }
    .metrics-bar-fill.warn {
      background: var(--filter);
    }
    .metrics-bar-fill.danger {
      background: var(--danger);
    }
    .metrics-list {
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 4px;
    }
    .metrics-list li {
      color: var(--muted);
      line-height: 1.35;
    }
    .metrics-empty {
      color: var(--muted);
      border: 1px dashed var(--line);
      padding: 8px;
      background: var(--bg-alt);
    }
  </style>
</head>
<body data-theme="dark">
  <div class="app">
    <header class="toolbar">
      <div class="toolbar-left">
        <div class="title">Bulldozer Studio</div>
        <button id="modeTablesBtn" class="btn active">🧩 Tables</button>
        <button id="modeRawBtn" class="btn">🗂️ Raw</button>
        <select id="schemaSelect" class="btn" title="Switch schema" style="appearance:auto;padding:2px 6px;font-size:12px;"></select>
        <button id="toggleIntermediatesBtn" class="btn" title="Show/hide map, filter, flatmap tables" style="font-size:11px;">👁 Intermediates</button>
        <button id="modeTimefoldBtn" class="btn">⏱️ Timefold</button>
        <button id="initAllBtn" class="btn good">🚀 init all</button>
        <button id="refreshBtn" class="btn icon" title="Refresh">🔄</button>
        <button id="fitBtn" class="btn icon" title="Fit graph">🧭</button>
        <button id="themeBtn" class="btn icon" title="Toggle theme">🌙</button>
      </div>
      <div class="toolbar-right">
        <div class="status-pill mono" id="statusText">ready</div>
      </div>
    </header>
    <main class="layout">
      <section class="graph-pane">
        <div id="graphShell" class="graph-shell">
          <div id="graphScene" class="graph-scene">
            <svg id="graphEdges" class="graph-edges"></svg>
            <div id="graphNodes" class="graph-nodes"></div>
          </div>
        </div>
      </section>
      <section class="details-pane" id="detailsPane"></section>
    </main>
  </div>

  <dialog id="errorDialog">
    <div class="dialog-content">
      <div class="dialog-title">Action failed</div>
      <pre id="errorText"></pre>
      <div class="row">
        <button id="errorCloseBtn" class="btn">Close</button>
      </div>
    </div>
  </dialog>

  <dialog id="metricsDialog">
    <div class="dialog-content">
      <div class="dialog-title" style="color:var(--text);" id="metricsDialogTitle">Execution details</div>
      <div id="metricsDialogMeta" class="mono muted"></div>
      <div id="metricsDialogVisual" class="metrics-visual"></div>
      <pre id="metricsDialogText"></pre>
      <div class="row">
        <button id="metricsDialogCloseBtn" class="btn">Close</button>
      </div>
    </div>
  </dialog>

  <script>
    const NODE_WIDTH = ${GRAPH_NODE_WIDTH};
    const NODE_HEIGHT = ${GRAPH_NODE_HEIGHT};
    const LEVEL_GAP_Y = ${GRAPH_LEVEL_GAP_Y};
    const COLUMN_GAP_X = ${GRAPH_COLUMN_GAP_X};
    const SCENE_MARGIN = ${GRAPH_SCENE_MARGIN};
    const STUDIO_AUTH_TOKEN = ${JSON.stringify(STUDIO_AUTH_TOKEN)};
    const THEME_STORAGE_KEY = "bulldozer-studio-theme";
    const NODE_POSITIONS_STORAGE_KEY = "bulldozer-studio-node-positions-v1";
    const VERSION_POLL_INTERVAL_MS = 1200;

    function loadStoredNodePositions() {
      try {
        const raw = window.localStorage.getItem(NODE_POSITIONS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const result = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (!value || typeof value !== "object" || Array.isArray(value)) continue;
          const x = Number(value.x);
          const y = Number(value.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          result[key] = { x, y };
        }
        return result;
      } catch (error) {
        return {};
      }
    }
    function persistNodePositions() {
      window.localStorage.setItem(NODE_POSITIONS_STORAGE_KEY, JSON.stringify(state.manualNodePositions));
    }

    const INTERMEDIATE_OPERATORS = new Set(["map", "filter", "flatmap"]);

    const state = {
      mode: "table",
      schema: null,
      selectedTableId: null,
      selectedTableDetails: null,
      lastMutationMetrics: {},
      rawNode: null,
      rawPath: [],
      timefoldDebug: null,
      status: "ready",
      theme: "dark",
      serverVersion: null,
      graphLayout: null,
      showIntermediates: true,
      viewport: {
        x: 24,
        y: 24,
        scale: 1,
      },
      manualNodePositions: loadStoredNodePositions(),
      dragging: {
        active: false,
        kind: null,
        startX: 0,
        startY: 0,
        startOffsetX: 0,
        startOffsetY: 0,
        nodeId: null,
        nodeStartX: 0,
        nodeStartY: 0,
        moved: false,
        suppressClickTableId: null,
      },
    };

    const graphShell = document.getElementById("graphShell");
    const graphScene = document.getElementById("graphScene");
    const graphEdges = document.getElementById("graphEdges");
    const graphNodes = document.getElementById("graphNodes");
    const detailsPane = document.getElementById("detailsPane");
    const statusText = document.getElementById("statusText");
    const errorDialog = document.getElementById("errorDialog");
    const errorText = document.getElementById("errorText");
    const errorCloseBtn = document.getElementById("errorCloseBtn");
    const metricsDialog = document.getElementById("metricsDialog");
    const metricsDialogTitle = document.getElementById("metricsDialogTitle");
    const metricsDialogMeta = document.getElementById("metricsDialogMeta");
    const metricsDialogVisual = document.getElementById("metricsDialogVisual");
    const metricsDialogText = document.getElementById("metricsDialogText");
    const metricsDialogCloseBtn = document.getElementById("metricsDialogCloseBtn");
    const modeTablesBtn = document.getElementById("modeTablesBtn");
    const modeRawBtn = document.getElementById("modeRawBtn");
    const schemaSelect = document.getElementById("schemaSelect");
    const toggleIntermediatesBtn = document.getElementById("toggleIntermediatesBtn");
    const modeTimefoldBtn = document.getElementById("modeTimefoldBtn");
    const initAllBtn = document.getElementById("initAllBtn");
    const refreshBtn = document.getElementById("refreshBtn");
    const fitBtn = document.getElementById("fitBtn");
    const themeBtn = document.getElementById("themeBtn");

    async function loadSchemaList() {
      const data = await fetchJson("/api/schemas");
      schemaSelect.innerHTML = "";
      for (const name of data.available) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === data.current) opt.selected = true;
        schemaSelect.appendChild(opt);
      }
    }

    function setStatus(text) {
      state.status = text;
      statusText.textContent = text;
    }

    function resolveSystemTheme() {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function showErrorDialog(message) {
      errorText.textContent = message;
      if (errorDialog.open) {
        errorDialog.close();
      }
      errorDialog.showModal();
    }

    function readFiniteNumber(value) {
      const numberValue = Number(value);
      return Number.isFinite(numberValue) ? numberValue : null;
    }

    function readMutationDurationMs(metrics) {
      if (!metrics || typeof metrics !== "object") return null;
      return readFiniteNumber(metrics.durationMs);
    }

    function statementCountFromMetrics(metrics) {
      if (!metrics || typeof metrics !== "object") return null;
      return readFiniteNumber(metrics.logicalStatementCount ?? metrics.statementCount);
    }

    function executableStatementCountFromMetrics(metrics) {
      if (!metrics || typeof metrics !== "object") return null;
      return readFiniteNumber(metrics.executableStatementCount);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function formatNumericValue(value, fractionDigits = 1) {
      if (!Number.isFinite(value)) return "n/a";
      return Number(value).toFixed(fractionDigits);
    }

    function percentage(value, total) {
      if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
      return Math.max(0, Math.min(100, (value / total) * 100));
    }

    function renderMetricsBarRow(label, valueText, widthPercent, tone = "good") {
      const safeWidth = Number.isFinite(widthPercent) ? Math.max(0, Math.min(100, widthPercent)) : 0;
      return ""
        + "<div class='metrics-kv'><span>" + escapeHtml(label) + "</span><span>" + escapeHtml(valueText) + "</span></div>"
        + "<div class='metrics-bar'><div class='metrics-bar-fill " + escapeHtml(tone) + "' style='width:" + safeWidth.toFixed(1) + "%'></div></div>";
    }

    function renderMetricsVisual(metrics) {
      if (!metrics || typeof metrics !== "object") {
        metricsDialogVisual.innerHTML = "<div class='metrics-empty'>No execution metrics available yet.</div>";
        return;
      }

      const timing = (metrics.timingBreakdown && typeof metrics.timingBreakdown === "object") ? metrics.timingBreakdown : {};
      const autoExplain = (metrics.autoExplain && typeof metrics.autoExplain === "object") ? metrics.autoExplain : {};
      const logicalStatementCount = statementCountFromMetrics(metrics) ?? 0;
      const explainedStatementCount = readFiniteNumber(timing.explainedStatementCount) ?? 0;
      const notCapturedCount = readFiniteNumber(timing.notExplainedStatementCount) ?? Math.max(logicalStatementCount - explainedStatementCount, 0);
      const captureRate = percentage(explainedStatementCount, logicalStatementCount);
      const totalDurationMs = readFiniteNumber(metrics.durationMs) ?? 0;
      const statementWallMsTotal = readFiniteNumber(timing.statementWallMsTotal) ?? 0;
      const planningMs = readFiniteNumber(timing.totalPlanningMs) ?? 0;
      const executionMs = readFiniteNumber(timing.totalExecutionMs) ?? 0;
      const autoExplainDurationMs = readFiniteNumber(timing.totalAutoExplainDurationMs) ?? 0;
      const parsedEntryCount = readFiniteNumber(autoExplain.parsedEntryCount) ?? 0;
      const parseErrorCount = readFiniteNumber(autoExplain.parseErrorCount) ?? 0;
      const topRefs = Array.isArray(metrics.topTableReferences) ? metrics.topTableReferences.slice(0, 5) : [];
      const slowestStatements = Array.isArray(metrics.slowestStatements) ? metrics.slowestStatements.slice(0, 5) : [];
      const maxTopRefCount = topRefs.reduce((maxValue, entry) => Math.max(maxValue, readFiniteNumber(entry?.statementReferences) ?? 0), 0);
      const maxSlowStatementMs = slowestStatements.reduce((maxValue, entry) => Math.max(maxValue, readFiniteNumber(entry?.wallMs) ?? 0), 0);

      const captureTone = captureRate >= 80 ? "good" : (captureRate >= 40 ? "warn" : "danger");
      const parseTone = parseErrorCount > 0 ? "danger" : "good";
      const markerTone = autoExplain.markerFound === true ? "good" : "warn";
      const setupTone = autoExplain.enabled === true ? "good" : "warn";

      const topRefsMarkup = topRefs.length === 0
        ? "<div class='metrics-empty'>No table-reference distribution collected.</div>"
        : topRefs.map((entry) => {
          const tableId = typeof entry?.tableId === "string" ? entry.tableId : "unknown-table";
          const referenceCount = readFiniteNumber(entry?.statementReferences) ?? 0;
          return renderMetricsBarRow(
            tableId,
            String(referenceCount) + " refs",
            percentage(referenceCount, maxTopRefCount),
            "warn",
          );
        }).join("");

      const slowestMarkup = slowestStatements.length === 0
        ? "<div class='metrics-empty'>No auto-explain statement entries parsed yet.</div>"
        : slowestStatements.map((entry) => {
          const statementIndex = readFiniteNumber(entry?.index);
          const wallMs = readFiniteNumber(entry?.wallMs) ?? 0;
          const kind = typeof entry?.kind === "string" ? entry.kind : "UNKNOWN";
          const label = "#" + (statementIndex == null ? "?" : String(statementIndex)) + " " + kind;
          return renderMetricsBarRow(label, formatNumericValue(wallMs, 1) + "ms", percentage(wallMs, maxSlowStatementMs), "danger");
        }).join("");

      metricsDialogVisual.innerHTML = ""
        + "<div class='metrics-grid'>"
        +   "<div class='metrics-card'>"
        +     "<div class='metrics-card-title'>Capture Health</div>"
        +     "<div class='metrics-big-value'>" + formatNumericValue(captureRate, 1) + "%</div>"
        +     renderMetricsBarRow("Captured statements", String(explainedStatementCount) + "/" + String(logicalStatementCount), captureRate, captureTone)
        +     renderMetricsBarRow("Missing estimate", String(notCapturedCount), percentage(notCapturedCount, logicalStatementCount), "warn")
        +     renderMetricsBarRow("Marker found", autoExplain.markerFound === true ? "yes" : "no", 100, markerTone)
        +   "</div>"
        +   "<div class='metrics-card'>"
        +     "<div class='metrics-card-title'>Timing Composition</div>"
        +     "<div class='metrics-big-value'>" + formatNumericValue(totalDurationMs, 1) + "ms</div>"
        +     renderMetricsBarRow("Statement wall total", formatNumericValue(statementWallMsTotal, 1) + "ms", percentage(statementWallMsTotal, totalDurationMs), "good")
        +     renderMetricsBarRow("auto_explain duration", formatNumericValue(autoExplainDurationMs, 1) + "ms", percentage(autoExplainDurationMs, totalDurationMs), "warn")
        +     renderMetricsBarRow("Planning + execution", formatNumericValue(planningMs + executionMs, 1) + "ms", percentage(planningMs + executionMs, totalDurationMs), "danger")
        +   "</div>"
        +   "<div class='metrics-card'>"
        +     "<div class='metrics-card-title'>Parser Status</div>"
        +     "<div class='metrics-big-value'>" + String(parsedEntryCount) + " entries</div>"
        +     renderMetricsBarRow("Capture enabled", autoExplain.enabled === true ? "yes" : "no", 100, setupTone)
        +     renderMetricsBarRow("Parse errors", String(parseErrorCount), parseErrorCount > 0 ? 100 : 0, parseTone)
        +     renderMetricsBarRow("Log bytes read", String(readFiniteNumber(autoExplain.logReadBytes) ?? 0), 100, "good")
        +   "</div>"
        + "</div>"
        + "<div class='metrics-grid'>"
        +   "<div class='metrics-card'><div class='metrics-card-title'>Top Referenced Tables</div>" + topRefsMarkup + "</div>"
        +   "<div class='metrics-card'><div class='metrics-card-title'>Slowest Parsed Statements</div>" + slowestMarkup + "</div>"
        + "</div>"
        + "<div class='metrics-card'>"
        +   "<div class='metrics-card-title'>What This Captures</div>"
        +   "<ul class='metrics-list'>"
        +     "<li><strong>Wall clock totals</strong>: end-to-end transaction time and cumulative SQL statement wall time.</li>"
        +     "<li><strong>auto_explain timing</strong>: planner and executor time from PostgreSQL for statements that are actually captured.</li>"
        +     "<li><strong>Plan-level IO stats</strong>: shared hits/reads, temp writes, WAL bytes, node type, and actual rows for slow statements.</li>"
        +     "<li><strong>Coverage signals</strong>: marker detection, parsed entry count, and estimated uncaptured statements.</li>"
        +     "<li><strong>Schema pressure hints</strong>: statement-reference frequency per table to identify hotspots in dependency graphs.</li>"
        +   "</ul>"
        + "</div>";
    }

    function mutationDetailLines(metrics) {
      if (!metrics || typeof metrics !== "object") {
        return "No execution details available.";
      }
      const timing = (metrics.timingBreakdown && typeof metrics.timingBreakdown === "object") ? metrics.timingBreakdown : null;
      const autoExplain = (metrics.autoExplain && typeof metrics.autoExplain === "object") ? metrics.autoExplain : null;
      const topRefs = Array.isArray(metrics.topTableReferences) ? metrics.topTableReferences : [];
      const firstPreviews = Array.isArray(metrics.firstStatementPreviews) ? metrics.firstStatementPreviews : [];
      const lastPreviews = Array.isArray(metrics.lastStatementPreviews) ? metrics.lastStatementPreviews : [];
      const slowestStatements = Array.isArray(metrics.slowestStatements) ? metrics.slowestStatements : [];
      const lines = [
        "Execution summary",
        "durationMs: " + (readFiniteNumber(metrics.durationMs) ?? "n/a"),
        "logicalStatementCount: " + (statementCountFromMetrics(metrics) ?? "n/a"),
        "executableStatementCount: " + (executableStatementCountFromMetrics(metrics) ?? "n/a"),
        "sequentialStatementCount: " + (readFiniteNumber(metrics.sequentialStatementCount) ?? "n/a"),
        "uniqueTableReferenceCount: " + (readFiniteNumber(metrics.uniqueTableReferenceCount) ?? "n/a"),
        "sqlScriptLengthChars: " + (readFiniteNumber(metrics.sqlScriptLength) ?? "n/a"),
        "statementWallMsTotal: " + (readFiniteNumber(timing?.statementWallMsTotal) ?? "n/a"),
        "totalAutoExplainDurationMs: " + (readFiniteNumber(timing?.totalAutoExplainDurationMs) ?? "n/a"),
        "totalPlanningMs(auto_explain): " + (readFiniteNumber(timing?.totalPlanningMs) ?? "n/a"),
        "totalExecutionMs(auto_explain): " + (readFiniteNumber(timing?.totalExecutionMs) ?? "n/a"),
        "autoExplainEntryCount: " + (readFiniteNumber(timing?.explainedStatementCount) ?? "n/a"),
        "notCapturedStatementEstimate: " + (readFiniteNumber(timing?.notExplainedStatementCount) ?? "n/a"),
        "",
        "Top referenced tables",
      ];
      if (topRefs.length === 0) {
        lines.push("(none)");
      } else {
        for (const entry of topRefs) {
          const tableId = typeof entry?.tableId === "string" ? entry.tableId : "unknown-table";
          const count = readFiniteNumber(entry?.statementReferences);
          lines.push("- " + tableId + ": " + (count ?? "?") + " statement references");
        }
      }

      lines.push("", "Auto-explain capture");
      lines.push("enabled: " + (autoExplain?.enabled === true ? "yes" : "no"));
      lines.push("setupError: " + (typeof autoExplain?.setupError === "string" ? autoExplain.setupError : "none"));
      lines.push("logReadError: " + (typeof autoExplain?.logReadError === "string" ? autoExplain.logReadError : "none"));
      lines.push("logPath: " + (typeof autoExplain?.logPath === "string" ? autoExplain.logPath : "n/a"));
      lines.push("logReadBytes: " + (readFiniteNumber(autoExplain?.logReadBytes) ?? "n/a"));
      lines.push("markerFound: " + (autoExplain?.markerFound === true ? "yes" : "no"));
      lines.push("parsedEntryCount: " + (readFiniteNumber(autoExplain?.parsedEntryCount) ?? "n/a"));
      lines.push("parseErrorCount: " + (readFiniteNumber(autoExplain?.parseErrorCount) ?? "n/a"));

      lines.push("", "Slowest executable statements");
      if (slowestStatements.length === 0) {
        lines.push("(none)");
      } else {
        for (const statement of slowestStatements) {
          const wallMs = readFiniteNumber(statement?.wallMs);
          const planningMs = readFiniteNumber(statement?.planningMs);
          const executionMs = readFiniteNumber(statement?.executionMs);
          const kind = typeof statement?.kind === "string" ? statement.kind : "UNKNOWN";
          const index = readFiniteNumber(statement?.index);
          const rootNodeType = typeof statement?.rootNodeType === "string" ? statement.rootNodeType : "n/a";
          const actualRows = readFiniteNumber(statement?.actualRows);
          const sharedHits = readFiniteNumber(statement?.sharedHitBlocks);
          const sharedReads = readFiniteNumber(statement?.sharedReadBlocks);
          const tempWrites = readFiniteNumber(statement?.tempWrittenBlocks);
          const walBytes = readFiniteNumber(statement?.walBytes);
          lines.push(
            "#" + (index == null ? "?" : String(index))
            + " kind=" + kind
            + " wallMs=" + (wallMs == null ? "?" : String(wallMs))
            + " planningMs=" + (planningMs == null ? "n/a" : String(planningMs))
            + " executionMs=" + (executionMs == null ? "n/a" : String(executionMs))
            + " node=" + rootNodeType
            + " actualRows=" + (actualRows == null ? "n/a" : String(actualRows))
            + " sharedHit=" + (sharedHits == null ? "n/a" : String(sharedHits))
            + " sharedRead=" + (sharedReads == null ? "n/a" : String(sharedReads))
            + " tempWritten=" + (tempWrites == null ? "n/a" : String(tempWrites))
            + " walBytes=" + (walBytes == null ? "n/a" : String(walBytes))
          );
          lines.push(typeof statement?.sqlPreview === "string" ? statement.sqlPreview : "(missing sql preview)");
          lines.push("");
        }
      }

      lines.push("", "Auto-explain log excerpt");
      lines.push(typeof autoExplain?.rawLogExcerpt === "string" ? autoExplain.rawLogExcerpt : "(none)");

      lines.push("", "First generated statements");
      if (firstPreviews.length === 0) {
        lines.push("(none)");
      } else {
        for (const preview of firstPreviews) {
          lines.push("#" + (preview.index ?? "?") + " (" + (preview.outputName ?? "no outputName") + ")");
          lines.push(typeof preview.sqlPreview === "string" ? preview.sqlPreview : "(missing sql preview)");
          lines.push("");
        }
      }

      lines.push("Last generated statements");
      if (lastPreviews.length === 0) {
        lines.push("(none)");
      } else {
        for (const preview of lastPreviews) {
          lines.push("#" + (preview.index ?? "?") + " (" + (preview.outputName ?? "no outputName") + ")");
          lines.push(typeof preview.sqlPreview === "string" ? preview.sqlPreview : "(missing sql preview)");
          lines.push("");
        }
      }

      lines.push("Executed SQL script");
      lines.push(typeof metrics.sqlScript === "string" ? metrics.sqlScript : "(missing sql script)");
      return lines.join("\\n");
    }

    function showMetricsDialog(actionLabel, tableId, metrics) {
      const durationMs = readMutationDurationMs(metrics);
      const statementCount = statementCountFromMetrics(metrics);
      const executableStatementCount = executableStatementCountFromMetrics(metrics);
      const timing = (metrics && typeof metrics === "object" && metrics.timingBreakdown && typeof metrics.timingBreakdown === "object")
        ? metrics.timingBreakdown
        : null;
      metricsDialogTitle.textContent = actionLabel + " • " + tableId;
      metricsDialogMeta.textContent = [
        "duration=" + (durationMs == null ? "n/a" : formatDuration(durationMs)),
        "logicalStatements=" + (statementCount == null ? "n/a" : String(statementCount)),
        "executableStatements=" + (executableStatementCount == null ? "n/a" : String(executableStatementCount)),
        "autoExplainPlanMs=" + (readFiniteNumber(timing?.totalPlanningMs) ?? "n/a"),
        "autoExplainExecMs=" + (readFiniteNumber(timing?.totalExecutionMs) ?? "n/a"),
      ].join(" • ");
      renderMetricsVisual(metrics);
      metricsDialogText.textContent = mutationDetailLines(metrics);
      if (metricsDialog.open) {
        metricsDialog.close();
      }
      metricsDialog.showModal();
    }

    async function runUiAction(label, fn) {
      try {
        await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showErrorDialog(label + ": " + message);
      }
    }

    async function runButtonAction(button, loadingText, fn) {
      const originalLabel = button.textContent;
      const wasDisabled = button.disabled;
      button.disabled = true;
      button.textContent = loadingText;
      try {
        return await fn();
      } finally {
        button.disabled = wasDisabled;
        button.textContent = originalLabel;
      }
    }

    function formatDuration(durationMs) {
      if (!Number.isFinite(durationMs)) return "n/a";
      if (durationMs < 1000) return durationMs.toFixed(1) + "ms";
      return (durationMs / 1000).toFixed(2) + "s";
    }

    function formatMutationMetrics(metrics) {
      if (!metrics || typeof metrics !== "object") return "";
      const durationMs = readMutationDurationMs(metrics);
      const statementCount = statementCountFromMetrics(metrics);
      const executableStatementCount = executableStatementCountFromMetrics(metrics);
      const timing = (metrics.timingBreakdown && typeof metrics.timingBreakdown === "object") ? metrics.timingBreakdown : null;
      const planningMs = readFiniteNumber(timing?.totalPlanningMs);
      const executionMs = readFiniteNumber(timing?.totalExecutionMs);
      const autoExplainDurationMs = readFiniteNumber(timing?.totalAutoExplainDurationMs);
      const topRefs = Array.isArray(metrics.topTableReferences) ? metrics.topTableReferences : [];
      const topSummary = topRefs
        .slice(0, 3)
        .map((entry) => {
          const tableId = typeof entry?.tableId === "string" ? entry.tableId : "unknown-table";
          const count = readFiniteNumber(entry?.statementReferences);
          return tableId + ":" + (count == null ? "?" : String(count));
        })
        .join(", ");
      const statementLabel = statementCount == null ? "?" : String(statementCount);
      const executableSuffix = executableStatementCount == null ? "" : " • " + executableStatementCount + " executable";
      const planExecSuffix = (planningMs == null && executionMs == null)
        ? ""
        : " • auto-explain plan/exec=" + (planningMs == null ? "n/a" : String(planningMs)) + "/" + (executionMs == null ? "n/a" : String(executionMs)) + "ms";
      const durationSuffix = autoExplainDurationMs == null
        ? ""
        : " • auto-explain duration=" + autoExplainDurationMs + "ms";
      const base = formatDuration(durationMs ?? Number.NaN) + " • " + statementLabel + " logical" + executableSuffix + planExecSuffix + durationSuffix;
      return topSummary ? base + " • top refs: " + topSummary : base;
    }

    function sortJsonValue(value) {
      if (Array.isArray(value)) {
        return value.map(sortJsonValue);
      }
      if (value && typeof value === "object") {
        const result = {};
        const keys = Object.keys(value).sort();
        for (const key of keys) {
          result[key] = sortJsonValue(value[key]);
        }
        return result;
      }
      return value;
    }

    function prettyJson(value) {
      return JSON.stringify(sortJsonValue(value), null, 2);
    }

    function compareStrings(a, b) {
      if (a === b) return 0;
      return a < b ? -1 : 1;
    }
    function compareNumbers(a, b) {
      if (a === b) return 0;
      return a < b ? -1 : 1;
    }

    async function fetchJson(path, init) {
      const normalizedInit = init ? { ...init } : {};
      const method = typeof normalizedInit.method === "string" ? normalizedInit.method.toUpperCase() : "GET";
      const headers = new Headers(normalizedInit.headers || {});
      if (method !== "GET") {
        headers.set("${STUDIO_AUTH_HEADER}", STUDIO_AUTH_TOKEN);
      }
      normalizedInit.headers = headers;
      const response = await fetch(path, normalizedInit);
      let body;
      try {
        body = await response.json();
      } catch (error) {
        body = { error: response.status + " " + response.statusText };
      }
      if (!response.ok) {
        throw new Error(body.error || (response.status + " " + response.statusText));
      }
      return body;
    }

    function computeDepth(tableId, tableMap, cache, visiting) {
      if (cache.has(tableId)) return cache.get(tableId);
      if (visiting.has(tableId)) return 0;
      visiting.add(tableId);
      const table = tableMap.get(tableId);
      if (!table || !Array.isArray(table.dependencies) || table.dependencies.length === 0) {
        cache.set(tableId, 0);
        visiting.delete(tableId);
        return 0;
      }
      let depth = 0;
      for (const dependencyId of table.dependencies) {
        const dependencyDepth = computeDepth(dependencyId, tableMap, cache, visiting);
        if (dependencyDepth + 1 > depth) {
          depth = dependencyDepth + 1;
        }
      }
      cache.set(tableId, depth);
      visiting.delete(tableId);
      return depth;
    }
    function getAverageOrderValue(ids, orderMap, fallback) {
      const values = ids
        .map((id) => orderMap.get(id))
        .filter((value) => typeof value === "number");
      if (values.length === 0) return fallback;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    function getNodePosition(tableId) {
      const stored = state.manualNodePositions[tableId];
      if (!stored || typeof stored !== "object") return null;
      const x = Number(stored.x);
      const y = Number(stored.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        x: Math.max(SCENE_MARGIN / 2, x),
        y: Math.max(SCENE_MARGIN / 2, y),
      };
    }
    function pruneNodePositions(tables) {
      const validIds = new Set(tables.map((table) => String(table.id)));
      let changed = false;
      const next = {};
      for (const [tableId, value] of Object.entries(state.manualNodePositions)) {
        if (!validIds.has(tableId)) {
          changed = true;
          continue;
        }
        next[tableId] = value;
      }
      if (!changed) return;
      state.manualNodePositions = next;
      persistNodePositions();
    }

    function layoutGraph(tables, baseLayout) {
      const tableMap = new Map(tables.map((table) => [table.id, table]));
      const reverseDependencies = new Map();
      const depthCache = new Map();
      const byDepth = new Map();

      for (const table of tables) {
        reverseDependencies.set(table.id, []);
      }
      for (const table of tables) {
        const dependencies = Array.isArray(table.dependencies) ? table.dependencies : [];
        for (const dependencyId of dependencies) {
          const existing = reverseDependencies.get(dependencyId) ?? [];
          existing.push(table.id);
          reverseDependencies.set(dependencyId, existing);
        }
      }

      for (const table of tables) {
        const depth = computeDepth(table.id, tableMap, depthCache, new Set());
        if (!byDepth.has(depth)) byDepth.set(depth, []);
        byDepth.get(depth).push(table);
      }

      const depths = [...byDepth.keys()].sort((a, b) => a - b);
      const positions = new Map();
      let sceneWidth = typeof baseLayout?.sceneWidth === "number" ? baseLayout.sceneWidth : 600;
      let sceneHeight = typeof baseLayout?.sceneHeight === "number" ? baseLayout.sceneHeight : 600;
      const basePositions = baseLayout && typeof baseLayout === "object" && baseLayout.positions && typeof baseLayout.positions === "object"
        ? baseLayout.positions
        : null;

      if (basePositions) {
        for (const table of tables) {
          const fallbackDepth = depthCache.get(table.id) ?? 0;
          const fallbackIndex = (byDepth.get(fallbackDepth) ?? []).findIndex((rowTable) => rowTable.id === table.id);
          const fallbackX = SCENE_MARGIN + Math.max(0, fallbackIndex) * (NODE_WIDTH + COLUMN_GAP_X);
          const fallbackY = SCENE_MARGIN + fallbackDepth * LEVEL_GAP_Y;
          const basePosition = basePositions[table.id];
          const manualPosition = getNodePosition(table.id);
          const x = manualPosition
            ? manualPosition.x
            : Number.isFinite(Number(basePosition?.x))
              ? Number(basePosition.x)
              : fallbackX;
          const y = manualPosition
            ? manualPosition.y
            : Number.isFinite(Number(basePosition?.y))
              ? Number(basePosition.y)
              : fallbackY;
          positions.set(table.id, { x, y });
          sceneWidth = Math.max(sceneWidth, x + NODE_WIDTH + SCENE_MARGIN);
          sceneHeight = Math.max(sceneHeight, y + NODE_HEIGHT + SCENE_MARGIN);
        }

        return {
          positions,
          sceneWidth,
          sceneHeight,
          depthById: depthCache,
        };
      }

      for (const depth of depths) {
        const row = byDepth.get(depth);
        row.sort((a, b) => compareStrings(String(a.name), String(b.name)));
      }

      for (let iteration = 0; iteration < 6; iteration++) {
        const orderMap = new Map();
        for (const depth of depths) {
          const row = byDepth.get(depth) ?? [];
          for (let i = 0; i < row.length; i++) {
            orderMap.set(row[i].id, i);
          }
        }
        for (let depthIndex = 1; depthIndex < depths.length; depthIndex++) {
          const depth = depths[depthIndex];
          const row = byDepth.get(depth) ?? [];
          row.sort((a, b) => {
            const aDeps = Array.isArray(a.dependencies) ? a.dependencies : [];
            const bDeps = Array.isArray(b.dependencies) ? b.dependencies : [];
            const aScore = getAverageOrderValue(aDeps, orderMap, Number.MAX_SAFE_INTEGER / 4);
            const bScore = getAverageOrderValue(bDeps, orderMap, Number.MAX_SAFE_INTEGER / 4);
            return compareNumbers(aScore, bScore) || compareStrings(String(a.name), String(b.name));
          });
        }

        orderMap.clear();
        for (const depth of depths) {
          const row = byDepth.get(depth) ?? [];
          for (let i = 0; i < row.length; i++) {
            orderMap.set(row[i].id, i);
          }
        }
        for (let depthIndex = depths.length - 2; depthIndex >= 0; depthIndex--) {
          const depth = depths[depthIndex];
          const row = byDepth.get(depth) ?? [];
          row.sort((a, b) => {
            const aDependents = reverseDependencies.get(a.id) ?? [];
            const bDependents = reverseDependencies.get(b.id) ?? [];
            const aScore = getAverageOrderValue(aDependents, orderMap, Number.MAX_SAFE_INTEGER / 4);
            const bScore = getAverageOrderValue(bDependents, orderMap, Number.MAX_SAFE_INTEGER / 4);
            return compareNumbers(aScore, bScore) || compareStrings(String(a.name), String(b.name));
          });
        }
      }

      for (let depthIndex = 0; depthIndex < depths.length; depthIndex++) {
        const depth = depths[depthIndex];
        const row = byDepth.get(depth);
        const totalWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP_X;
        const startX = SCENE_MARGIN + Math.max(0, (900 - totalWidth) / 2);
        const y = SCENE_MARGIN + depthIndex * LEVEL_GAP_Y;
        for (let i = 0; i < row.length; i++) {
          const defaultX = startX + i * (NODE_WIDTH + COLUMN_GAP_X);
          const defaultY = y;
          const manualPosition = getNodePosition(row[i].id);
          const x = manualPosition ? manualPosition.x : defaultX;
          const finalY = manualPosition ? manualPosition.y : defaultY;
          positions.set(row[i].id, { x, y: finalY });
          sceneWidth = Math.max(sceneWidth, x + NODE_WIDTH + SCENE_MARGIN);
          sceneHeight = Math.max(sceneHeight, finalY + NODE_HEIGHT + SCENE_MARGIN);
        }
      }

      return {
        positions,
        sceneWidth,
        sceneHeight,
        depthById: depthCache,
      };
    }
    function syncSceneDimensions() {
      if (!state.graphLayout) return;
      graphScene.style.width = state.graphLayout.sceneWidth + "px";
      graphScene.style.height = state.graphLayout.sceneHeight + "px";
      graphEdges.setAttribute("width", String(state.graphLayout.sceneWidth));
      graphEdges.setAttribute("height", String(state.graphLayout.sceneHeight));
      graphEdges.setAttribute("viewBox", "0 0 " + state.graphLayout.sceneWidth + " " + state.graphLayout.sceneHeight);
      graphNodes.style.width = state.graphLayout.sceneWidth + "px";
      graphNodes.style.height = state.graphLayout.sceneHeight + "px";
    }
    function getVisibleTableIds() {
      const ids = new Set();
      for (const node of graphNodes.querySelectorAll(".node")) {
        const tid = node.getAttribute("data-table-id");
        if (tid && node.style.display !== "none") ids.add(tid);
      }
      return ids;
    }

    function buildGraphEdges(tables, positions, depthById) {
      const visibleIds = getVisibleTableIds();
      const tableMap = new Map(tables.map((t) => [t.id, t]));

      function resolveVisibleAncestors(tableId, visited) {
        if (visited.has(tableId)) return [];
        visited.add(tableId);
        if (visibleIds.has(tableId)) return [tableId];
        const table = tableMap.get(tableId);
        if (!table) return [];
        const deps = Array.isArray(table.dependencies) ? table.dependencies : [];
        const results = [];
        for (const depId of deps) {
          results.push(...resolveVisibleAncestors(depId, visited));
        }
        return results;
      }

      const edges = [];
      const outgoingByNode = new Map();
      const incomingByNode = new Map();
      for (const table of tables) {
        if (!visibleIds.has(table.id)) continue;
        const to = positions.get(table.id);
        if (!to) continue;
        const dependencies = Array.isArray(table.dependencies) ? table.dependencies : [];
        const resolvedDeps = new Set();
        for (const depId of dependencies) {
          for (const resolved of resolveVisibleAncestors(depId, new Set([table.id]))) {
            resolvedDeps.add(resolved);
          }
        }
        for (const dependencyId of resolvedDeps) {
          const from = positions.get(dependencyId);
          if (!from) continue;
          const edge = {
            id: dependencyId + "->" + table.id,
            fromId: dependencyId,
            toId: table.id,
            from,
            to,
            depthFrom: depthById.get(dependencyId) ?? 0,
            depthTo: depthById.get(table.id) ?? 0,
            sourceSlotIndex: 0,
            sourceSlotCount: 1,
            targetSlotIndex: 0,
            targetSlotCount: 1,
            laneOffset: 0,
          };
          edges.push(edge);
          const outgoing = outgoingByNode.get(dependencyId) ?? [];
          outgoing.push(edge);
          outgoingByNode.set(dependencyId, outgoing);
          const incoming = incomingByNode.get(table.id) ?? [];
          incoming.push(edge);
          incomingByNode.set(table.id, incoming);
        }
      }

      for (const [nodeId, nodeEdges] of outgoingByNode.entries()) {
        nodeEdges.sort((a, b) => compareNumbers(a.to.x, b.to.x) || compareStrings(a.toId, b.toId));
        for (let i = 0; i < nodeEdges.length; i++) {
          nodeEdges[i].sourceSlotIndex = i;
          nodeEdges[i].sourceSlotCount = nodeEdges.length;
        }
      }
      for (const [nodeId, nodeEdges] of incomingByNode.entries()) {
        nodeEdges.sort((a, b) => compareNumbers(a.from.x, b.from.x) || compareStrings(a.fromId, b.fromId));
        for (let i = 0; i < nodeEdges.length; i++) {
          nodeEdges[i].targetSlotIndex = i;
          nodeEdges[i].targetSlotCount = nodeEdges.length;
        }
      }

      const edgesByDepthSpan = new Map();
      for (const edge of edges) {
        const bucketKey = edge.depthFrom + "->" + edge.depthTo;
        const bucket = edgesByDepthSpan.get(bucketKey) ?? [];
        bucket.push(edge);
        edgesByDepthSpan.set(bucketKey, bucket);
      }
      for (const bucket of edgesByDepthSpan.values()) {
        bucket.sort((a, b) => {
          const aCenter = (a.from.x + a.to.x) / 2;
          const bCenter = (b.from.x + b.to.x) / 2;
          return compareNumbers(aCenter, bCenter) || compareStrings(a.id, b.id);
        });
        for (let i = 0; i < bucket.length; i++) {
          const centeredIndex = i - (bucket.length - 1) / 2;
          bucket[i].laneOffset = Math.max(-4, Math.min(4, centeredIndex)) * 18;
        }
      }

      return edges;
    }
    function getEdgeAnchorX(position, slotIndex, slotCount) {
      if (slotCount <= 1) return position.x + NODE_WIDTH / 2;
      return position.x + ((slotIndex + 1) / (slotCount + 1)) * NODE_WIDTH;
    }
    function renderGraphEdges(tables) {
      graphEdges.innerHTML = "";
      if (!state.graphLayout) return;
      const positions = state.graphLayout.positions;

      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
      marker.setAttribute("id", "arrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "7");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("orient", "auto");
      const markerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      markerPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      markerPath.setAttribute("fill", "var(--accent)");
      marker.appendChild(markerPath);
      defs.appendChild(marker);
      graphEdges.appendChild(defs);

      const edges = buildGraphEdges(tables, positions, state.graphLayout.depthById ?? new Map());
      for (const edge of edges) {
        const startX = getEdgeAnchorX(edge.from, edge.sourceSlotIndex, edge.sourceSlotCount);
        const startY = edge.from.y + NODE_HEIGHT;
        const endX = getEdgeAnchorX(edge.to, edge.targetSlotIndex, edge.targetSlotCount);
        const endY = edge.to.y;
        const laneY = Math.min(endY - 20, Math.max(startY + 20, (startY + endY) / 2 + edge.laneOffset));
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M " + startX + " " + startY + " C " + startX + " " + laneY + ", " + endX + " " + laneY + ", " + endX + " " + endY);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "var(--accent)");
        path.setAttribute("stroke-width", "1.7");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("marker-end", "url(#arrow)");
        graphEdges.appendChild(path);
      }
    }
    function syncNodePositions() {
      if (!state.graphLayout) return;
      const positions = state.graphLayout.positions;
      for (const node of graphNodes.querySelectorAll(".node")) {
        const tableId = node.getAttribute("data-table-id");
        if (!tableId) continue;
        const position = positions.get(tableId);
        if (!position) continue;
        node.style.left = position.x + "px";
        node.style.top = position.y + "px";
      }
    }
    function relayoutGraph() {
      if (!state.schema || !Array.isArray(state.schema.tables)) return;
      pruneNodePositions(state.schema.tables);
      state.graphLayout = layoutGraph(state.schema.tables, state.schema.layout);
      syncSceneDimensions();
      renderGraphEdges(state.schema.tables);
      syncNodePositions();
      updateSceneTransform();
    }

    function updateSceneTransform() {
      graphScene.style.transform = "translate(" + state.viewport.x + "px, " + state.viewport.y + "px) scale(" + state.viewport.scale + ")";
    }

    function setMode(mode) {
      state.mode = mode;
      modeTablesBtn.classList.toggle("active", mode === "table");
      modeRawBtn.classList.toggle("active", mode === "raw");
      modeTimefoldBtn.classList.toggle("active", mode === "timefold");
      renderDetails();
    }

    function fitGraphToView() {
      if (!state.graphLayout) return;
      const shellRect = graphShell.getBoundingClientRect();
      const padding = 36;
      const availableWidth = Math.max(120, shellRect.width - padding * 2);
      const availableHeight = Math.max(120, shellRect.height - padding * 2);
      const scaleX = availableWidth / state.graphLayout.sceneWidth;
      const scaleY = availableHeight / state.graphLayout.sceneHeight;
      const scale = Math.max(0.3, Math.min(2.2, Math.min(scaleX, scaleY)));
      state.viewport.scale = scale;
      state.viewport.x = (shellRect.width - state.graphLayout.sceneWidth * scale) / 2;
      state.viewport.y = (shellRect.height - state.graphLayout.sceneHeight * scale) / 2;
      updateSceneTransform();
    }

    function renderCategoryBoxes() {
      const existing = graphNodes.querySelectorAll(".category-box");
      for (const el of existing) el.remove();
      if (!state.schema || !Array.isArray(state.schema.categories) || !state.graphLayout) return;
      const positions = state.graphLayout.positions;
      for (const category of state.schema.categories) {
        const tableIds = category.tableIds || [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let found = 0;
        for (const tid of tableIds) {
          const pos = positions.get(tid);
          if (!pos) continue;
          const node = graphNodes.querySelector('[data-table-id="' + tid.replaceAll('"', '\\\\"') + '"]');
          if (node && node.style.display === "none") continue;
          found++;
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x + NODE_WIDTH);
          maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
        }
        if (found === 0) continue;
        const pad = 24;
        const box = document.createElement("div");
        box.className = "category-box";
        box.style.position = "absolute";
        box.style.left = (minX - pad) + "px";
        box.style.top = (minY - pad) + "px";
        box.style.width = (maxX - minX + pad * 2) + "px";
        box.style.height = (maxY - minY + pad * 2) + "px";
        box.style.background = category.color || "rgba(128,128,128,0.08)";
        box.style.borderRadius = "14px";
        box.style.pointerEvents = "none";
        box.style.zIndex = "0";
        box.style.overflow = "hidden";
        const label = document.createElement("div");
        label.textContent = category.label || "";
        label.style.position = "absolute";
        label.style.top = "50%";
        label.style.left = "50%";
        label.style.transform = "translate(-50%, -50%)";
        label.style.fontSize = "36px";
        label.style.fontWeight = "800";
        label.style.opacity = "0.18";
        label.style.whiteSpace = "normal";
        label.style.wordWrap = "break-word";
        label.style.maxWidth = "90%";
        label.style.letterSpacing = "1px";
        label.style.userSelect = "none";
        label.style.textAlign = "center";
        box.appendChild(label);
        graphNodes.insertBefore(box, graphNodes.firstChild);
      }
    }

    function renderGraph() {
      graphNodes.innerHTML = "";
      graphEdges.innerHTML = "";
      if (!state.schema || !Array.isArray(state.schema.tables)) return;

      const tables = state.schema.tables;
      for (const table of tables) {
        const opNormalized = String(table.operator || "").toLowerCase();
        if (!state.showIntermediates && INTERMEDIATE_OPERATORS.has(opNormalized)) {
          continue;
        }
        const operatorClass = (() => {
          const normalized = String(table.operator || "unknown").toLowerCase();
          if (normalized === "stored" || normalized === "map" || normalized === "flatmap" || normalized === "groupby" || normalized === "filter" || normalized === "limit" || normalized === "concat" || normalized === "sort" || normalized === "lfold" || normalized === "leftjoin" || normalized === "compact" || normalized === "reduce" || normalized === "timefold") {
            return normalized;
          }
          return "derived";
        })();
        const node = document.createElement("div");
        node.className = "node" + (state.selectedTableId === table.id ? " active" : "");
        node.setAttribute("data-table-id", String(table.id));

        const type = document.createElement("div");
        type.className = "node-type " + operatorClass;
        type.textContent = String(table.operator || "unknown");

        const name = document.createElement("div");
        name.className = "node-name mono " + operatorClass;
        name.textContent = table.name;

        const meta = document.createElement("div");
        meta.className = "node-meta";
        meta.textContent = (table.initialized ? "initialized" : "not initialized")
          + " | deps: " + (Array.isArray(table.dependencies) ? table.dependencies.length : 0);

        const actions = document.createElement("div");
        actions.className = "node-actions";
        const left = document.createElement("div");
        left.className = "row";
        if (!table.initialized) {
          const initBtn = document.createElement("button");
          initBtn.className = "btn bad";
          initBtn.textContent = "🚀 init";
          initBtn.onclick = (event) => {
            event.stopPropagation();
            runUiAction("init table", async () => {
              await tableAction(table.id, "init");
            });
          };
          left.appendChild(initBtn);
          node.style.borderColor = "red";
        }
        const focusBtn = document.createElement("button");
        focusBtn.className = "btn icon";
        focusBtn.title = "Select table";
        focusBtn.textContent = "🎯";
        focusBtn.onclick = (event) => {
          event.stopPropagation();
          runUiAction("load table details", async () => {
            setMode("table");
            await selectTable(table.id);
          });
        };
        actions.appendChild(left);
        actions.appendChild(focusBtn);

        node.appendChild(type);
        node.appendChild(name);
        node.appendChild(meta);
        node.appendChild(actions);
        node.addEventListener("mousedown", (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (target.closest("button")) return;
          const position = state.graphLayout?.positions.get(table.id);
          if (!position) return;
          event.preventDefault();
          event.stopPropagation();
          state.dragging.active = true;
          state.dragging.kind = "node";
          state.dragging.nodeId = String(table.id);
          state.dragging.startX = event.clientX;
          state.dragging.startY = event.clientY;
          state.dragging.nodeStartX = position.x;
          state.dragging.nodeStartY = position.y;
          state.dragging.moved = false;
          node.classList.add("dragging");
          graphShell.classList.add("dragging");
        });
        node.onclick = () => {
          if (state.dragging.suppressClickTableId === table.id) {
            state.dragging.suppressClickTableId = null;
            return;
          }
          runUiAction("load table details", async () => {
            setMode("table");
            await selectTable(table.id);
          });
        };
        graphNodes.appendChild(node);
      }

      relayoutGraph();
      renderCategoryBoxes();
    }

    function getRawInputDefault() {
      return "{\\n  \\"accountId\\": \\"acct-demo\\",\\n  \\"asset\\": \\"USD\\",\\n  \\"amount\\": \\"1500.00\\",\\n  \\"side\\": \\"credit\\",\\n  \\"txHash\\": \\"0xdemo\\",\\n  \\"blockNumber\\": 1,\\n  \\"timestamp\\": \\"2026-01-01T00:00:00Z\\",\\n  \\"counterparty\\": \\"acct-peer\\",\\n  \\"memo\\": null\\n}";
    }

    async function loadSchema() {
      setStatus("loading schema...");
      const schema = await fetchJson("/api/schema");
      state.schema = schema;
      if (!state.selectedTableId && schema.tables.length > 0) {
        state.selectedTableId = schema.tables[0].id;
      }
      renderGraph();
      if (state.mode === "table" && state.selectedTableId) {
        await selectTable(state.selectedTableId);
      } else if (state.mode === "raw") {
        await loadRawNode(state.rawPath.length === 0 ? [] : state.rawPath);
      } else if (state.mode === "timefold") {
        await loadTimefoldDebug();
      }
      setStatus("ready");
      fitGraphToView();
    }

    async function selectTable(tableId) {
      state.selectedTableId = tableId;
      setStatus("loading table...");
      state.selectedTableDetails = await fetchJson("/api/table/" + encodeURIComponent(tableId) + "/details");
      setStatus("ready");
      renderGraph();
      renderDetails();
    }

    async function tableAction(tableId, action, payload) {
      setStatus(action + "...");
      const response = await fetchJson("/api/table/" + encodeURIComponent(tableId) + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      if ((action === "set-row" || action === "delete-row") && response && typeof response === "object") {
        const metrics = response.metrics;
        if (metrics && typeof metrics === "object") {
          state.lastMutationMetrics[tableId + ":" + action] = metrics;
        }
      }
      await loadSchema();
      if (state.selectedTableId) {
        await selectTable(state.selectedTableId);
      }
      return response;
    }

    async function initAllTables() {
      setStatus("initializing all tables...");
      await fetchJson("/api/tables/init-all", {
        method: "POST",
      });
      await loadSchema();
      if (state.selectedTableId) {
        await selectTable(state.selectedTableId);
      }
    }

    async function loadRawNode(path) {
      state.mode = "raw";
      setStatus("loading raw node...");
      state.rawNode = await fetchJson("/api/raw/node?path=" + encodeURIComponent(JSON.stringify(path)));
      state.rawPath = state.rawNode.path;
      setStatus("ready");
      renderDetails();
    }

    async function loadTimefoldDebug() {
      state.mode = "timefold";
      setStatus("loading timefold debug...");
      state.timefoldDebug = await fetchJson("/api/timefold/debug");
      setStatus("ready");
      renderDetails();
    }

    async function upsertRaw(path, value) {
      setStatus("saving raw value...");
      await fetchJson("/api/raw/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathSegments: path, value }),
      });
      await loadRawNode(path);
    }

    async function deleteRaw(path) {
      setStatus("deleting raw value...");
      await fetchJson("/api/raw/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathSegments: path }),
      });
      await loadRawNode(path.length === 0 ? [] : path.slice(0, -1));
    }

    function renderTableDetails() {
      const details = state.selectedTableDetails;
      if (!details) {
        detailsPane.innerHTML = "<div class='detail-section'>No table selected.</div>";
        return;
      }
      const table = details.table;
      detailsPane.innerHTML = "";

      const head = document.createElement("div");
      head.className = "detail-head";
      const title = document.createElement("div");
      title.className = "detail-title";
      title.textContent = "Table details";
      const actions = document.createElement("div");
      actions.className = "row";
      const refreshBtnLocal = document.createElement("button");
      refreshBtnLocal.className = "btn icon";
      refreshBtnLocal.title = "Refresh details";
      refreshBtnLocal.textContent = "🔄";
      refreshBtnLocal.onclick = () => runUiAction("refresh details", async () => {
        await selectTable(table.id);
      });
      const initBtn = document.createElement("button");
      initBtn.className = "btn good";
      initBtn.textContent = "🚀 init";
      initBtn.onclick = () => runUiAction("init table", async () => {
        await tableAction(table.id, "init");
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn bad icon";
      deleteBtn.title = "Delete table";
      deleteBtn.textContent = "🗑️";
      deleteBtn.onclick = () => runUiAction("delete table", async () => {
        await tableAction(table.id, "delete");
      });
      actions.appendChild(refreshBtnLocal);
      actions.appendChild(initBtn);
      actions.appendChild(deleteBtn);
      head.appendChild(title);
      head.appendChild(actions);
      detailsPane.appendChild(head);

      const info = document.createElement("div");
      info.className = "detail-section";
      const kv = document.createElement("div");
      kv.className = "kv";
      const appendInfoRow = (label, value, isMonospace = false) => {
        const keyCell = document.createElement("div");
        keyCell.className = "kv-key";
        keyCell.textContent = label;
        const valueCell = document.createElement("div");
        if (isMonospace) {
          valueCell.className = "mono";
        }
        valueCell.textContent = value;
        kv.appendChild(keyCell);
        kv.appendChild(valueCell);
      };
      appendInfoRow("name", table.name, true);
      appendInfoRow("tableId", table.tableId, true);
      appendInfoRow("operator", table.operator, true);
      appendInfoRow("initialized", String(table.initialized));
      appendInfoRow("dependencies", table.dependencies.length === 0 ? "(none)" : table.dependencies.join(", "), true);
      appendInfoRow("rows(all groups)", String(details.totalRows), true);
      info.appendChild(kv);
      detailsPane.appendChild(info);

      const debugArgs = document.createElement("div");
      debugArgs.className = "detail-section";
      debugArgs.innerHTML = "<div class='muted mono' style='margin-bottom:6px;'>debugArgs</div>";
      const debugArgsGrid = document.createElement("div");
      debugArgsGrid.className = "kv";
      const debugEntries = Object.entries(table.debugArgs ?? {}).sort((a, b) => compareStrings(a[0], b[0]));
      if (debugEntries.length === 0) {
        const emptyKey = document.createElement("div");
        emptyKey.className = "kv-key mono";
        emptyKey.textContent = "(none)";
        const emptyValue = document.createElement("div");
        emptyValue.className = "mono";
        emptyValue.textContent = "-";
        debugArgsGrid.appendChild(emptyKey);
        debugArgsGrid.appendChild(emptyValue);
      }
      for (const [key, value] of debugEntries) {
        const keyCell = document.createElement("div");
        keyCell.className = "kv-key mono";
        keyCell.textContent = key;

        const valueCell = document.createElement("div");
        if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "undefined") {
          valueCell.className = "mono";
          valueCell.textContent = String(value);
        } else if (typeof value === "string") {
          if (value.includes("\\n") || value.length > 120) {
            const valuePre = document.createElement("pre");
            valuePre.textContent = value;
            valueCell.appendChild(valuePre);
          } else {
            valueCell.className = "mono";
            valueCell.textContent = value;
          }
        } else {
          const valuePre = document.createElement("pre");
          valuePre.textContent = prettyJson(value);
          valueCell.appendChild(valuePre);
        }

        debugArgsGrid.appendChild(keyCell);
        debugArgsGrid.appendChild(valueCell);
      }
      debugArgs.appendChild(debugArgsGrid);
      detailsPane.appendChild(debugArgs);

      if (table.supportsSetRow) {
        const mutate = document.createElement("div");
        mutate.className = "detail-section";
        mutate.innerHTML = "<div class='muted mono' style='margin-bottom:6px;'>mutations</div>";
        const setMetrics = state.lastMutationMetrics[table.id + ":set-row"];
        const deleteMetrics = state.lastMutationMetrics[table.id + ":delete-row"];
        const setRowId = document.createElement("input");
        setRowId.placeholder = "rowIdentifier";
        const setRowData = document.createElement("textarea");
        setRowData.value = getRawInputDefault();
        const setRowActions = document.createElement("div");
        setRowActions.className = "row";
        const setBtn = document.createElement("button");
        setBtn.className = "btn good";
        setBtn.textContent = "💾 set row";
        setBtn.onclick = () => runUiAction("set row", async () => {
          await runButtonAction(setBtn, "⏳ setting...", async () => {
            const rowIdentifier = setRowId.value.trim();
            if (!rowIdentifier) {
              throw new Error("rowIdentifier is required");
            }
            const rowData = JSON.parse(setRowData.value);
            await tableAction(table.id, "set-row", { rowIdentifier, rowData });
          });
        });
        const deleteRowId = document.createElement("input");
        deleteRowId.placeholder = "rowIdentifier to delete";
        const deleteRowBtn = document.createElement("button");
        deleteRowBtn.className = "btn bad";
        deleteRowBtn.textContent = "🗑️ delete row";
        deleteRowBtn.onclick = () => runUiAction("delete row", async () => {
          await runButtonAction(deleteRowBtn, "⏳ deleting...", async () => {
            const rowIdentifier = deleteRowId.value.trim();
            if (!rowIdentifier) {
              throw new Error("rowIdentifier is required");
            }
            await tableAction(table.id, "delete-row", { rowIdentifier });
          });
        });
        setRowActions.appendChild(setBtn);
        setRowActions.appendChild(deleteRowBtn);
        mutate.appendChild(setRowId);
        mutate.appendChild(setRowData);
        mutate.appendChild(deleteRowId);
        mutate.appendChild(setRowActions);
        if (setMetrics && typeof setMetrics === "object") {
          const setMetricsRow = document.createElement("div");
          setMetricsRow.className = "row";
          const setDurationBtn = document.createElement("button");
          setDurationBtn.className = "btn";
          setDurationBtn.style.fontSize = "11px";
          const setDuration = readMutationDurationMs(setMetrics);
          setDurationBtn.textContent = "⏱ set " + formatDuration(setDuration ?? Number.NaN);
          setDurationBtn.onclick = () => showMetricsDialog("set-row", table.tableId, setMetrics);
          const setMetricsSummary = document.createElement("div");
          setMetricsSummary.className = "mono muted";
          setMetricsSummary.style.fontSize = "11px";
          setMetricsSummary.textContent = formatMutationMetrics(setMetrics);
          setMetricsRow.appendChild(setDurationBtn);
          setMetricsRow.appendChild(setMetricsSummary);
          mutate.appendChild(setMetricsRow);
        }
        if (deleteMetrics && typeof deleteMetrics === "object") {
          const deleteMetricsRow = document.createElement("div");
          deleteMetricsRow.className = "row";
          const deleteDurationBtn = document.createElement("button");
          deleteDurationBtn.className = "btn";
          deleteDurationBtn.style.fontSize = "11px";
          const deleteDuration = readMutationDurationMs(deleteMetrics);
          deleteDurationBtn.textContent = "⏱ delete " + formatDuration(deleteDuration ?? Number.NaN);
          deleteDurationBtn.onclick = () => showMetricsDialog("delete-row", table.tableId, deleteMetrics);
          const deleteMetricsSummary = document.createElement("div");
          deleteMetricsSummary.className = "mono muted";
          deleteMetricsSummary.style.fontSize = "11px";
          deleteMetricsSummary.textContent = formatMutationMetrics(deleteMetrics);
          deleteMetricsRow.appendChild(deleteDurationBtn);
          deleteMetricsRow.appendChild(deleteMetricsSummary);
          mutate.appendChild(deleteMetricsRow);
        }
        detailsPane.appendChild(mutate);
      }

      const rowsSection = document.createElement("div");
      rowsSection.className = "detail-section";
      rowsSection.innerHTML = "<div class='muted mono' style='margin-bottom:6px;'>rows grouped by groupKey</div>";
      for (const group of details.groups) {
        const detailsElement = document.createElement("details");
        detailsElement.open = details.groups.length <= 8;
        const summary = document.createElement("summary");
        summary.textContent = "group=" + prettyJson(group.groupKey) + " (" + group.rows.length + " rows)";
        detailsElement.appendChild(summary);
        const tableElement = document.createElement("table");
        tableElement.innerHTML = "<thead><tr><th>rowIdentifier</th><th>rowSortKey</th><th>rowData</th></tr></thead>";
        const tbody = document.createElement("tbody");
        for (const row of group.rows) {
          const tr = document.createElement("tr");
          const idCell = document.createElement("td");
          idCell.className = "mono";
          idCell.textContent = prettyJson(row.rowIdentifier);
          const sortCell = document.createElement("td");
          sortCell.className = "mono";
          sortCell.textContent = prettyJson(row.rowSortKey);
          const dataCell = document.createElement("td");
          const pre = document.createElement("pre");
          pre.textContent = prettyJson(row.rowData);
          dataCell.appendChild(pre);
          tr.appendChild(idCell);
          tr.appendChild(sortCell);
          tr.appendChild(dataCell);
          tbody.appendChild(tr);
        }
        tableElement.appendChild(tbody);
        detailsElement.appendChild(tableElement);
        rowsSection.appendChild(detailsElement);
      }
      detailsPane.appendChild(rowsSection);
    }

    function renderRawDetails() {
      detailsPane.innerHTML = "";
      const head = document.createElement("div");
      head.className = "detail-head";
      const title = document.createElement("div");
      title.className = "detail-title";
      title.textContent = "Raw BulldozerStorageEngine";
      const controls = document.createElement("div");
      controls.className = "row";
      const loadRootBtn = document.createElement("button");
      loadRootBtn.className = "btn";
      loadRootBtn.textContent = "🧷 root";
      loadRootBtn.onclick = () => runUiAction("load raw root", async () => {
        await loadRawNode([]);
      });
      const refreshRawBtn = document.createElement("button");
      refreshRawBtn.className = "btn icon";
      refreshRawBtn.title = "Refresh";
      refreshRawBtn.textContent = "🔄";
      refreshRawBtn.onclick = () => runUiAction("refresh raw", async () => {
        await loadRawNode(state.rawPath.length === 0 ? [] : state.rawPath);
      });
      controls.appendChild(loadRootBtn);
      controls.appendChild(refreshRawBtn);
      head.appendChild(title);
      head.appendChild(controls);
      detailsPane.appendChild(head);

      if (!state.rawNode) {
        detailsPane.appendChild(document.createTextNode("No raw node selected."));
        return;
      }

      const location = document.createElement("div");
      location.className = "detail-section mono";
      location.textContent = "path: " + JSON.stringify(state.rawNode.path);
      detailsPane.appendChild(location);

      const valueSection = document.createElement("div");
      valueSection.className = "detail-section";
      valueSection.innerHTML = "<div class='muted mono' style='margin-bottom:6px;'>value</div>";
      const valueEditor = document.createElement("textarea");
      valueEditor.value = prettyJson(state.rawNode.value);
      const valueActions = document.createElement("div");
      valueActions.className = "row";
      const saveBtn = document.createElement("button");
      saveBtn.className = "btn good";
      saveBtn.textContent = "💾 upsert";
      saveBtn.onclick = () => runUiAction("upsert raw value", async () => {
        await upsertRaw(state.rawNode.path, JSON.parse(valueEditor.value));
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn bad";
      deleteBtn.textContent = "🗑️ delete";
      deleteBtn.onclick = () => runUiAction("delete raw value", async () => {
        await deleteRaw(state.rawNode.path);
      });
      const upBtn = document.createElement("button");
      upBtn.className = "btn";
      upBtn.textContent = "⬆️ up";
      upBtn.onclick = () => runUiAction("go up", async () => {
        const nextPath = state.rawNode.path.length === 0 ? [] : state.rawNode.path.slice(0, -1);
        await loadRawNode(nextPath);
      });
      valueActions.appendChild(saveBtn);
      valueActions.appendChild(deleteBtn);
      valueActions.appendChild(upBtn);
      valueSection.appendChild(valueEditor);
      valueSection.appendChild(valueActions);
      detailsPane.appendChild(valueSection);

      const children = document.createElement("div");
      children.className = "detail-section";
      children.innerHTML = "<div class='muted mono' style='margin-bottom:6px;'>children</div>";
      const createRow = document.createElement("div");
      createRow.className = "row";
      const childInput = document.createElement("input");
      childInput.placeholder = "child segment";
      const openBtn = document.createElement("button");
      openBtn.className = "btn";
      openBtn.textContent = "➡️ open";
      openBtn.onclick = () => runUiAction("open child", async () => {
        const segment = childInput.value.trim();
        if (!segment) {
          throw new Error("child segment is required");
        }
        await loadRawNode(state.rawNode.path.concat([segment]));
      });
      createRow.appendChild(childInput);
      createRow.appendChild(openBtn);
      children.appendChild(createRow);
      const childrenList = document.createElement("div");
      childrenList.className = "raw-children";
      for (const child of state.rawNode.children) {
        const childBtn = document.createElement("button");
        childBtn.className = "btn mono";
        childBtn.textContent = child.segment + (child.hasChildren ? "/" : "");
        childBtn.onclick = () => runUiAction("open child", async () => {
          await loadRawNode(state.rawNode.path.concat([child.segment]));
        });
        childrenList.appendChild(childBtn);
      }
      children.appendChild(childrenList);
      detailsPane.appendChild(children);
    }

    function renderTimefoldDetails() {
      detailsPane.innerHTML = "";

      const head = document.createElement("div");
      head.className = "detail-head";
      const title = document.createElement("div");
      title.className = "detail-title";
      title.textContent = "Timefold queue debug";
      const actions = document.createElement("div");
      actions.className = "row";
      const refreshTimefoldBtn = document.createElement("button");
      refreshTimefoldBtn.className = "btn icon";
      refreshTimefoldBtn.title = "Refresh timefold debug";
      refreshTimefoldBtn.textContent = "🔄";
      refreshTimefoldBtn.onclick = () => runUiAction("refresh timefold debug", async () => {
        await loadTimefoldDebug();
      });
      actions.appendChild(refreshTimefoldBtn);
      head.appendChild(title);
      head.appendChild(actions);
      detailsPane.appendChild(head);

      if (state.timefoldDebug == null || typeof state.timefoldDebug !== "object") {
        detailsPane.innerHTML += "<div class='detail-section'>No timefold debug data loaded.</div>";
        return;
      }

      const debug = state.timefoldDebug;
      const queueRows = Array.isArray(debug.queue) ? debug.queue : [];
      const queueTableExists = debug.queueTableExists === true;
      const metadataTableExists = debug.metadataTableExists === true;
      const pgCronInstalled = debug.pgCronInstalled === true;

      const info = document.createElement("div");
      info.className = "detail-section";
      const infoTitle = document.createElement("div");
      infoTitle.className = "muted mono";
      infoTitle.style.marginBottom = "6px";
      infoTitle.textContent = "metadata";
      info.appendChild(infoTitle);
      const infoGrid = document.createElement("div");
      infoGrid.className = "kv";
      const infoRows = [
        ["queue table exists", String(queueTableExists)],
        ["metadata table exists", String(metadataTableExists)],
        ["pg_cron installed", String(pgCronInstalled)],
        ["lastProcessedAt", String(debug.lastProcessedAt ?? "null")],
        ["queue rows", String(queueRows.length)],
      ];
      for (const [label, value] of infoRows) {
        const keyCell = document.createElement("div");
        keyCell.className = "kv-key mono";
        keyCell.textContent = label;
        const valueCell = document.createElement("div");
        valueCell.className = "mono";
        valueCell.textContent = value;
        infoGrid.appendChild(keyCell);
        infoGrid.appendChild(valueCell);
      }
      info.appendChild(infoGrid);
      detailsPane.appendChild(info);

      const queueSection = document.createElement("div");
      queueSection.className = "detail-section";
      queueSection.innerHTML = "<div class='muted mono' style='margin-bottom:6px;'>queue rows (up to 500)</div>";
      if (queueRows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "mono muted";
        empty.textContent = "(empty)";
        queueSection.appendChild(empty);
      }
      for (const queueRow of queueRows) {
        const rowIdentifier = queueRow.rowIdentifier ?? queueRow.rowidentifier ?? "(unknown)";
        const scheduledAt = queueRow.scheduledAt ?? queueRow.scheduledat ?? "(unknown)";
        const detailsElement = document.createElement("details");
        detailsElement.open = queueRows.length <= 10;
        const summary = document.createElement("summary");
        summary.textContent = String(scheduledAt) + " | rowIdentifier=" + String(rowIdentifier);
        detailsElement.appendChild(summary);
        const rowGrid = document.createElement("div");
        rowGrid.className = "kv";
        const fields = [
          ["id", queueRow.id ?? null],
          ["tableStoragePath", queueRow.tableStoragePath ?? queueRow.tablestoragepath ?? null],
          ["groupKey", queueRow.groupKey ?? queueRow.groupkey ?? null],
          ["rowIdentifier", rowIdentifier],
          ["scheduledAt", scheduledAt],
          ["stateAfter", queueRow.stateAfter ?? queueRow.stateafter ?? null],
          ["rowData", queueRow.rowData ?? queueRow.rowdata ?? null],
          ["createdAt", queueRow.createdAt ?? queueRow.createdat ?? null],
          ["updatedAt", queueRow.updatedAt ?? queueRow.updatedat ?? null],
          ["reducerSql", queueRow.reducerSql ?? queueRow.reducersql ?? null],
        ];
        for (const [field, value] of fields) {
          const keyCell = document.createElement("div");
          keyCell.className = "kv-key mono";
          keyCell.textContent = field;
          const valueCell = document.createElement("div");
          if (typeof value === "string" && !value.includes("\\n") && value.length <= 140) {
            valueCell.className = "mono";
            valueCell.textContent = value;
          } else {
            const pre = document.createElement("pre");
            pre.textContent = prettyJson(value);
            valueCell.appendChild(pre);
          }
          rowGrid.appendChild(keyCell);
          rowGrid.appendChild(valueCell);
        }
        detailsElement.appendChild(rowGrid);
        queueSection.appendChild(detailsElement);
      }
      detailsPane.appendChild(queueSection);
    }

    function renderDetails() {
      if (state.mode === "raw") {
        renderRawDetails();
      } else if (state.mode === "timefold") {
        renderTimefoldDetails();
      } else {
        renderTableDetails();
      }
    }

    function setTheme(theme, options = { persist: true }) {
      state.theme = theme;
      document.body.setAttribute("data-theme", theme);
      themeBtn.textContent = theme === "dark" ? "🌙" : "☀️";
      if (options.persist) {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
      renderGraph();
      renderDetails();
    }

    function loadInitialTheme() {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "dark" || storedTheme === "light") {
        return storedTheme;
      }
      const systemTheme = resolveSystemTheme();
      window.localStorage.setItem(THEME_STORAGE_KEY, systemTheme);
      return systemTheme;
    }

    async function monitorServerVersion() {
      setInterval(async () => {
        try {
          const result = await fetchJson("/api/version");
          const serverVersion = typeof result.version === "string" ? result.version : null;
          if (serverVersion == null) return;
          if (state.serverVersion == null) {
            state.serverVersion = serverVersion;
            return;
          }
          if (serverVersion !== state.serverVersion) {
            window.location.reload();
          }
        } catch (error) {
          // Ignore polling failures while the dev server restarts.
        }
      }, VERSION_POLL_INTERVAL_MS);
    }

    function configurePanZoom() {
      graphShell.addEventListener("wheel", (event) => {
        event.preventDefault();
        const rect = graphShell.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const oldScale = state.viewport.scale;
        const zoomMultiplier = event.deltaY < 0 ? 1.08 : 0.92;
        const newScale = Math.max(0.3, Math.min(2.4, oldScale * zoomMultiplier));
        const worldX = (pointerX - state.viewport.x) / oldScale;
        const worldY = (pointerY - state.viewport.y) / oldScale;
        state.viewport.scale = newScale;
        state.viewport.x = pointerX - worldX * newScale;
        state.viewport.y = pointerY - worldY * newScale;
        updateSceneTransform();
      }, { passive: false });

      graphShell.addEventListener("mousedown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest(".node")) return;
        state.dragging.active = true;
        state.dragging.kind = "pan";
        state.dragging.startX = event.clientX;
        state.dragging.startY = event.clientY;
        state.dragging.startOffsetX = state.viewport.x;
        state.dragging.startOffsetY = state.viewport.y;
        state.dragging.moved = false;
        graphShell.classList.add("dragging");
      });

      window.addEventListener("mousemove", (event) => {
        if (!state.dragging.active) return;
        const deltaX = event.clientX - state.dragging.startX;
        const deltaY = event.clientY - state.dragging.startY;
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          state.dragging.moved = true;
        }
        if (state.dragging.kind === "pan") {
          state.viewport.x = state.dragging.startOffsetX + deltaX;
          state.viewport.y = state.dragging.startOffsetY + deltaY;
          updateSceneTransform();
          return;
        }
        if (state.dragging.kind === "node" && state.dragging.nodeId) {
          const nextX = Math.max(SCENE_MARGIN / 2, state.dragging.nodeStartX + deltaX / state.viewport.scale);
          const nextY = Math.max(SCENE_MARGIN / 2, state.dragging.nodeStartY + deltaY / state.viewport.scale);
          state.manualNodePositions[state.dragging.nodeId] = { x: nextX, y: nextY };
          persistNodePositions();
          relayoutGraph();
        }
      });

      window.addEventListener("mouseup", () => {
        if (state.dragging.kind === "node" && state.dragging.nodeId && state.dragging.moved) {
          state.dragging.suppressClickTableId = state.dragging.nodeId;
        }
        const draggingNodeId = state.dragging.nodeId;
        if (draggingNodeId) {
          const node = graphNodes.querySelector('[data-table-id="' + draggingNodeId.replaceAll('"', '\\"') + '"]');
          if (node instanceof HTMLElement) {
            node.classList.remove("dragging");
          }
        }
        state.dragging.active = false;
        state.dragging.kind = null;
        state.dragging.nodeId = null;
        state.dragging.moved = false;
        graphShell.classList.remove("dragging");
      });
    }

    modeTablesBtn.onclick = () => runUiAction("switch mode", async () => {
      setMode("table");
      if (state.selectedTableId) {
        await selectTable(state.selectedTableId);
      } else {
        renderDetails();
      }
    });
    modeRawBtn.onclick = () => runUiAction("switch mode", async () => {
      setMode("raw");
      await loadRawNode(state.rawPath.length === 0 ? [] : state.rawPath);
    });
    toggleIntermediatesBtn.onclick = () => {
      state.showIntermediates = !state.showIntermediates;
      toggleIntermediatesBtn.textContent = state.showIntermediates ? "👁 Intermediates" : "👁‍🗨 Intermediates";
      renderGraph();
    };
    schemaSelect.onchange = () => runUiAction("switch schema", async () => {
      setStatus("switching schema...");
      state.selectedTableId = null;
      state.selectedTableDetails = null;
      await fetchJson("/api/switch-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: schemaSelect.value }),
      });
      await loadSchema();
      renderDetails();
      setStatus("ready");
    });
    modeTimefoldBtn.onclick = () => runUiAction("switch mode", async () => {
      setMode("timefold");
      await loadTimefoldDebug();
    });
    initAllBtn.onclick = () => runUiAction("init all tables", async () => {
      await initAllTables();
    });
    refreshBtn.onclick = () => runUiAction("refresh", async () => {
      await loadSchema();
    });
    fitBtn.onclick = () => {
      fitGraphToView();
    };
    themeBtn.onclick = () => {
      setTheme(state.theme === "dark" ? "light" : "dark");
    };
    errorCloseBtn.onclick = () => {
      if (errorDialog.open) {
        errorDialog.close();
      }
    };
    metricsDialogCloseBtn.onclick = () => {
      if (metricsDialog.open) {
        metricsDialog.close();
      }
    };

    configurePanZoom();
    const initialTheme = loadInitialTheme();
    setTheme(initialTheme, { persist: false });
    monitorServerVersion();
    runUiAction("initial load", async () => {
      await loadSchemaList();
      await loadSchema();
      renderDetails();
    });
  </script>
</body>
</html>`;
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    throw new StackAssertionError("Bulldozer Studio only accepts loopback requests.", {
      remoteAddress: request.socket.remoteAddress,
    });
  }

  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = requestUrl.pathname;
  const method = request.method ?? "GET";
  if (method === "POST") {
    requireAuthorizedMutationRequest(request, requestUrl);
  }

  if (method === "GET" && pathname === "/") {
    sendHtml(response, getStudioPageHtml());
    return;
  }

  if (method === "GET" && pathname === "/api/version") {
    sendJson(response, 200, { version: STUDIO_INSTANCE_ID });
    return;
  }

  if (method === "GET" && pathname === "/api/schemas") {
    sendJson(response, 200, {
      available: Object.keys(AVAILABLE_SCHEMAS),
      current: currentSchemaName,
    });
    return;
  }

  if (method === "POST" && pathname === "/api/switch-schema") {
    const body = await readRequestBody(request);
    const parsed = JSON.parse(body);
    const name = parsed?.name;
    const schemaFactory = typeof name === "string" ? Reflect.get(AVAILABLE_SCHEMAS, name) : null;
    if (typeof name !== "string" || typeof schemaFactory !== "function") {
      sendJson(response, 400, { error: `Unknown schema "${name}". Available: ${Object.keys(AVAILABLE_SCHEMAS).join(", ")}` });
      return;
    }
    switchSchema(name);
    sendJson(response, 200, { ok: true, current: currentSchemaName });
    return;
  }

  if (method === "GET" && pathname === "/api/schema") {
    const tables = await Promise.all(registry.tables.map((table) => getTableSnapshot(table)));
    const layout = await computeStudioLayout(tables);
    sendJson(response, 200, { tables, layout, currentSchema: currentSchemaName, categories: registry.categories });
    return;
  }

  if (method === "GET" && pathname === "/api/timefold/debug") {
    const snapshot = await getTimefoldDebugSnapshot();
    sendJson(response, 200, snapshot);
    return;
  }

  if (method === "POST" && pathname === "/api/tables/init-all") {
    const initializedTableIds = await initAllTablesInTopologicalOrder();
    sendJson(response, 200, { ok: true, initializedTableIds });
    return;
  }

  if (pathname.startsWith("/api/table/")) {
    const pathParts = pathname.split("/").filter(Boolean);
    const tableId = decodeURIComponent(pathParts[2] ?? "");
    const record = registry.tableById.get(tableId);
    if (!record) {
      sendJson(response, 404, { error: `Unknown table: ${tableId}` });
      return;
    }

    if (method === "GET" && pathParts[3] === "details") {
      const details = await getTableDetails(record);
      sendJson(response, 200, details);
      return;
    }

    if (method === "POST" && pathParts[3] === "init") {
      await executeStatements(record.table.init());
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathParts[3] === "delete") {
      await executeStatements(record.table.delete());
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathParts[3] === "set-row") {
      if (!isStudioStoredTable(record.table)) {
        sendJson(response, 400, { error: "This table does not support setRow." });
        return;
      }
      const body = requireRecord(await readJsonBody(request), "set-row body must be an object.");
      const rowIdentifier = requireString(Reflect.get(body, "rowIdentifier"), "rowIdentifier must be a string.");
      const rowData = requireJsonValue(Reflect.get(body, "rowData"), "rowData must be valid JSON.");
      if (!isRecord(rowData)) {
        throw new StackAssertionError("rowData must be a JSON object.");
      }
      const metrics = await executeStatements(record.table.setRow(
        rowIdentifier,
        { type: "expression", sql: quoteSqlJsonbLiteral(rowData).sql },
      ));
      sendJson(response, 200, { ok: true, metrics });
      return;
    }

    if (method === "POST" && pathParts[3] === "delete-row") {
      if (!isStudioStoredTable(record.table)) {
        sendJson(response, 400, { error: "This table does not support deleteRow." });
        return;
      }
      const body = requireRecord(await readJsonBody(request), "delete-row body must be an object.");
      const rowIdentifier = requireString(Reflect.get(body, "rowIdentifier"), "rowIdentifier must be a string.");
      const metrics = await executeStatements(record.table.deleteRow(rowIdentifier));
      sendJson(response, 200, { ok: true, metrics });
      return;
    }
  }

  if (method === "GET" && pathname === "/api/raw/node") {
    const pathParam = requestUrl.searchParams.get("path") ?? "[]";
    const parsedPath = JSON.parse(pathParam);
    const pathSegments = requireStringArray(parsedPath, "path must be a string[]");
    const node = await getRawNode(pathSegments);
    sendJson(response, 200, node);
    return;
  }

  if (method === "POST" && pathname === "/api/raw/upsert") {
    const body = requireRecord(await readJsonBody(request), "raw upsert body must be an object.");
    const pathSegments = requireStringArray(Reflect.get(body, "pathSegments"), "pathSegments must be a string[]");
    const value = requireJsonValue(Reflect.get(body, "value") ?? null, "value must be valid JSON.");
    const keyPathSql = keyPathSqlLiteral(pathSegments);
    await retryTransaction(globalPrismaClient, async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL jit = off`);
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${BULLDOZER_LOCK_ID})`);
      await tx.$executeRawUnsafe(`
        WITH "targetPath" AS (
          SELECT ${keyPathSql} AS "path"
        )
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        SELECT
          gen_random_uuid(),
          "targetPath"."path"[1:"prefixes"."prefixLength"] AS "keyPath",
          'null'::jsonb AS "value"
        FROM "targetPath"
        CROSS JOIN LATERAL generate_series(0, GREATEST(cardinality("targetPath"."path") - 1, 0)) AS "prefixes"("prefixLength")
        ON CONFLICT ("keyPath") DO NOTHING
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        VALUES (gen_random_uuid(), ${keyPathSql}, ${quoteSqlJsonbLiteral(value).sql})
        ON CONFLICT ("keyPath") DO UPDATE
        SET "value" = EXCLUDED."value"
      `);
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/api/raw/delete") {
    const body = requireRecord(await readJsonBody(request), "raw delete body must be an object.");
    const pathSegments = requireStringArray(Reflect.get(body, "pathSegments"), "pathSegments must be a string[]");
    if (
      pathSegments.length === 0
      || (pathSegments.length === 1 && pathSegments[0] === "table")
    ) {
      throw new StackAssertionError("Deleting reserved root paths is not allowed.");
    }
    await retryTransaction(globalPrismaClient, async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL jit = off`);
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${BULLDOZER_LOCK_ID})`);
      await tx.$executeRawUnsafe(`
        DELETE FROM "BulldozerStorageEngine"
        WHERE "keyPath" = ${keyPathSqlLiteral(pathSegments)}
      `);
    });
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: `Route not found: ${method} ${pathname}` });
}

async function main(): Promise<void> {
  await rebindInitializedDerivedTables();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).then(
      () => undefined,
      (error) => {
        console.error(error);
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        sendJson(response, 500, { error: message });
      },
    );
  });

  server.listen(STUDIO_PORT, STUDIO_HOST, () => {
    console.log(`Bulldozer Studio running on http://${STUDIO_HOST}:${STUDIO_PORT}`);
  });

  const shutdown = async () => {
    server.close();
  };
  process.on("SIGINT", () => {
    shutdown().then(() => process.exit(0), () => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown().then(() => process.exit(0), () => process.exit(1));
  });
}

main().then(
  () => undefined,
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
