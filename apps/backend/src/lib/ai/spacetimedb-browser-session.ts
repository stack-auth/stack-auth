import { callReducerStrict } from "@/lib/ai/spacetimedb-client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";

const SPACETIMEDB_FETCH_TIMEOUT_MS = 10_000;

export type SpacetimeBrowserSession = {
  host: string,
  dbName: string,
  identity: string,
  token: string,
  scopeKey: string,
};

export type CachedSpacetimeBrowserSession = Omit<SpacetimeBrowserSession, "token">;

function readStringProperty(value: unknown, property: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" ? propertyValue : null;
}

export function normalizeSpacetimeIdentity(identity: string): string {
  const normalized = identity.startsWith("0x") ? identity.slice(2) : identity;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new StatusError(StatusError.BadRequest, "Invalid SpacetimeDB identity.");
  }
  return normalized.toLowerCase();
}

function identityFromToken(token: string): string {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new HexclaveAssertionError("SpacetimeDB returned an invalid identity token");
  }
  const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  const identity = readStringProperty(payload, "hex_identity");
  if (identity == null) {
    throw new HexclaveAssertionError("SpacetimeDB identity token did not include hex_identity");
  }
  return normalizeSpacetimeIdentity(identity);
}

function spacetimeHttpBase(): string {
  const base = getEnvVariable("STACK_SPACETIMEDB_URL", "");
  if (!base) {
    throw new HexclaveAssertionError("STACK_SPACETIMEDB_URL is not configured");
  }
  return base;
}

function spacetimeWsHost(base: string): string {
  const url = new URL(base);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new HexclaveAssertionError(`Unsupported SpacetimeDB URL protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/$/, "");
}

function browserSessionScopeKey(host: string, dbName: string, stackUserId: string): string {
  return `spacetimedb:${host}:${dbName}:${stackUserId}:browser_session`;
}

function operatorStackUserId(stackUserId: string): string {
  // The module reserves __*__ values for synthetic identities like
  // __service__. Local auth fixtures can also use that shape, so namespace the
  // real Hexclave user id before storing it in SpacetimeDB.
  return `hexclave-user:${stackUserId}`;
}

async function addOperator(token: string, identity: string, stackUserId: string, displayName: string): Promise<void> {
  const storedStackUserId = operatorStackUserId(stackUserId);
  try {
    await callReducerStrict("add_operator", [
      token,
      [`0x${identity}`],
      storedStackUserId,
      displayName,
    ]);
  } catch (err) {
    if (!(err instanceof StatusError) || err.statusCode !== StatusError.BadGateway.statusCode) {
      throw err;
    }
    throw new StatusError(
      StatusError.BadGateway,
      `SpacetimeDB add_operator failed for identity ${identity.slice(0, 8)}... ` +
      `with reservedUserId=${/^__.*__$/.test(storedStackUserId)}: ${err.message}`,
    );
  }
}

export async function enrollSpacetimeBrowserIdentity(
  identity: string,
  stackUserId: string,
  displayName: string,
): Promise<void> {
  const token = getEnvVariable("STACK_MCP_LOG_TOKEN");
  const normalizedIdentity = normalizeSpacetimeIdentity(identity);
  try {
    await addOperator(token, normalizedIdentity, stackUserId, displayName);
  } catch (err) {
    if (!(err instanceof StatusError) || err.statusCode !== StatusError.BadGateway.statusCode) {
      throw err;
    }
    // Local development can keep a browser SpacetimeDB identity across Hexclave
    // user resets. The backend is the trust boundary here, so it can clear the
    // stale binding and re-enroll the same websocket identity for this user.
    await callReducerStrict("remove_operator", [
      token,
      [`0x${normalizedIdentity}`],
    ]);
    await addOperator(token, normalizedIdentity, stackUserId, displayName);
  }
}

export function makeCachedSpacetimeBrowserSession(identity: string, stackUserId: string): CachedSpacetimeBrowserSession {
  const base = spacetimeHttpBase();
  const host = spacetimeWsHost(base);
  const dbName = getEnvVariable("STACK_SPACETIMEDB_DB_NAME");
  return {
    host,
    dbName,
    identity: normalizeSpacetimeIdentity(identity),
    scopeKey: browserSessionScopeKey(host, dbName, stackUserId),
  };
}

export async function mintSpacetimeBrowserSession(stackUserId: string): Promise<SpacetimeBrowserSession> {
  const base = spacetimeHttpBase();
  const res = await fetch(`${base}/v1/identity`, {
    method: "POST",
    signal: AbortSignal.timeout(SPACETIMEDB_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const preview = (await res.text()).slice(0, 200);
    throw new StatusError(StatusError.BadGateway, `SpacetimeDB identity mint failed (upstream ${res.status}): ${preview}`);
  }

  const body: unknown = await res.json();
  const token = readStringProperty(body, "token");
  if (token == null || token.trim() === "") {
    throw new HexclaveAssertionError("SpacetimeDB /v1/identity returned no usable token");
  }
  const identity = normalizeSpacetimeIdentity(
    readStringProperty(body, "identity") ??
    readStringProperty(body, "hex_identity") ??
    identityFromToken(token),
  );
  const enrollment = makeCachedSpacetimeBrowserSession(identity, stackUserId);
  return {
    ...enrollment,
    token,
  };
}
