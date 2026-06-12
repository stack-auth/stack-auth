import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";

function httpBase(): string | null {
  return getEnvVariable("STACK_SPACETIMEDB_URL", "") || null;
}

// Cap each individual fetch to SpacetimeDB at 10s
const SPACETIMEDB_FETCH_TIMEOUT_MS = 10_000;

let enrollmentPromise: Promise<void> | null = null;

async function getServiceToken(): Promise<string | null> {
  const base = httpBase();
  if (!base) return null;
  const token = getEnvVariable("STACK_SPACETIMEDB_SERVICE_TOKEN", "");
  if (!token) return null;
  const logToken = getEnvVariable("STACK_MCP_LOG_TOKEN", "");
  if (!logToken) return null;

  if (!enrollmentPromise) {
    enrollmentPromise = (async () => {
      try {
        await rawCallReducer(token, "enroll_service", [
          logToken,
          "Stack Auth Backend",
        ]);
      } catch (err) {
        enrollmentPromise = null;
        throw err;
      }
    })();
  }
  await enrollmentPromise;
  return token;
}

async function rawCallReducer(token: string, reducer: string, args: unknown[]): Promise<void> {
  const base = httpBase();
  if (!base) throw new HexclaveAssertionError("SpacetimeDB not configured");
  const dbName = getEnvVariable("STACK_SPACETIMEDB_DB_NAME");
  const res = await fetch(`${base}/v1/database/${encodeURIComponent(dbName)}/call/${encodeURIComponent(reducer)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(args, (_, v) => {
      if (typeof v !== "bigint") return v;
      const MAX = BigInt(Number.MAX_SAFE_INTEGER);
      if (v <= MAX && v >= -MAX) return Number(v);
      return v.toString();
    }),
    signal: AbortSignal.timeout(SPACETIMEDB_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const preview = (await res.text()).slice(0, 200);
    throw spacetimeDbError(`Reducer ${reducer} failed`, res.status, preview);
  }
}


function spacetimeDbError(label: string, status: number, preview: string): Error {
  const detail = `${label} (${status}): ${preview}`;
  if (status >= 400 && status < 500) return new StatusError(status, detail);
  if (status >= 500) return new StatusError(StatusError.BadGateway, `${label} (upstream ${status}): ${preview}`);
  return new HexclaveAssertionError(detail);
}

async function withEnrollmentRetry<T>(op: (token: string) => Promise<T>): Promise<T | null> {
  const token = await getServiceToken();
  if (!token) return null;
  try {
    return await op(token);
  } catch (err) {
    if (!(err instanceof StatusError) || err.statusCode !== 401) throw err;
    enrollmentPromise = null;
    const fresh = await getServiceToken();
    if (!fresh) throw err;
    return await op(fresh);
  }
}

export async function callReducer(reducer: string, args: unknown[]): Promise<void> {
  await withEnrollmentRetry((token) => rawCallReducer(token, reducer, args));
}

export async function callReducerStrict(reducer: string, args: unknown[]): Promise<void> {
  const ran = await withEnrollmentRetry((token) => rawCallReducer(token, reducer, args));
  if (ran === null) {
    throw new HexclaveAssertionError(
      `SpacetimeDB is not configured. Reducer ${reducer} cannot run. ` +
      `Check STACK_SPACETIMEDB_URL and STACK_SPACETIMEDB_SERVICE_TOKEN.`
    );
  }
}

/**
 * Wraps a nullable value in the SpacetimeDB tagged-variant encoding expected
 * by HTTP reducer calls for `Option<T>` arguments. Use for every reducer arg
 * that's declared `.optional()` in the module source.
 */
export function opt<T>(value: T | null | undefined): { some: T } | { none: [] } {
  return value == null ? { none: [] } : { some: value };
}

async function rawCallSql(token: string, sql: string): Promise<Array<{
  schema: { elements: Array<{ name: { some?: string } | null }> },
  rows: unknown[][],
}>> {
  const base = httpBase();
  if (!base) throw new HexclaveAssertionError("SpacetimeDB not configured");
  const dbName = getEnvVariable("STACK_SPACETIMEDB_DB_NAME");
  const res = await fetch(`${base}/v1/database/${encodeURIComponent(dbName)}/sql`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: sql,
    signal: AbortSignal.timeout(SPACETIMEDB_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const preview = (await res.text()).slice(0, 200);
    throw spacetimeDbError("SQL query failed", res.status, preview);
  }
  return await res.json() as Array<{
    schema: { elements: Array<{ name: { some?: string } | null }> },
    rows: unknown[][],
  }>;
}

export async function callSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const parsed = await withEnrollmentRetry((token) => rawCallSql(token, sql));
  if (parsed == null || parsed.length === 0) return [];
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
