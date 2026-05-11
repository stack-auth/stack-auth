import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";

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
  if (!base) throw new StackAssertionError("SpacetimeDB not configured");
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
  return new StackAssertionError(detail);
}

async function callWithEnrollmentRetry(reducer: string, args: unknown[]): Promise<boolean> {
  const token = await getServiceToken();
  if (!token) return false;
  try {
    await rawCallReducer(token, reducer, args);
    return true;
  } catch (err) {
    if (!(err instanceof StatusError) || err.statusCode !== 401) throw err;
    enrollmentPromise = null;
    const fresh = await getServiceToken();
    if (!fresh) throw err;
    await rawCallReducer(fresh, reducer, args);
    return true;
  }
}

export async function callReducer(reducer: string, args: unknown[]): Promise<void> {
  await callWithEnrollmentRetry(reducer, args);
}

export async function callReducerStrict(reducer: string, args: unknown[]): Promise<void> {
  const ran = await callWithEnrollmentRetry(reducer, args);
  if (!ran) {
    throw new StackAssertionError(
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
    const preview = (await res.text()).slice(0, 200);
    throw spacetimeDbError("SQL query failed", res.status, preview);
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
