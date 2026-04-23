import { Prisma } from "@/generated/prisma/client";
import type { PrismaClientTransaction } from "@/prisma-client";
import { StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JWK, type JWTPayload } from "jose";
import { getOrSetCacheValue } from "./cache";
import { safeFetchJson, validateSafeFetchUrl } from "./safe-fetch";

export type DiscoveryDoc = { issuer: string, jwks_uri: string };
type JwksJson = { keys: JWK[] };

type DiscoveryPayload =
  | { kind: "ok", doc: DiscoveryDoc }
  | { kind: "err", message: string };

const DISCOVERY_OK_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_ERR_TTL_MS = 30 * 1000;
const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const DISCOVERY_NAMESPACE = "oidc-discovery";
const JWKS_NAMESPACE = "oidc-jwks";
const FETCH_TIMEOUT_MS = 5000;

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function toAudArray(aud: JWTPayload["aud"]): string[] {
  if (Array.isArray(aud)) return aud;
  if (aud == null) return [];
  return [aud];
}

async function writeDiscoveryCache(
  prisma: PrismaClientTransaction,
  cacheKey: string,
  payload: DiscoveryPayload,
  ttlMs: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.cacheEntry.upsert({
    where: { namespace_cacheKey: { namespace: DISCOVERY_NAMESPACE, cacheKey } },
    create: { namespace: DISCOVERY_NAMESPACE, cacheKey, payload: payload as unknown as Prisma.InputJsonValue, expiresAt },
    update: { payload: payload as unknown as Prisma.InputJsonValue, expiresAt },
  });
}

async function cacheErrorAndRethrow(
  prisma: PrismaClientTransaction,
  cacheKey: string,
  error: unknown,
): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await writeDiscoveryCache(prisma, cacheKey, { kind: "err", message }, DISCOVERY_ERR_TTL_MS);
  } catch (cacheErr) {
    // Don't let a DB hiccup clobber the real discovery error — surface both.
    captureError("oidc-discovery-cache-write-failed", cacheErr);
  }
  throw error instanceof Error ? error : new Error(message);
}

export async function fetchOidcDiscoveryDocument(issuerUrl: string): Promise<DiscoveryDoc> {
  const cacheKey = stripTrailingSlash(issuerUrl);

  const discovery = await safeFetchJson<Partial<DiscoveryDoc>>(`${cacheKey}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (discovery.kind === "url-error") {
    throw new Error(`OIDC discovery URL rejected for ${issuerUrl}: ${discovery.reason}`);
  }
  if (discovery.kind === "fetch-error") {
    throw new Error(`OIDC discovery fetch failed for ${issuerUrl}: ${discovery.reason}`);
  }
  if (discovery.kind === "http-error") {
    throw new Error(`OIDC discovery fetch failed for ${issuerUrl} (status ${discovery.status})`);
  }

  const body = discovery.body;
  if (typeof body.issuer !== "string" || typeof body.jwks_uri !== "string") {
    throw new Error(`OIDC discovery response for ${issuerUrl} is missing issuer or jwks_uri`);
  }
  if (stripTrailingSlash(body.issuer) !== cacheKey) {
    throw new Error(`OIDC discovery issuer mismatch for ${issuerUrl}: expected ${cacheKey}, got ${body.issuer}`);
  }
  const jwksSafe = await validateSafeFetchUrl(body.jwks_uri);
  if (jwksSafe.kind !== "ok") {
    throw new Error(`OIDC discovery jwks_uri rejected for ${issuerUrl}: ${jwksSafe.reason}`);
  }
  return { issuer: body.issuer, jwks_uri: body.jwks_uri };
}

async function loadDiscovery(issuerUrl: string, prisma: PrismaClientTransaction): Promise<DiscoveryDoc> {
  const cacheKey = stripTrailingSlash(issuerUrl);

  const cached = await prisma.cacheEntry.findUnique({
    where: { namespace_cacheKey: { namespace: DISCOVERY_NAMESPACE, cacheKey } },
  });
  if (cached && cached.expiresAt.getTime() > Date.now()) {
    const payload = cached.payload as unknown as DiscoveryPayload;
    if (payload.kind === "err") throw new Error(payload.message);
    return payload.doc;
  }

  try {
    const doc = await fetchOidcDiscoveryDocument(issuerUrl);
    await writeDiscoveryCache(prisma, cacheKey, { kind: "ok", doc }, DISCOVERY_OK_TTL_MS);
    return doc;
  } catch (error) {
    // URL-validation failures are deterministic per-config; don't poison the error
    // cache with them, or fixing a mistyped issuer URL would still fail for DISCOVERY_ERR_TTL_MS.
    if (error instanceof Error && error.message.startsWith("OIDC discovery URL rejected")) {
      throw error;
    }
    return await cacheErrorAndRethrow(prisma, cacheKey, error);
  }
}

async function fetchJwks(jwksUrl: string): Promise<JwksJson> {
  const jwks = await safeFetchJson<JwksJson>(jwksUrl, {
    headers: { accept: "application/json" },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (jwks.kind === "url-error") {
    throw new Error(`OIDC JWKS URL rejected: ${jwks.reason}`);
  }
  if (jwks.kind === "fetch-error") {
    throw new Error(`OIDC JWKS fetch failed for ${jwksUrl}: ${jwks.reason}`);
  }
  if (jwks.kind === "http-error") {
    throw new Error(`OIDC JWKS fetch failed for ${jwksUrl} (status ${jwks.status})`);
  }
  const body = jwks.body;
  if (!Array.isArray(body.keys)) {
    throw new Error(`OIDC JWKS response for ${jwksUrl} is not a valid JWKS`);
  }
  return body;
}

async function loadJwks(jwksUrl: string, prisma: PrismaClientTransaction): Promise<JwksJson> {
  return await getOrSetCacheValue<JwksJson>({
    namespace: JWKS_NAMESPACE,
    cacheKey: jwksUrl,
    ttlMs: JWKS_TTL_MS,
    prisma,
    loader: () => fetchJwks(jwksUrl),
  });
}

async function invalidateJwks(prisma: PrismaClientTransaction, jwksUrl: string): Promise<void> {
  await prisma.cacheEntry.deleteMany({
    where: { namespace: JWKS_NAMESPACE, cacheKey: jwksUrl },
  });
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
  prisma: PrismaClientTransaction,
};

export type ValidatedOidcJwt = {
  claims: JWTPayload,
  issuer: string,
  subject: string,
  audience: string,
};

function translateVerifyError(error: unknown): OidcJwtValidationError {
  if (error instanceof OidcJwtValidationError) return error;
  const code = (error as { code?: unknown }).code;
  const reason =
    code === "ERR_JWT_EXPIRED" ? "token expired"
      : code === "ERR_JWT_CLAIM_VALIDATION_FAILED" ? `claim validation failed: ${(error as { claim?: string }).claim ?? "unknown"}`
        : code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ? "signature verification failed"
          : code === "ERR_JWKS_NO_MATCHING_KEY" ? "no matching JWKS key for token `kid`"
            : "token verification failed";
  return new OidcJwtValidationError(reason, { cause: error });
}

export async function validateOidcJwt(options: ValidateOidcJwtOptions): Promise<ValidatedOidcJwt> {
  const { issuerUrl, audiences, token, prisma } = options;

  if (audiences.length === 0) {
    throw new OidcJwtValidationError("trust policy has no configured audiences");
  }

  try {
    decodeProtectedHeader(token);
  } catch (error) {
    throw new OidcJwtValidationError("token is not a well-formed JWT", { cause: error });
  }

  let doc: DiscoveryDoc;
  try {
    doc = await loadDiscovery(issuerUrl, prisma);
  } catch (error) {
    captureError("oidc-federation-discovery-failed", error);
    throw new OidcJwtValidationError("issuer discovery failed", { cause: error });
  }

  const verifyOnce = async () => {
    const jwks = await loadJwks(doc.jwks_uri, prisma);
    const keystore = createLocalJWKSet(jwks);
    return await jwtVerify(token, keystore, {
      issuer: doc.issuer,
      audience: audiences,
      clockTolerance: CLOCK_SKEW_SECONDS,
    });
  };

  let verifyResult: Awaited<ReturnType<typeof verifyOnce>>;
  try {
    verifyResult = await verifyOnce();
  } catch (error) {
    // Cached JWKS may be stale after key rotation — invalidate and retry once.
    if ((error as { code?: unknown }).code === "ERR_JWKS_NO_MATCHING_KEY") {
      await invalidateJwks(prisma, doc.jwks_uri);
      try {
        verifyResult = await verifyOnce();
      } catch (retryError) {
        throw translateVerifyError(retryError);
      }
    } else {
      throw translateVerifyError(error);
    }
  }

  const { payload } = verifyResult;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new OidcJwtValidationError("token is missing `sub` claim");
  }
  const matchedAudience = toAudArray(payload.aud).find(a => audiences.includes(a));
  if (matchedAudience === undefined) {
    throw new OidcJwtValidationError("token audience does not match policy");
  }
  return {
    claims: payload,
    issuer: doc.issuer,
    subject: payload.sub,
    audience: matchedAudience,
  };
}
