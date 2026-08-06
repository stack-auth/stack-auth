import { Tenancy } from "@/lib/tenancies";
import { safeOAuthFetch } from "@/lib/ssrf-protection/oauth";
import { KnownErrors } from "@hexclave/shared";
import { externalAuthProviderIds, type ExternalAuthProviderId } from "@hexclave/shared/dist/interface/external-auth";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { createRemoteJWKSet, customFetch, decodeJwt, decodeProtectedHeader, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";

export { externalAuthProviderIds };
export type { ExternalAuthProviderId };

export type VerifiedExternalIdentity = {
  issuer: string,
  subject: string,
  providerSessionId: string,
  expiresAt: Date,
};

type ProviderVerificationConfig = {
  issuer: string,
  jwksUrl: string,
  audience?: string,
  authorizedParties?: string[],
  clientId?: string,
};

const remoteJwkSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const MAX_CACHED_REMOTE_JWK_SETS = 100;

function getRemoteJwkSet(jwksUrl: string) {
  const existing = remoteJwkSets.get(jwksUrl);
  if (existing != null) {
    remoteJwkSets.delete(jwksUrl);
    remoteJwkSets.set(jwksUrl, existing);
    return existing;
  }
  const created = createRemoteJWKSet(new URL(jwksUrl), {
    [customFetch]: safeOAuthFetch,
  });
  remoteJwkSets.set(jwksUrl, created);
  if (remoteJwkSets.size > MAX_CACHED_REMOTE_JWK_SETS) {
    const leastRecentlyUsedUrl = remoteJwkSets.keys().next().value;
    if (leastRecentlyUsedUrl != null) {
      remoteJwkSets.delete(leastRecentlyUsedUrl);
    }
  }
  return created;
}

function requireConfigured(value: string | undefined): string {
  if (value == null || value.length === 0) {
    throw new KnownErrors.ExternalAuthProviderNotConfigured();
  }
  return value;
}

function getAuthorizedParties(value: string | undefined): string[] {
  const parties = requireConfigured(value)
    .split(/[\n,]/)
    .map(party => party.trim())
    .filter(party => party.length > 0);
  if (parties.length === 0) {
    throw new KnownErrors.ExternalAuthProviderNotConfigured();
  }
  return parties.map(party => {
    try {
      // Clerk's azp claim contains the requesting origin, so normalize the configured entries to
      // their origin — otherwise a cosmetic difference like a trailing slash in the dashboard
      // config would reject every token.
      return new URL(party).origin;
    } catch {
      throw new KnownErrors.ExternalAuthProviderNotConfigured();
    }
  });
}

function getProviderVerificationConfig(
  tenancy: Tenancy,
  providerId: ExternalAuthProviderId,
): ProviderVerificationConfig {
  if (tenancy.config.apps.installed[providerId]?.enabled !== true) {
    throw new KnownErrors.ExternalAuthProviderNotConfigured();
  }

  switch (providerId) {
    case "clerk-integration": {
      const config = tenancy.config["clerk-integration"];
      const issuer = requireConfigured(config.issuer);
      return {
        issuer,
        jwksUrl: new URL("/.well-known/jwks.json", issuer).toString(),
        authorizedParties: getAuthorizedParties(config.authorizedParties),
      };
    }
    case "better-auth-integration": {
      const config = tenancy.config["better-auth-integration"];
      return {
        issuer: requireConfigured(config.issuer),
        audience: requireConfigured(config.audience),
        jwksUrl: requireConfigured(config.jwksUrl),
      };
    }
    case "workos-integration": {
      const config = tenancy.config["workos-integration"];
      const clientId = requireConfigured(config.clientId);
      return {
        issuer: requireConfigured(config.issuer),
        clientId,
        jwksUrl: `https://api.workos.com/sso/jwks/${encodeURIComponent(clientId)}`,
      };
    }
  }
}

function getRequiredClaim(payload: JWTPayload, claim: "sub" | "sid"): string {
  const value = payload[claim];
  if (typeof value !== "string" || value.length === 0) {
    throw new KnownErrors.InvalidExternalAuthToken();
  }
  return value;
}

function validateTokenEncoding(token: string): void {
  if (token.length > 16_384 || token.split(".").length !== 3) {
    throw new KnownErrors.InvalidExternalAuthToken();
  }
  try {
    decodeProtectedHeader(token);
    decodeJwt(token);
  } catch {
    throw new KnownErrors.InvalidExternalAuthToken();
  }
}

function isInvalidTokenError(error: unknown): boolean {
  return error instanceof joseErrors.JWTClaimValidationFailed
    || error instanceof joseErrors.JWTExpired
    || error instanceof joseErrors.JWTInvalid
    || error instanceof joseErrors.JOSENotSupported
    || error instanceof joseErrors.JWSInvalid
    || error instanceof joseErrors.JWSSignatureVerificationFailed
    || error instanceof joseErrors.JWKSNoMatchingKey;
}

export async function verifyExternalAuthToken(options: {
  tenancy: Tenancy,
  providerId: ExternalAuthProviderId,
  token: string,
}): Promise<VerifiedExternalIdentity> {
  const config = getProviderVerificationConfig(options.tenancy, options.providerId);
  validateTokenEncoding(options.token);

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(options.token, getRemoteJwkSet(config.jwksUrl), {
      issuer: config.issuer,
      ...config.audience == null ? {} : { audience: config.audience },
    });
    payload = verified.payload;
  } catch (error) {
    if (isInvalidTokenError(error)) {
      throw new KnownErrors.InvalidExternalAuthToken();
    }
    throw new HexclaveAssertionError("Failed to retrieve or process an external authentication provider's signing keys.", {
      cause: error,
      providerId: options.providerId,
    });
  }

  if (config.authorizedParties != null) {
    const authorizedParty = payload.azp;
    // Treat absence as a validation failure: otherwise a token without azp bypasses the configured
    // allowlist and loses the subdomain-cookie-leak protection that authorizedParties is meant to add.
    if (typeof authorizedParty !== "string" || !config.authorizedParties.includes(authorizedParty)) {
      throw new KnownErrors.InvalidExternalAuthToken();
    }
  }
  if (config.clientId != null && payload.client_id !== config.clientId) {
    throw new KnownErrors.InvalidExternalAuthToken();
  }

  const subject = getRequiredClaim(payload, "sub");
  const providerSessionId = getRequiredClaim(payload, "sid");
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new KnownErrors.InvalidExternalAuthToken();
  }

  return {
    issuer: config.issuer,
    subject,
    providerSessionId,
    expiresAt: new Date(payload.exp * 1000),
  };
}
