import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OidcJwtValidationError, _clearOidcDiscoveryCacheForTests, validateOidcJwt } from "./oidc-jwt";

/**
 * These tests generate a real RSA keypair per test, sign tokens with it, and mock `fetch` to
 * serve an OIDC discovery document + JWKS backed by that key. This exercises the real `jose`
 * verification path without requiring a live IdP.
 */

async function setupMockIdp(options: { issuerUrl: string, kid?: string }) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: options.kid ?? "test-key", alg: "RS256", use: "sig" };
  return { privateKey, jwk };
}

function installFetchMock(setup: {
  issuerUrl: string,
  /** The issuer declared in the discovery doc (defaults to `issuerUrl`). */
  advertisedIssuer?: string,
  jwks: JWK[],
}) {
  const discoveryUrl = `${setup.issuerUrl}/.well-known/openid-configuration`;
  const jwksUrl = `${setup.issuerUrl}/jwks`;
  const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === discoveryUrl) {
      return new Response(
        JSON.stringify({ issuer: setup.advertisedIssuer ?? setup.issuerUrl, jwks_uri: jwksUrl }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === jwksUrl) {
      return new Response(JSON.stringify({ keys: setup.jwks }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mintTestToken(privateKey: CryptoKey, payload: Record<string, unknown>, options: {
  issuer: string,
  audience: string | string[],
  kid?: string,
  expiresIn?: string,
  notBefore?: number,
}) {
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "test-key" })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setIssuedAt();
  if (options.expiresIn !== undefined) jwt.setExpirationTime(options.expiresIn);
  if (options.notBefore !== undefined) jwt.setNotBefore(options.notBefore);
  return await jwt.sign(privateKey);
}

const issuerUrl = "https://test-idp.example.com";

describe("validateOidcJwt", () => {
  beforeEach(() => {
    _clearOidcDiscoveryCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates a well-formed token signed by the advertised JWKS", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    installFetchMock({ issuerUrl, jwks: [jwk] });
    const token = await mintTestToken(privateKey, { sub: "workload-1", environment: "production" }, {
      issuer: issuerUrl,
      audience: "stack-auth",
      expiresIn: "5m",
    });

    const result = await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token });
    expect(result.subject).toBe("workload-1");
    expect(result.issuer).toBe(issuerUrl);
    expect(result.audience).toBe("stack-auth");
    expect(result.claims.environment).toBe("production");
  });

  it("rejects a token with a mismatched audience", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    installFetchMock({ issuerUrl, jwks: [jwk] });
    const token = await mintTestToken(privateKey, { sub: "w" }, {
      issuer: issuerUrl,
      audience: "wrong-audience",
      expiresIn: "5m",
    });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token })).rejects.toBeInstanceOf(OidcJwtValidationError);
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    installFetchMock({ issuerUrl, jwks: [jwk] });
    const token = await mintTestToken(privateKey, { sub: "w" }, {
      issuer: issuerUrl,
      audience: "stack-auth",
      expiresIn: "-10m",
    });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token })).rejects.toMatchObject({ reason: "token expired" });
  });

  it("rejects a token whose signature doesn't match the JWKS", async () => {
    const { privateKey } = await setupMockIdp({ issuerUrl });
    // Advertise a DIFFERENT key than the one used to sign.
    const { jwk: differentJwk } = await setupMockIdp({ issuerUrl, kid: "test-key" });
    installFetchMock({ issuerUrl, jwks: [differentJwk] });
    const token = await mintTestToken(privateKey, { sub: "w" }, {
      issuer: issuerUrl,
      audience: "stack-auth",
      expiresIn: "5m",
    });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token })).rejects.toBeInstanceOf(OidcJwtValidationError);
  });

  it("fails closed when no audiences are configured", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    installFetchMock({ issuerUrl, jwks: [jwk] });
    const token = await mintTestToken(privateKey, { sub: "w" }, {
      issuer: issuerUrl,
      audience: "stack-auth",
      expiresIn: "5m",
    });
    await expect(validateOidcJwt({ issuerUrl, audiences: [], token })).rejects.toMatchObject({ reason: "trust policy has no configured audiences" });
  });

  it("rejects a structurally-invalid token before hitting the network", async () => {
    const fetchMock = installFetchMock({ issuerUrl, jwks: [] });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: "not.a.jwt" })).rejects.toBeInstanceOf(OidcJwtValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects nbf (not-before) with clock-skew tolerance", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    installFetchMock({ issuerUrl, jwks: [jwk] });
    // nbf 10 minutes in the future — well beyond our 60s skew.
    const token = await mintTestToken(privateKey, { sub: "w" }, {
      issuer: issuerUrl,
      audience: "stack-auth",
      expiresIn: "30m",
      notBefore: Math.floor(Date.now() / 1000) + 600,
    });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token })).rejects.toBeInstanceOf(OidcJwtValidationError);
  });

  it("rejects a discovery document whose advertised issuer mismatches the configured issuer URL", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    installFetchMock({
      issuerUrl,
      advertisedIssuer: "https://issuer-from-discovery.example.com",
      jwks: [jwk],
    });
    const token = await mintTestToken(privateKey, { sub: "workload-1" }, {
      issuer: "https://issuer-from-discovery.example.com",
      audience: "stack-auth",
      expiresIn: "5m",
    });

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token })).rejects.toMatchObject({
      reason: "issuer discovery failed",
    });
  });
});
