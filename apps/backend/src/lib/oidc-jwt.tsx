import { StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";

type DiscoveryDoc = {
  issuer: string,
  jwks_uri: string,
};

type DiscoveryCacheEntry =
  | { kind: "ok", doc: DiscoveryDoc, jwks: ReturnType<typeof createRemoteJWKSet>, expiresAt: number }
  | { kind: "err", error: Error, expiresAt: number };

const DISCOVERY_OK_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_ERR_TTL_MS = 30 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const DISCOVERY_CACHE_MAX_ENTRIES = 1000;

const discoveryCache = new Map<string, DiscoveryCacheEntry>();

function setDiscoveryCache(key: string, entry: DiscoveryCacheEntry): void {
  discoveryCache.delete(key);
  discoveryCache.set(key, entry);
  while (discoveryCache.size > DISCOVERY_CACHE_MAX_ENTRIES) {
    const oldest = discoveryCache.keys().next().value;
    if (oldest === undefined) break;
    discoveryCache.delete(oldest);
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function toAudArray(aud: JWTPayload["aud"]): string[] {
  if (Array.isArray(aud)) return aud;
  if (aud == null) return [];
  return [aud];
}

async function loadDiscovery(issuerUrl: string): Promise<{ doc: DiscoveryDoc, jwks: ReturnType<typeof createRemoteJWKSet> }> {
  const cacheKey = stripTrailingSlash(issuerUrl);
  const now = Date.now();
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    if (cached.kind === "err") throw cached.error;
    return { doc: cached.doc, jwks: cached.jwks };
  }

  const discoveryUrl = `${cacheKey}/.well-known/openid-configuration`;
  let doc: DiscoveryDoc;
  try {
    const response = await fetch(discoveryUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`OIDC discovery fetch failed for ${issuerUrl} (status ${response.status})`);
    }
    const body = await response.json() as Partial<DiscoveryDoc>;
    if (typeof body.issuer !== "string" || typeof body.jwks_uri !== "string") {
      throw new Error(`OIDC discovery response for ${issuerUrl} is missing issuer or jwks_uri`);
    }
    if (stripTrailingSlash(body.issuer) !== cacheKey) {
      throw new Error(`OIDC discovery issuer mismatch for ${issuerUrl}: expected ${cacheKey}, got ${body.issuer}`);
    }
    doc = { issuer: body.issuer, jwks_uri: body.jwks_uri };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    setDiscoveryCache(cacheKey, { kind: "err", error: err, expiresAt: now + DISCOVERY_ERR_TTL_MS });
    throw err;
  }

  const jwks = createRemoteJWKSet(new URL(doc.jwks_uri), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
  });
  setDiscoveryCache(cacheKey, { kind: "ok", doc, jwks, expiresAt: now + DISCOVERY_OK_TTL_MS });
  return { doc, jwks };
}

export class OidcJwtValidationError extends StatusError {
  public override readonly cause?: unknown;
  constructor(public readonly reason: string, options?: { cause?: unknown }) {
    super(401, `OIDC token validation failed: ${reason}`);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export type ValidateOidcJwtOptions = {
  issuerUrl: string,
  audiences: string[],
  token: string,
};

export type ValidatedOidcJwt = {
  claims: JWTPayload,
  issuer: string,
  subject: string,
  audience: string,
};

export async function validateOidcJwt(options: ValidateOidcJwtOptions): Promise<ValidatedOidcJwt> {
  const { issuerUrl, audiences, token } = options;

  if (audiences.length === 0) {
    throw new OidcJwtValidationError("trust policy has no configured audiences");
  }

  try {
    decodeProtectedHeader(token);
  } catch (error) {
    throw new OidcJwtValidationError("token is not a well-formed JWT", { cause: error });
  }

  let discovery: Awaited<ReturnType<typeof loadDiscovery>>;
  try {
    discovery = await loadDiscovery(issuerUrl);
  } catch (error) {
    captureError("oidc-federation-discovery-failed", error);
    throw new OidcJwtValidationError("issuer discovery failed", { cause: error });
  }

  try {
    const { payload } = await jwtVerify(token, discovery.jwks, {
      issuer: discovery.doc.issuer,
      audience: audiences,
      clockTolerance: CLOCK_SKEW_SECONDS,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new OidcJwtValidationError("token is missing `sub` claim");
    }
    const matchedAudience = toAudArray(payload.aud).find(a => audiences.includes(a));
    if (matchedAudience === undefined) {
      throw new OidcJwtValidationError("token audience does not match policy");
    }
    return {
      claims: payload,
      issuer: discovery.doc.issuer,
      subject: payload.sub,
      audience: matchedAudience,
    };
  } catch (error) {
    if (error instanceof OidcJwtValidationError) throw error;
    const code = (error as { code?: unknown }).code;
    const reason =
      code === "ERR_JWT_EXPIRED" ? "token expired"
        : code === "ERR_JWT_CLAIM_VALIDATION_FAILED" ? `claim validation failed: ${(error as { claim?: string }).claim ?? "unknown"}`
          : code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ? "signature verification failed"
            : code === "ERR_JWKS_NO_MATCHING_KEY" ? "no matching JWKS key for token `kid`"
              : "token verification failed";
    throw new OidcJwtValidationError(reason, { cause: error });
  }
}

export function _clearOidcDiscoveryCacheForTests(): void {
  discoveryCache.clear();
}
