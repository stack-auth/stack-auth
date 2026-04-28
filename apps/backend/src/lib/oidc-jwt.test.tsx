import type { PrismaClientTransaction } from "@/prisma-client";
import { randomBytes } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OidcJwtValidationError, validateOidcJwt } from "./oidc-jwt";

// `validateSafeFetchUrl` does a real DNS lookup (and fails closed on errors) before
// any fetch; these tests use `test-idp.example.com`, which doesn't resolve. Mock
// dns.lookup to a public IP that passes the blocklist so we exercise the fetch
// path with our `fetchMock` instead of tripping on the DNS check.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  };
});

type CacheRow = { namespace: string, cacheKey: string, payload: unknown, expiresAt: Date };

function createMockPrismaCache(): PrismaClientTransaction {
  const store = new Map<string, CacheRow>();
  const keyOf = (ns: string, k: string) => `${ns}\\0${k}`;
  return {
    cacheEntry: {
      findUnique: async ({ where }: { where: { namespace_cacheKey: { namespace: string, cacheKey: string } } }) => {
        return store.get(keyOf(where.namespace_cacheKey.namespace, where.namespace_cacheKey.cacheKey)) ?? null;
      },
      upsert: async ({ where, create, update }: {
        where: { namespace_cacheKey: { namespace: string, cacheKey: string } },
        create: CacheRow,
        update: Partial<CacheRow>,
      }) => {
        const k = keyOf(where.namespace_cacheKey.namespace, where.namespace_cacheKey.cacheKey);
        const existing = store.get(k);
        if (existing) store.set(k, { ...existing, ...update });
        else store.set(k, { ...create });
        return store.get(k);
      },
      deleteMany: async ({ where }: { where: { namespace: string, cacheKey: string } }) => {
        for (const [k, v] of store.entries()) {
          if (v.namespace === where.namespace && v.cacheKey === where.cacheKey) store.delete(k);
        }
        return { count: 0 };
      },
    },
  } as unknown as PrismaClientTransaction;
}

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
  let prisma: PrismaClientTransaction;
  beforeEach(() => {
    prisma = createMockPrismaCache();
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

    const result = await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma });
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
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    installFetchMock({ issuerUrl, jwks: [jwk] });
    const token = await mintTestToken(privateKey, { sub: "w" }, {
      issuer: issuerUrl,
      audience: "stack-auth",
      expiresIn: "-10m",
    });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toMatchObject({ reason: "token expired" });
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
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
  });

  it("rejects symmetric JWT algorithms even if the JWKS advertises an oct key", async () => {
    const secret = randomBytes(32);
    const jwk: JWK = { kty: "oct", k: secret.toString("base64url"), kid: "symmetric-key", alg: "HS256" };
    installFetchMock({ issuerUrl, jwks: [jwk] });
    const token = await new SignJWT({ sub: "w" })
      .setProtectedHeader({ alg: "HS256", kid: "symmetric-key" })
      .setIssuer(issuerUrl)
      .setAudience("stack-auth")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secret);

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
  });

  it("fails closed when no audiences are configured", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    installFetchMock({ issuerUrl, jwks: [jwk] });
    const token = await mintTestToken(privateKey, { sub: "w" }, {
      issuer: issuerUrl,
      audience: "stack-auth",
      expiresIn: "5m",
    });
    await expect(validateOidcJwt({ issuerUrl, audiences: [], token, prisma })).rejects.toMatchObject({ reason: "trust policy has no configured audiences" });
  });

  it("rejects a structurally-invalid token before hitting the network", async () => {
    const fetchMock = installFetchMock({ issuerUrl, jwks: [] });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: "not.a.jwt", prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
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
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
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

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toMatchObject({
      reason: "issuer discovery failed",
    });
  });

  it("serves discovery + JWKS from cache on the second validation (no new fetches)", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    const fetchMock = installFetchMock({ issuerUrl, jwks: [jwk] });
    const mkToken = () => mintTestToken(privateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m" });

    await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: await mkToken(), prisma });
    const fetchesAfterFirst = fetchMock.mock.calls.length;
    expect(fetchesAfterFirst).toBe(2); // discovery + jwks

    await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: await mkToken(), prisma });
    expect(fetchMock.mock.calls.length).toBe(fetchesAfterFirst); // no extra fetches
  });

  it("caches discovery failures with short TTL to prevent IdP hammering", async () => {
    const { privateKey } = await setupMockIdp({ issuerUrl });
    const token = await mintTestToken(privateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m" });

    const fetchMock = vi.fn(async () =>
      new Response("boom", { status: 500, headers: { "content-type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
    expect(fetchMock.mock.calls.length).toBe(1); // one discovery attempt

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
    expect(fetchMock.mock.calls.length).toBe(1); // negative-cache hit; no retry
  });

  it("caches transient discovery fetch errors instead of treating them as URL rejections", async () => {
    const { privateKey } = await setupMockIdp({ issuerUrl });
    const token = await mintTestToken(privateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m" });

    const fetchMock = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
    expect(fetchMock.mock.calls.length).toBe(1);

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("invalidates JWKS cache and refetches on ERR_JWKS_NO_MATCHING_KEY (key rotation)", async () => {
    const { privateKey: oldPrivateKey, jwk: oldJwk } = await setupMockIdp({ issuerUrl, kid: "old-key" });
    const { privateKey: newPrivateKey, jwk: newJwk } = await setupMockIdp({ issuerUrl, kid: "new-key" });

    let jwksPayload: JWK[] = [oldJwk];
    const discoveryUrl = `${issuerUrl}/.well-known/openid-configuration`;
    const jwksUrl = `${issuerUrl}/jwks`;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === discoveryUrl) {
        return new Response(JSON.stringify({ issuer: issuerUrl, jwks_uri: jwksUrl }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === jwksUrl) {
        return new Response(JSON.stringify({ keys: jwksPayload }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Phase 1: prime caches with the old key.
    const oldToken = await mintTestToken(oldPrivateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m", kid: "old-key" });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: oldToken, prisma })).resolves.toMatchObject({ subject: "w" });
    const jwksFetchesAfterPrime = fetchMock.mock.calls.filter(c => (typeof c[0] === "string" ? c[0] : c[0].toString()) === jwksUrl).length;
    expect(jwksFetchesAfterPrime).toBe(1);

    // Phase 2: IdP rotates to a new key; a token signed with the new key must trigger
    // invalidate-and-refetch because the cached JWKS has only the old kid.
    jwksPayload = [newJwk];
    const newToken = await mintTestToken(newPrivateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m", kid: "new-key" });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: newToken, prisma })).resolves.toMatchObject({ subject: "w" });

    const jwksFetchesAfterRotation = fetchMock.mock.calls.filter(c => (typeof c[0] === "string" ? c[0] : c[0].toString()) === jwksUrl).length;
    expect(jwksFetchesAfterRotation).toBe(2); // original prime + refetch after kid-miss
  });

  it("invalidates discovery when a key miss may be caused by a moved jwks_uri", async () => {
    const { privateKey: oldPrivateKey, jwk: oldJwk } = await setupMockIdp({ issuerUrl, kid: "old-key" });
    const { privateKey: newPrivateKey, jwk: newJwk } = await setupMockIdp({ issuerUrl, kid: "new-key" });

    let currentJwksPath = "/jwks-old";
    const discoveryUrl = `${issuerUrl}/.well-known/openid-configuration`;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === discoveryUrl) {
        return new Response(JSON.stringify({ issuer: issuerUrl, jwks_uri: `${issuerUrl}${currentJwksPath}` }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `${issuerUrl}/jwks-old`) {
        return new Response(JSON.stringify({ keys: [oldJwk] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `${issuerUrl}/jwks-new`) {
        return new Response(JSON.stringify({ keys: [newJwk] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const oldToken = await mintTestToken(oldPrivateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m", kid: "old-key" });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: oldToken, prisma })).resolves.toMatchObject({ subject: "w" });

    currentJwksPath = "/jwks-new";
    const newToken = await mintTestToken(newPrivateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m", kid: "new-key" });
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: newToken, prisma })).resolves.toMatchObject({ subject: "w" });

    const calls = fetchMock.mock.calls.map(c => typeof c[0] === "string" ? c[0] : c[0].toString());
    expect(calls.filter(url => url === discoveryUrl)).toHaveLength(2);
    expect(calls).toContain(`${issuerUrl}/jwks-new`);
  });

  it("refetches after each cache TTL expires (JWKS 10m, discovery 1h)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
      const fetchMock = installFetchMock({ issuerUrl, jwks: [jwk] });
      const token = await mintTestToken(privateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "3h" });

      await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma });
      expect(fetchMock.mock.calls.length).toBe(2); // discovery + JWKS

      // Within both TTLs — no new fetches.
      await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma });
      expect(fetchMock.mock.calls.length).toBe(2);

      // Past JWKS TTL (10min) but within discovery TTL (1h) → 1 new JWKS fetch.
      vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
      await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma });
      expect(fetchMock.mock.calls.length).toBe(3);

      // Past discovery TTL (1h total) → both expire → 2 new fetches.
      vi.setSystemTime(new Date(Date.now() + 60 * 60 * 1000));
      await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma });
      expect(fetchMock.mock.calls.length).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a recovered IdP succeed after negative-cache TTL expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
      let idpAlive = false;
      const discoveryUrl = `${issuerUrl}/.well-known/openid-configuration`;
      const jwksUrl = `${issuerUrl}/jwks`;
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (!idpAlive) return new Response("down", { status: 500 });
        if (url === discoveryUrl) {
          return new Response(JSON.stringify({ issuer: issuerUrl, jwks_uri: jwksUrl }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url === jwksUrl) {
          return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`unexpected: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const token = await mintTestToken(privateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "3h" });

      await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
      expect(fetchMock.mock.calls.length).toBe(1);

      // Even after the IdP recovers, we're still inside the 30s negative TTL.
      idpAlive = true;
      await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toBeInstanceOf(OidcJwtValidationError);
      expect(fetchMock.mock.calls.length).toBe(1);

      // Past negative TTL → retries → succeeds.
      vi.setSystemTime(new Date(Date.now() + 31 * 1000));
      await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).resolves.toMatchObject({ subject: "w" });
      expect(fetchMock.mock.calls.length).toBe(3); // +discovery +jwks
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces 'no matching JWKS key' when refetched JWKS still lacks the token kid", async () => {
    const { privateKey: knownPrivateKey, jwk: knownJwk } = await setupMockIdp({ issuerUrl, kid: "known" });
    const fetchMock = installFetchMock({ issuerUrl, jwks: [knownJwk] });

    // Prime caches with a good token for kid "known".
    const primeToken = await mintTestToken(knownPrivateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m", kid: "known" });
    await validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: primeToken, prisma });
    expect(fetchMock.mock.calls.filter(c => (typeof c[0] === "string" ? c[0] : c[0].toString()) === `${issuerUrl}/jwks`).length).toBe(1);

    // Token with an unknown kid that's in NEITHER the cached JWKS nor any subsequent fetch.
    const { privateKey: unknownPrivateKey } = await setupMockIdp({ issuerUrl, kid: "mystery" });
    const mysteryToken = await mintTestToken(unknownPrivateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m", kid: "mystery" });

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token: mysteryToken, prisma })).rejects.toMatchObject({
      reason: "no matching JWKS key for token `kid`",
    });
    // Retry path should have refetched once; so JWKS fetch count is now 2.
    expect(fetchMock.mock.calls.filter(c => (typeof c[0] === "string" ? c[0] : c[0].toString()) === `${issuerUrl}/jwks`).length).toBe(2);
  });

  it("keys the cache by issuer — different issuers don't share entries", async () => {
    const issuerA = "https://idp-a.example.com";
    const issuerB = "https://idp-b.example.com";
    const { privateKey: keyA, jwk: jwkA } = await setupMockIdp({ issuerUrl: issuerA });
    const { privateKey: keyB, jwk: jwkB } = await setupMockIdp({ issuerUrl: issuerB });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === `${issuerA}/.well-known/openid-configuration`) {
        return new Response(JSON.stringify({ issuer: issuerA, jwks_uri: `${issuerA}/jwks` }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `${issuerA}/jwks`) {
        return new Response(JSON.stringify({ keys: [jwkA] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `${issuerB}/.well-known/openid-configuration`) {
        return new Response(JSON.stringify({ issuer: issuerB, jwks_uri: `${issuerB}/jwks` }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `${issuerB}/jwks`) {
        return new Response(JSON.stringify({ keys: [jwkB] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokenA = await mintTestToken(keyA, { sub: "a" }, { issuer: issuerA, audience: "stack-auth", expiresIn: "5m" });
    const tokenB = await mintTestToken(keyB, { sub: "b" }, { issuer: issuerB, audience: "stack-auth", expiresIn: "5m" });

    const resA = await validateOidcJwt({ issuerUrl: issuerA, audiences: ["stack-auth"], token: tokenA, prisma });
    const resB = await validateOidcJwt({ issuerUrl: issuerB, audiences: ["stack-auth"], token: tokenB, prisma });
    expect(resA.subject).toBe("a");
    expect(resB.subject).toBe("b");
    expect(fetchMock.mock.calls.length).toBe(4); // 2 per issuer, no cross-hit
  });

  it("caches discovery issuer-mismatch errors (not just HTTP failures)", async () => {
    const { privateKey, jwk } = await setupMockIdp({ issuerUrl });
    const fetchMock = installFetchMock({
      issuerUrl,
      advertisedIssuer: "https://lying-issuer.example.com",
      jwks: [jwk],
    });
    const token = await mintTestToken(privateKey, { sub: "w" }, { issuer: issuerUrl, audience: "stack-auth", expiresIn: "5m" });

    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toMatchObject({ reason: "issuer discovery failed" });
    expect(fetchMock.mock.calls.length).toBe(1);

    // Second call within negative TTL — cached error, no new fetch.
    await expect(validateOidcJwt({ issuerUrl, audiences: ["stack-auth"], token, prisma })).rejects.toMatchObject({ reason: "issuer discovery failed" });
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});
