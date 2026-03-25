import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import http from "node:http";
import { exampleFungibleLedgerSchema } from "../src/lib/bulldozer/db/example-schema";
import { toQueryableSqlQuery } from "../src/lib/bulldozer/db/index";
import { globalPrismaClient, retryTransaction } from "../src/prisma-client";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type SqlExpression<T> = { type: "expression", sql: string };
type SqlStatement = { type: "statement", sql: string, outputName?: string };
type SqlQuery = { type: "query", sql: string, toStatement(outputName?: string): SqlStatement };

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
const BULLDOZER_LOCK_ID = 7857391;
const STUDIO_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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

function quoteSqlStringLiteral(input: string): string {
  return `'${input.replaceAll("'", "''")}'`;
}
function quoteSqlIdentifier(input: string): string {
  if (input.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) == null) {
    throw new StackAssertionError("Invalid SQL identifier for Bulldozer Studio query.", { input });
  }
  return `"${input}"`;
}

function quoteSqlJsonbLiteral(input: unknown): string {
  return `${quoteSqlStringLiteral(JSON.stringify(input))}::jsonb`;
}

function keyPathSqlLiteral(pathSegments: string[]): string {
  if (pathSegments.length === 0) return "ARRAY[]::jsonb[]";
  return `ARRAY[${pathSegments.map((segment) => quoteSqlJsonbLiteral(segment)).join(", ")}]::jsonb[]`;
}

function tableIdToString(tableId: unknown): string {
  if (typeof tableId === "string") return tableId;
  return JSON.stringify(tableId);
}

function createTableRegistry(schema: Record<string, unknown>): {
  tables: StudioTableRecord[],
  tableById: Map<string, StudioTableRecord>,
  idByTable: Map<StudioTable, string>,
} {
  const tables: StudioTableRecord[] = [];
  const idByTable = new Map<StudioTable, string>();

  for (const [name, value] of Object.entries(schema)) {
    if (!isStudioTable(value)) continue;
    const id = name;
    const record: StudioTableRecord = { id, name, table: value };
    tables.push(record);
    idByTable.set(value, id);
  }

  if (tables.length === 0) {
    throw new StackAssertionError("No studio-compatible tables found in schema object.");
  }

  const tableById = new Map(tables.map((table) => [table.id, table]));
  return { tables, tableById, idByTable };
}

const schemaObject: Record<string, unknown> = exampleFungibleLedgerSchema;
const registry = createTableRegistry(schemaObject);

function toExecutableSqlCteStatement(statements: SqlStatement[]): string {
  const cteStatements = statements.map((statement, index) => {
    const outputName = statement.outputName ?? `unnamed_statement_${index}`;
    return `${quoteSqlIdentifier(outputName)} AS (\n${statement.sql}\n)`;
  }).join(",\n");

  return `WITH __dummy_statement_1__ AS (SELECT 1),\n${cteStatements},\n__dummy_statement_2__ AS (SELECT 1)\nSELECT 1;`;
}

async function executeStatements(statements: SqlStatement[]): Promise<void> {
  await retryTransaction(globalPrismaClient, async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${BULLDOZER_LOCK_ID})`);
    await tx.$executeRawUnsafe(toExecutableSqlCteStatement(statements));
  });
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
  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
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
    }
    .node:hover {
      border-color: var(--accent);
    }
    .node.active {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
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
  </style>
</head>
<body data-theme="dark">
  <div class="app">
    <header class="toolbar">
      <div class="toolbar-left">
        <div class="title">Bulldozer Studio</div>
        <button id="modeTablesBtn" class="btn active">🧩 Tables</button>
        <button id="modeRawBtn" class="btn">🗂️ Raw</button>
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

  <script>
    const NODE_WIDTH = 260;
    const NODE_HEIGHT = 126;
    const LEVEL_GAP_Y = 230;
    const COLUMN_GAP_X = 320;
    const SCENE_MARGIN = 40;
    const THEME_STORAGE_KEY = "bulldozer-studio-theme";
    const VERSION_POLL_INTERVAL_MS = 1200;

    const state = {
      mode: "table",
      schema: null,
      selectedTableId: null,
      selectedTableDetails: null,
      rawNode: null,
      rawPath: [],
      status: "ready",
      theme: "dark",
      serverVersion: null,
      graphLayout: null,
      viewport: {
        x: 24,
        y: 24,
        scale: 1,
      },
      dragging: {
        active: false,
        startX: 0,
        startY: 0,
        startOffsetX: 0,
        startOffsetY: 0,
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
    const modeTablesBtn = document.getElementById("modeTablesBtn");
    const modeRawBtn = document.getElementById("modeRawBtn");
    const refreshBtn = document.getElementById("refreshBtn");
    const fitBtn = document.getElementById("fitBtn");
    const themeBtn = document.getElementById("themeBtn");

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

    async function runUiAction(label, fn) {
      try {
        await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showErrorDialog(label + ": " + message);
      }
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

    async function fetchJson(path, init) {
      const response = await fetch(path, init);
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

    function layoutGraph(tables) {
      const tableMap = new Map(tables.map((table) => [table.id, table]));
      const depthCache = new Map();
      const byDepth = new Map();

      for (const table of tables) {
        const depth = computeDepth(table.id, tableMap, depthCache, new Set());
        if (!byDepth.has(depth)) byDepth.set(depth, []);
        byDepth.get(depth).push(table);
      }

      const depths = [...byDepth.keys()].sort((a, b) => a - b);
      const positions = new Map();
      let sceneWidth = 600;
      let sceneHeight = 600;

      for (let depthIndex = 0; depthIndex < depths.length; depthIndex++) {
        const depth = depths[depthIndex];
        const row = byDepth.get(depth);
        row.sort((a, b) => compareStrings(String(a.name), String(b.name)));
        const totalWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP_X;
        const startX = SCENE_MARGIN + Math.max(0, (900 - totalWidth) / 2);
        const y = SCENE_MARGIN + depthIndex * LEVEL_GAP_Y;
        for (let i = 0; i < row.length; i++) {
          const x = startX + i * (NODE_WIDTH + COLUMN_GAP_X);
          positions.set(row[i].id, { x, y });
          sceneWidth = Math.max(sceneWidth, x + NODE_WIDTH + SCENE_MARGIN);
          sceneHeight = Math.max(sceneHeight, y + NODE_HEIGHT + SCENE_MARGIN);
        }
      }

      return {
        positions,
        sceneWidth,
        sceneHeight,
      };
    }

    function updateSceneTransform() {
      graphScene.style.transform = "translate(" + state.viewport.x + "px, " + state.viewport.y + "px) scale(" + state.viewport.scale + ")";
    }

    function setMode(mode) {
      state.mode = mode;
      modeTablesBtn.classList.toggle("active", mode === "table");
      modeRawBtn.classList.toggle("active", mode === "raw");
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

    function renderGraph() {
      graphNodes.innerHTML = "";
      graphEdges.innerHTML = "";
      if (!state.schema || !Array.isArray(state.schema.tables)) return;

      const tables = state.schema.tables;
      state.graphLayout = layoutGraph(tables);
      const positions = state.graphLayout.positions;
      graphScene.style.width = state.graphLayout.sceneWidth + "px";
      graphScene.style.height = state.graphLayout.sceneHeight + "px";
      graphEdges.setAttribute("width", String(state.graphLayout.sceneWidth));
      graphEdges.setAttribute("height", String(state.graphLayout.sceneHeight));
      graphEdges.setAttribute("viewBox", "0 0 " + state.graphLayout.sceneWidth + " " + state.graphLayout.sceneHeight);
      graphNodes.style.width = state.graphLayout.sceneWidth + "px";
      graphNodes.style.height = state.graphLayout.sceneHeight + "px";

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

      for (const table of tables) {
        const to = positions.get(table.id);
        if (!to) continue;
        const dependencies = Array.isArray(table.dependencies) ? table.dependencies : [];
        for (const dependencyId of dependencies) {
          const from = positions.get(dependencyId);
          if (!from) continue;
          const startX = from.x + NODE_WIDTH / 2;
          const startY = from.y + NODE_HEIGHT;
          const endX = to.x + NODE_WIDTH / 2;
          const endY = to.y;
          const midY = startY + (endY - startY) / 2;
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "M " + startX + " " + startY + " V " + midY + " H " + endX + " V " + endY);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", "var(--accent)");
          path.setAttribute("stroke-width", "1.7");
          path.setAttribute("marker-end", "url(#arrow)");
          graphEdges.appendChild(path);
        }
      }

      for (const table of tables) {
        const pos = positions.get(table.id);
        if (!pos) continue;
        const isStoredTable = String(table.operator || "").toLowerCase() === "stored";
        const node = document.createElement("div");
        node.className = "node" + (state.selectedTableId === table.id ? " active" : "");
        node.style.left = pos.x + "px";
        node.style.top = pos.y + "px";

        const type = document.createElement("div");
        type.className = "node-type " + (isStoredTable ? "stored" : "derived");
        type.textContent = String(table.operator || "unknown");

        const name = document.createElement("div");
        name.className = "node-name mono " + (isStoredTable ? "stored" : "derived");
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
          initBtn.className = "btn good";
          initBtn.textContent = "🚀 init";
          initBtn.onclick = (event) => {
            event.stopPropagation();
            runUiAction("init table", async () => {
              await tableAction(table.id, "init");
            });
          };
          left.appendChild(initBtn);
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
        node.onclick = () => {
          runUiAction("load table details", async () => {
            setMode("table");
            await selectTable(table.id);
          });
        };
        graphNodes.appendChild(node);
      }

      updateSceneTransform();
    }

    function getRawInputDefault() {
      return "{\\n  \\"accountId\\": \\"acct-demo\\",\\n  \\"asset\\": \\"USD\\",\\n  \\"amount\\": \\"10.00\\",\\n  \\"side\\": \\"credit\\",\\n  \\"txHash\\": \\"0xdemo\\",\\n  \\"blockNumber\\": 1,\\n  \\"timestamp\\": \\"2026-01-01T00:00:00Z\\",\\n  \\"counterparty\\": null,\\n  \\"memo\\": null\\n}";
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
      await fetchJson("/api/table/" + encodeURIComponent(tableId) + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
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
      kv.innerHTML = ""
        + "<div class='kv-key'>name</div><div class='mono'>" + table.name + "</div>"
        + "<div class='kv-key'>tableId</div><div class='mono'>" + table.tableId + "</div>"
        + "<div class='kv-key'>operator</div><div class='mono'>" + table.operator + "</div>"
        + "<div class='kv-key'>initialized</div><div>" + String(table.initialized) + "</div>"
        + "<div class='kv-key'>dependencies</div><div class='mono'>" + (table.dependencies.length === 0 ? "(none)" : table.dependencies.join(", ")) + "</div>"
        + "<div class='kv-key'>rows(all groups)</div><div class='mono'>" + String(details.totalRows) + "</div>";
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
          const rowIdentifier = setRowId.value.trim();
          if (!rowIdentifier) {
            throw new Error("rowIdentifier is required");
          }
          const rowData = JSON.parse(setRowData.value);
          await tableAction(table.id, "set-row", { rowIdentifier, rowData });
        });
        const deleteRowId = document.createElement("input");
        deleteRowId.placeholder = "rowIdentifier to delete";
        const deleteRowBtn = document.createElement("button");
        deleteRowBtn.className = "btn bad";
        deleteRowBtn.textContent = "🗑️ delete row";
        deleteRowBtn.onclick = () => runUiAction("delete row", async () => {
          const rowIdentifier = deleteRowId.value.trim();
          if (!rowIdentifier) {
            throw new Error("rowIdentifier is required");
          }
          await tableAction(table.id, "delete-row", { rowIdentifier });
        });
        setRowActions.appendChild(setBtn);
        setRowActions.appendChild(deleteRowBtn);
        mutate.appendChild(setRowId);
        mutate.appendChild(setRowData);
        mutate.appendChild(deleteRowId);
        mutate.appendChild(setRowActions);
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

    function renderDetails() {
      if (state.mode === "raw") {
        renderRawDetails();
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
        state.dragging.startX = event.clientX;
        state.dragging.startY = event.clientY;
        state.dragging.startOffsetX = state.viewport.x;
        state.dragging.startOffsetY = state.viewport.y;
        graphShell.classList.add("dragging");
      });

      window.addEventListener("mousemove", (event) => {
        if (!state.dragging.active) return;
        state.viewport.x = state.dragging.startOffsetX + (event.clientX - state.dragging.startX);
        state.viewport.y = state.dragging.startOffsetY + (event.clientY - state.dragging.startY);
        updateSceneTransform();
      });

      window.addEventListener("mouseup", () => {
        state.dragging.active = false;
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

    configurePanZoom();
    const initialTheme = loadInitialTheme();
    setTheme(initialTheme, { persist: false });
    monitorServerVersion();
    runUiAction("initial load", async () => {
      await loadSchema();
      renderDetails();
    });
  </script>
</body>
</html>`;
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = requestUrl.pathname;
  const method = request.method ?? "GET";

  if (method === "GET" && pathname === "/") {
    sendHtml(response, getStudioPageHtml());
    return;
  }

  if (method === "GET" && pathname === "/api/version") {
    sendJson(response, 200, { version: STUDIO_INSTANCE_ID });
    return;
  }

  if (method === "GET" && pathname === "/api/schema") {
    const tables = await Promise.all(registry.tables.map((table) => getTableSnapshot(table)));
    sendJson(response, 200, { tables });
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
      const rowData = requireRecord(Reflect.get(body, "rowData"), "rowData must be a JSON object.");
      await executeStatements(record.table.setRow(
        rowIdentifier,
        { type: "expression", sql: quoteSqlJsonbLiteral(rowData) },
      ));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathParts[3] === "delete-row") {
      if (!isStudioStoredTable(record.table)) {
        sendJson(response, 400, { error: "This table does not support deleteRow." });
        return;
      }
      const body = requireRecord(await readJsonBody(request), "delete-row body must be an object.");
      const rowIdentifier = requireString(Reflect.get(body, "rowIdentifier"), "rowIdentifier must be a string.");
      await executeStatements(record.table.deleteRow(rowIdentifier));
      sendJson(response, 200, { ok: true });
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
    const value = Reflect.get(body, "value") ?? null;
    await retryTransaction(globalPrismaClient, async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
        VALUES (gen_random_uuid(), ${keyPathSqlLiteral(pathSegments)}, ${quoteSqlJsonbLiteral(value)})
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
    await retryTransaction(globalPrismaClient, async (tx) => {
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

  server.listen(STUDIO_PORT, () => {
    console.log(`Bulldozer Studio running on http://localhost:${STUDIO_PORT}`);
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
