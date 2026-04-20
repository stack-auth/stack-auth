import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export type McpLogEntry = {
  correlationId: string,
  toolName: string,
  reason: string,
  userPrompt: string,
  conversationId: string | undefined,
  question: string,
  response: string,
  stepCount: number,
  innerToolCallsJson: string,
  durationMs: bigint,
  modelId: string,
  errorMessage: string | undefined,
};

function httpBase(): string | null {
  return getEnvVariable("STACK_SPACETIMEDB_URL", "") || null;
}

// Cap every HTTP call to SpacetimeDB so a wedged host can't hang a request path
// (e.g. a reviewer UI mutation) indefinitely. 10s is generous for local reducer
// calls and SQL queries while still surfacing a real failure in bounded time.
const SPACETIMEDB_FETCH_TIMEOUT_MS = 10_000;

let enrollmentPromise: Promise<void> | null = null;

async function getServiceToken(): Promise<string | null> {
  const base = httpBase();
  if (!base) return null;
  const token = getEnvVariable("STACK_SPACETIMEDB_SERVICE_TOKEN", "");
  if (!token) return null;

  if (!enrollmentPromise) {
    enrollmentPromise = rawCallReducer(token, "enroll_service", [
      getEnvVariable("STACK_MCP_LOG_TOKEN"),
      "Stack Auth Backend",
    ]).catch(err => {
      enrollmentPromise = null;
      throw err;
    });
  }
  await enrollmentPromise;
  return token;
}

async function rawCallReducer(token: string, reducer: string, args: unknown[]): Promise<void> {
  const base = httpBase();
  if (!base) throw new StackAssertionError("SpacetimeDB not configured");
  const dbName = getEnvVariable("STACK_SPACETIMEDB_DB_NAME");
  const res = await fetch(`${base}/v1/database/${encodeURIComponent(dbName)}/call/${encodeURIComponent(reducer)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(args, (_, v) => {
      if (typeof v === "bigint") return Number(v);
      return v;
    }),
    signal: AbortSignal.timeout(SPACETIMEDB_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new StackAssertionError(`Reducer ${reducer} failed (${res.status}): ${await res.text()}`);
  }
}

export async function callReducer(reducer: string, args: unknown[]): Promise<void> {
  const token = await getServiceToken();
  if (!token) return;
  await rawCallReducer(token, reducer, args);
}

/**
 * Like {@link callReducer} but throws when SpacetimeDB isn't configured, rather
 * than no-opping. Use for endpoints where the client treats a 200 as proof the
 * mutation actually ran (reviewer enrollment, human QA edits, deletions).
 * Fire-and-forget logging paths should keep using the best-effort variant.
 */
export async function callReducerStrict(reducer: string, args: unknown[]): Promise<void> {
  const token = await getServiceToken();
  if (!token) {
    throw new StackAssertionError(
      `SpacetimeDB is not configured. Reducer ${reducer} cannot run. ` +
      `Check STACK_SPACETIMEDB_URL and STACK_SPACETIMEDB_SERVICE_TOKEN.`
    );
  }
  await rawCallReducer(token, reducer, args);
}

/**
 * Wraps a nullable value in the SpacetimeDB tagged-variant encoding expected
 * by HTTP reducer calls for `Option<T>` arguments. Use for every reducer arg
 * that's declared `.optional()` in the module source.
 */
export function opt<T>(value: T | null | undefined): { some: T } | { none: [] } {
  return value == null ? { none: [] } : { some: value };
}

export async function callSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const token = await getServiceToken();
  if (!token) return [];
  const base = httpBase();
  if (!base) return [];
  const dbName = getEnvVariable("STACK_SPACETIMEDB_DB_NAME");
  const res = await fetch(`${base}/v1/database/${encodeURIComponent(dbName)}/sql`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: sql,
    signal: AbortSignal.timeout(SPACETIMEDB_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new StackAssertionError(`SQL query failed (${res.status}): ${await res.text()}`);
  }
  const parsed = await res.json() as Array<{
    schema: { elements: Array<{ name: { some?: string } | null }> },
    rows: unknown[][],
  }>;
  if (parsed.length === 0) return [];
  const first = parsed[0];
  const cols = first.schema.elements.map(e => e.name?.some ?? "");
  return first.rows.map(row => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      obj[c] = row[i];
    });
    return obj as T;
  });
}

export async function logMcpCall(entry: McpLogEntry): Promise<void> {
  const logToken = getEnvVariable("STACK_MCP_LOG_TOKEN", "");
  if (!logToken) return;
  // Positional args per reducer schema: token, correlationId, conversationId, toolName,
  // reason, userPrompt, question, response, stepCount, innerToolCallsJson, durationMs,
  // modelId, errorMessage
  await callReducer("log_mcp_call", [
    logToken,
    entry.correlationId,
    opt(entry.conversationId),
    entry.toolName,
    entry.reason,
    entry.userPrompt,
    entry.question,
    entry.response,
    entry.stepCount,
    entry.innerToolCallsJson,
    entry.durationMs,
    entry.modelId,
    opt(entry.errorMessage),
  ]);
}
