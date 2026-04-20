// All traffic uses the
// SpacetimeDB HTTP API (POST /v1/identity, /v1/database/{db}/call/{reducer},
// /v1/database/{db}/sql) — avoids pulling the `spacetimedb` client SDK into
// the e2e package just for a handful of subscriptions.

export type MintedIdentity = {
  token: string,
  /** 64-hex identity string, without the "0x" prefix the WS SDK sometimes prints. */
  identity: string,
};

type SqlRow = Record<string, unknown>;

export type SpacetimedbConfig = {
  baseUrl: string,
  dbName: string,
  logToken: string | null,
};

export function getSpacetimedbConfig(): SpacetimedbConfig {
  return {
    baseUrl: process.env.STACK_SPACETIMEDB_URL ?? "",
    dbName: process.env.STACK_SPACETIMEDB_DB_NAME ?? "stack-auth-llm",
    logToken: process.env.STACK_MCP_LOG_TOKEN ?? null,
  };
}

export async function isSpacetimedbReachable(): Promise<boolean> {
  const { baseUrl } = getSpacetimedbConfig();
  if (!baseUrl) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${baseUrl}/v1/identity`, {
      method: "POST",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function mintIdentity(): Promise<MintedIdentity> {
  const { baseUrl } = getSpacetimedbConfig();
  const res = await fetch(`${baseUrl}/v1/identity`, { method: "POST" });
  if (!res.ok) throw new Error(`mintIdentity failed: HTTP ${res.status}`);
  const body = await res.json() as { token: string, identity: string };
  // SpacetimeDB sometimes returns the identity with a leading "0x"; normalize it off.
  const identity = body.identity.startsWith("0x") ? body.identity.slice(2) : body.identity;
  return { token: body.token, identity };
}

/**
 * SpacetimeDB encodes `.optional()` fields as a tagged sum type — clients must
 * send `{ some: value }` or `{ none: [] }`, not raw null. Mirrors the `opt()`
 * helper in apps/backend/src/lib/ai/mcp-logger.ts:87.
 */
export function opt<T>(value: T | null | undefined): { some: T } | { none: [] } {
  return value == null ? { none: [] } : { some: value };
}

export type ReducerCallResult = {
  status: number,
  ok: boolean,
  body: string,
};

export async function callReducer(
  token: string,
  reducer: string,
  args: unknown[],
): Promise<ReducerCallResult> {
  const { baseUrl, dbName } = getSpacetimedbConfig();
  const res = await fetch(`${baseUrl}/v1/database/${encodeURIComponent(dbName)}/call/${encodeURIComponent(reducer)}`, {
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
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

export type SqlQueryResult = {
  columns: string[],
  rows: SqlRow[],
};

/**
 * Look up the `correlationId` of a freshly-inserted row by its unique `question`.
 * Caller must pass a SpacetimeDB token for an enrolled operator — only they can
 * read `my_visible_mcp_call_log`. Returns undefined if no match is found.
 */
export async function findCorrelationIdByQuestion(
  token: string,
  question: string,
): Promise<string | undefined> {
  const { rows } = await sqlQuery(token, "SELECT * FROM my_visible_mcp_call_log");
  const match = rows.find(r => r.question === question);
  if (!match) return undefined;
  const raw = match.correlation_id ?? match.correlationId;
  return typeof raw === "string" ? raw : undefined;
}

export async function sqlQuery(token: string, sql: string): Promise<SqlQueryResult> {
  const { baseUrl, dbName } = getSpacetimedbConfig();
  const res = await fetch(`${baseUrl}/v1/database/${encodeURIComponent(dbName)}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Authorization": `Bearer ${token}`,
    },
    body: sql,
  });
  if (!res.ok) {
    throw new Error(`SQL ${JSON.stringify(sql)} failed: HTTP ${res.status} ${await res.text()}`);
  }
  const payload = await res.json() as Array<{
    schema: { elements: Array<{ name: { some: string } | { none: null } }> },
    rows: unknown[][],
  }>;
  // `/sql` returns an array of query results (one per statement). We only send one.
  if (payload.length === 0) return { columns: [], rows: [] };
  const first = payload[0];
  const columns = first.schema.elements.map(el => "some" in el.name ? el.name.some : "");
  const rows: SqlRow[] = first.rows.map(tuple => {
    const obj: SqlRow = {};
    columns.forEach((c, i) => {
      obj[c] = tuple[i];
    });
    return obj;
  });
  return { columns, rows };
}
