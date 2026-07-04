// All traffic uses the
// SpacetimeDB HTTP API (POST /v1/identity, /v1/database/{db}/call/{reducer},
// /v1/database/{db}/sql) — avoids pulling the `spacetimedb` client SDK into
// the e2e package just for a handful of subscriptions.
//
// Auth model: the internal tool is the OIDC issuer for SpacetimeDB tokens —
// it serves the discovery document + JWKS and mints tokens for signed-in
// Stack Auth users. The module authorizes on issuer + audience alone. These
// tests sign member tokens directly with the committed dev keypair (same key
// the internal tool + backend use in dev), which exercises the module's
// validation path without requiring the internal tool server for minting.
// `mintIdentity` returns a SpacetimeDB-native anonymous identity — a valid
// bearer with no trusted-issuer claims, i.e. the "authenticated but
// unauthorized stranger" fixture.

import * as jose from "jose";

export type MintedIdentity = {
  token: string,
  identity: string,
};

// Matches apps/internal-tool/.env.development / apps/backend/.env.development
// (dev-only key, not a real secret).
const DEV_SIGNING_JWK = '{"kty":"EC","x":"UP1DI7fDTcHnwNnK9YWHQ42e_xG0OJVrNFV1LTn5Ois","y":"ovxYo-7g0YxkIidCKNEhbE9-h3tJyu5GD0_5ef0xzyQ","crv":"P-256","d":"HcjJ5KOLEPjr1FBWHDBhBoXRJ3nhNKR1oG9HhsRehow","kid":"spacetimedb-dev-1","alg":"ES256"}';

function tokenIssuer(): string {
  const prefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";
  return (process.env.STACK_SPACETIMEDB_TOKEN_ISSUER ?? `http://localhost:${prefix}41`).replace(/\/+$/, "");
}

/**
 * Signs a SpacetimeDB member token exactly like the internal tool's mint
 * endpoint does. Each call gets a fresh random subject (a distinct "user").
 */
export async function signMemberToken(subject?: string): Promise<string> {
  const jwk = JSON.parse(process.env.STACK_SPACETIMEDB_SIGNING_KEY_JWK ?? DEV_SIGNING_JWK) as jose.JWK & { kid?: string };
  const key = await jose.importJWK(jwk, "ES256");
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer(tokenIssuer())
    .setAudience(process.env.STACK_SPACETIMEDB_EXPECTED_AUDIENCE ?? "spacetimedb")
    .setSubject(subject ?? `e2e-user-${crypto.randomUUID()}`)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

type SqlRow = Record<string, unknown>;

export type SpacetimedbConfig = {
  baseUrl: string,
  dbName: string,
};

export function getSpacetimedbConfig(): SpacetimedbConfig {
  return {
    baseUrl: process.env.STACK_SPACETIMEDB_URL ?? "",
    dbName: process.env.STACK_SPACETIMEDB_DB_NAME ?? "hexclave-ai-analytics",
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
  const identity = body.identity.startsWith("0x") ? body.identity.slice(2) : body.identity;
  return { token: body.token, identity };
}

/**
 * SpacetimeDB encodes `.optional()` fields as a tagged sum type — clients must
 * send `{ some: value }` or `{ none: [] }`, not raw null. Mirrors the `opt()`
 * helper in apps/backend/src/lib/ai/spacetimedb-client.ts.
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

/**
 * The `my_visible_*` views gate on a `sessions` row for the caller's identity.
 * WebSocket clients get one automatically via `clientConnected`; HTTP callers
 * (like these tests) must call the self-enrolling `touch_session` reducer
 * first. Derives everything from the caller's own validated JWT.
 */
export async function touchSession(token: string): Promise<ReducerCallResult> {
  return await callReducer(token, "touch_session", []);
}

export type SqlQueryResult = {
  columns: string[],
  rows: SqlRow[],
};

/**
 * Look up the `correlationId` of a freshly-inserted row by its unique `question`.
 * Caller must pass a reviewer access token with a touched session — only they
 * can read `my_visible_mcp_call_log`. Returns undefined if no match is found.
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
 * Look up the qa_entries primary key (qaId, a u64 bigint) for a row whose
 * `sourceMcpCorrelationId` matches the given correlationId. Returns undefined
 * if no qa_entries row exists yet (the call hasn't been curated).
 */
/**
 * Decodes an optional (sum-type) column from a /sql JSON result. SpacetimeDB
 * encodes them as `[tagIndex, payload]` arrays (`[0, value]` = some,
 * `[1, []]` = none); object (`{some: ...}`) and raw encodings are accepted
 * too for robustness across versions.
 */
export function decodeOptional<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value[0] === 0 ? value[1] as T : undefined;
  }
  if (typeof value === "object") {
    if ("some" in value) return (value as { some: T }).some;
    if ("none" in value) return undefined;
  }
  return value as T;
}

export async function findQaEntryIdBySource(
  token: string,
  correlationId: string,
): Promise<bigint | undefined> {
  const { rows } = await sqlQuery(token, "SELECT * FROM my_visible_qa_entries");
  const match = rows.find(r => {
    const src = decodeOptional<string>(r.source_mcp_correlation_id ?? r.sourceMcpCorrelationId);
    return src === correlationId;
  });
  if (!match) return undefined;
  return coerceBigInt(match.id);
}

/**
 * Look up a manually-added qa_entries row (sourceMcpCorrelationId is none) by
 * its question text. Used by test cleanup to find rows inserted by add_manual_qa.
 */
export async function findManualQaEntryIdByQuestion(
  token: string,
  question: string,
): Promise<bigint | undefined> {
  const { rows } = await sqlQuery(token, "SELECT * FROM my_visible_qa_entries");
  const match = rows.find(r => {
    if (r.question !== question) return false;
    return decodeOptional<string>(r.source_mcp_correlation_id ?? r.sourceMcpCorrelationId) === undefined;
  });
  if (!match) return undefined;
  return coerceBigInt(match.id);
}

function coerceBigInt(raw: unknown): bigint | undefined {
  if (typeof raw === "string") return BigInt(raw);
  if (typeof raw === "number") return BigInt(raw);
  if (typeof raw === "bigint") return raw;
  return undefined;
}
/**
 * Per-test collector for anything these tests drop into SpacetimeDB so
 * `afterEach` can wipe it. Without this, each CI run would accumulate stale
 * mcp_call_log, ai_query_log, and qa_entries rows against the shared scratch
 * DB.
 *
 * Deletions run with a caller-supplied privileged token (a user holding both
 * `ai_chat_reviewer` and `ai_log_writer`, minted lazily by the caller-provided
 * factory). MCP call log rows are looked up by their `question` marker —
 * callers should pass a unique marker (`Date.now() + random` is enough).
 * Cleanup is best-effort: individual failures are swallowed so one bad row
 * doesn't leave the rest behind.
 */
export type CleanupScope = {
  trackMcpQuestion: (question: string) => void,
  trackAiQueryCorrelationId: (correlationId: string) => void,
  cleanup: () => Promise<void>,
};

export function createCleanupScope(getCleanupToken: () => Promise<string> = signMemberToken): CleanupScope {
  const questions = new Set<string>();
  const aiQueryCorrelationIds = new Set<string>();

  return {
    trackMcpQuestion: (question) => { questions.add(question); },
    trackAiQueryCorrelationId: (correlationId) => { aiQueryCorrelationIds.add(correlationId); },
    async cleanup() {
      if (questions.size === 0 && aiQueryCorrelationIds.size === 0) return;
      const token = await getCleanupToken().catch(() => null);
      if (token == null) {
        questions.clear();
        aiQueryCorrelationIds.clear();
        return;
      }

      try {
        await touchSession(token).catch(() => undefined);

        for (const question of questions) {
          const cid = await findCorrelationIdByQuestion(token, question).catch(() => undefined);
          if (cid) {
            const qaId = await findQaEntryIdBySource(token, cid).catch(() => undefined);
            if (qaId != null) {
              await callReducer(token, "delete_qa_entry", [qaId]).catch(() => undefined);
            }
            await callReducer(token, "delete_mcp_call_log", [cid]).catch(() => undefined);
          }
          const manualQaId = await findManualQaEntryIdByQuestion(token, question).catch(() => undefined);
          if (manualQaId != null) {
            await callReducer(token, "delete_qa_entry", [manualQaId]).catch(() => undefined);
          }
        }

        for (const correlationId of aiQueryCorrelationIds) {
          await callReducer(token, "delete_ai_query_log", [correlationId]).catch(() => undefined);
        }
      } finally {
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
