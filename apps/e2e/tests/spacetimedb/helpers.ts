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
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    const isNetwork = err instanceof TypeError;
    if (isAbort || isNetwork) return false;
    throw err;
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

/**
 * Per-test collector for anything these tests drop into SpacetimeDB so
 * `afterEach` can wipe it. Without this, each CI run would accumulate
 * stale operators, mcp_call_log rows, and ai_query_log rows against the
 * shared scratch DB.
 *
 * Deletions use the log token (skip if unavailable). MCP call log rows are
 * looked up by their `question` marker — callers should pass a unique marker
 * (`Date.now() + random` is enough). Cleanup is best-effort: individual
 * failures are swallowed so one bad row doesn't leave the rest behind.
 */
export type CleanupScope = {
  trackIdentity: (identity: string) => void,
  trackMcpQuestion: (question: string) => void,
  trackAiQueryCorrelationId: (correlationId: string) => void,
  cleanup: () => Promise<void>,
};

export function createCleanupScope(): CleanupScope {
  const identities = new Set<string>();
  const questions = new Set<string>();
  const aiQueryCorrelationIds = new Set<string>();

  return {
    trackIdentity: (identity) => { identities.add(identity); },
    trackMcpQuestion: (question) => { questions.add(question); },
    trackAiQueryCorrelationId: (correlationId) => { aiQueryCorrelationIds.add(correlationId); },
    async cleanup() {
      const { logToken } = getSpacetimedbConfig();
      if (!logToken) {
        // Without the log token we can't call any deletion reducer. Leaving
        // state is fine here — the tests that actually write data skip in
        // the same configuration.
        identities.clear();
        questions.clear();
        aiQueryCorrelationIds.clear();
        return;
      }

      // Enroll a throwaway operator so findCorrelationIdByQuestion (which
      // reads my_visible_mcp_call_log) returns rows we can match on.
      const caller = await mintIdentity().catch(() => null);
      if (caller == null) return;

      try {
        await callReducer(caller.token, "add_operator", [
          logToken,
          [`0x${caller.identity}`],
          `__cleanup__-${caller.identity}`,
          "Cleanup Scope",
        ]).catch(() => undefined);

        for (const question of questions) {
          const cid = await findCorrelationIdByQuestion(caller.token, question).catch(() => undefined);
          if (cid) {
            await callReducer(caller.token, "delete_qa_entry", [logToken, cid]).catch(() => undefined);
          }
        }

        for (const correlationId of aiQueryCorrelationIds) {
          await callReducer(caller.token, "delete_ai_query_log", [logToken, correlationId]).catch(() => undefined);
        }

        for (const identity of identities) {
          await callReducer(caller.token, "remove_operator", [logToken, [`0x${identity}`]]).catch(() => undefined);
        }
      } finally {
        await callReducer(caller.token, "remove_operator", [logToken, [`0x${caller.identity}`]]).catch(() => undefined);
        identities.clear();
        questions.clear();
        aiQueryCorrelationIds.clear();
      }
    },
  };
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
