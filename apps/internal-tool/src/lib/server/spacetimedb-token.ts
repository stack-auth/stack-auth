import "server-only";

import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import * as jose from "jose";

// The internal tool is its own OIDC issuer for SpacetimeDB: it serves
// /.well-known/openid-configuration + a JWKS under its own origin, and mints
// short-lived ES256 JWTs for callers whose Stack Auth session it has verified.
// (Stack Auth itself doesn't expose an OIDC discovery document, so its access
// tokens can't be validated by SpacetimeDB directly; this shim can be deleted
// if that ever ships — see the module's ALLOWED_ISSUERS.)

// Matches the ~10min lifetime of Stack Auth access tokens; the frontend
// reconnects with a fresh token every 8 minutes.
const USER_TOKEN_TTL = "10m";

export function spacetimeTokenIssuer(): string {
  const issuer = getEnvVariable("STACK_SPACETIMEDB_TOKEN_ISSUER", "").trim().replace(/\/+$/, "");
  if (issuer === "") {
    throw new HexclaveAssertionError("STACK_SPACETIMEDB_TOKEN_ISSUER is not configured for the internal tool.");
  }
  return issuer;
}

export function spacetimeTokenAudience(): string {
  return getEnvVariable("STACK_SPACETIMEDB_EXPECTED_AUDIENCE", "spacetimedb");
}

function privateJwk(): jose.JWK & { kid?: string, alg?: string } {
  const raw = getEnvVariable("STACK_SPACETIMEDB_SIGNING_KEY_JWK", "");
  if (raw.trim() === "") {
    throw new HexclaveAssertionError("STACK_SPACETIMEDB_SIGNING_KEY_JWK is not configured for the internal tool.");
  }
  return JSON.parse(raw) as jose.JWK;
}

export async function signSpacetimeToken(options: { subject: string, expiresIn?: string, name?: string }): Promise<string> {
  const jwk = privateJwk();
  const key = await jose.importJWK(jwk, "ES256");
  // `name` is a server-attested display label for reducer attribution: the
  // module stamps it into humanReviewedBy/createdBy/lastEditedBy instead of
  // trusting a client-supplied reducer arg (which any member could forge). It
  // is only included after the caller's Stack Auth session has been verified.
  const claims: jose.JWTPayload = {};
  if (options.name != null && options.name !== "") {
    claims.name = options.name;
  }
  return await new jose.SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer(spacetimeTokenIssuer())
    .setAudience(spacetimeTokenAudience())
    .setSubject(options.subject)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? USER_TOKEN_TTL)
    .sign(key);
}

/** The public half of the signing key, served by the JWKS route. */
export function publicJwks(): { keys: jose.JWK[] } {
  const { d: _privateScalar, ...publicJwk } = privateJwk();
  return { keys: [publicJwk] };
}

// Service identity used for this app's own server-side writes (telemetry
// ingested from the backend, retry-review, ...). Reserved `__*__` shape
// distinguishes it from real users in session rows.
const SERVICE_TOKEN_SUBJECT = "__spacetimedb_service__";
const SERVICE_TOKEN_TTL_MILLIS = 60 * 60 * 1000;
const SERVICE_TOKEN_REFRESH_MARGIN_MILLIS = 5 * 60 * 1000;

let cachedServiceToken: { token: string, expiresAtMillis: number } | null = null;

export async function getServiceSpacetimeToken(): Promise<string> {
  if (cachedServiceToken && Date.now() < cachedServiceToken.expiresAtMillis - SERVICE_TOKEN_REFRESH_MARGIN_MILLIS) {
    return cachedServiceToken.token;
  }
  const token = await signSpacetimeToken({
    subject: SERVICE_TOKEN_SUBJECT,
    expiresIn: `${SERVICE_TOKEN_TTL_MILLIS / 1000}s`,
  });
  cachedServiceToken = { token, expiresAtMillis: Date.now() + SERVICE_TOKEN_TTL_MILLIS };
  return token;
}
