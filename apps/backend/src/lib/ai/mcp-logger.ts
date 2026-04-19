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

let enrollmentPromise: Promise<void> | null = null;

async function getServiceToken(): Promise<string | null> {
  const base = httpBase();
  if (!base) return null;

  const token = getEnvVariable("STACK_SPACETIMEDB_SERVICE_TOKEN", "");
  if (!token) {
    throw new StackAssertionError(
      "STACK_SPACETIMEDB_SERVICE_TOKEN is not set. Mint one with: " +
      "`curl -X POST <STACK_SPACETIMEDB_URL>/v1/identity` " +
      "(e.g. http://localhost:8139/v1/identity for local dev) and set the `token` " +
      "field from the response as an env var."
    );
  }

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
  const res = await fetch(`${base}/v1/database/${dbName}/call/${reducer}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(args, (_, v) => {
      if (typeof v !== "bigint") return v;
      // SpacetimeDB's HTTP API wants u64/i64 as JSON numbers, not strings.
      // Convert bigints within JS safe-int range; fall back to string above that.
      const MAX = BigInt(Number.MAX_SAFE_INTEGER);
      if (v <= MAX && v >= -MAX) return Number(v);
      return v.toString();
    }),
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
  const res = await fetch(`${base}/v1/database/${dbName}/sql`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: sql,
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
