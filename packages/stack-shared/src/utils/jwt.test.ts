import crypto from "crypto";
import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toHexString } from "./bytes";
import { sha512 } from "./hashes";
import { getOldStackServerSecret, getPrivateJwks, getPublicJwkSet, signJWT, verifyJWT } from "./jwt";

const randomSecret = () => jose.base64url.encode(crypto.randomBytes(32));

// Mirrors the derivation used in apps/backend/src/app/api/latest/integrations/idp.ts.
// Keeping it identical here pins the algorithm contract across the two call sites.
async function deriveOidcCookieKey(secret: string): Promise<string> {
  return toHexString(await sha512(`oidc-idp-cookie-encryption-key:${secret}`));
}

// Mirrors the `cookies.keys` array built in idp.ts under the currently-set env vars.
async function buildOidcCookieKeys(): Promise<string[]> {
  const primary = process.env.STACK_SERVER_SECRET!;
  const old = getOldStackServerSecret();
  return [
    await deriveOidcCookieKey(primary),
    ...(old ? [await deriveOidcCookieKey(old)] : []),
  ];
}

// signJWT only accepts string expirations; for the expiry test we need an explicit past
// timestamp, so we drop down to jose directly, reusing the same primary private JWK.
async function signJWTWithExplicitExp(options: {
  audience: string,
  issuer: string,
  expUnixSeconds: number,
}) {
  const jwks = await getPrivateJwks({ audience: options.audience });
  const privateKey = await jose.importJWK(jwks[0]);
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: jwks[0].kid })
    .setIssuer(options.issuer)
    .setIssuedAt(options.expUnixSeconds - 120)
    .setAudience(options.audience)
    .setExpirationTime(options.expUnixSeconds)
    .sign(privateKey);
}

describe("STACK_SERVER_SECRET rotation — Deploy 1 invariants", () => {
  const savedPrimary = process.env.STACK_SERVER_SECRET;
  const savedOld = process.env.STACK_SERVER_SECRET_OLD;

  beforeEach(() => {
    delete process.env.STACK_SERVER_SECRET;
    delete process.env.STACK_SERVER_SECRET_OLD;
  });

  afterEach(() => {
    if (savedPrimary === undefined) delete process.env.STACK_SERVER_SECRET;
    else process.env.STACK_SERVER_SECRET = savedPrimary;
    if (savedOld === undefined) delete process.env.STACK_SERVER_SECRET_OLD;
    else process.env.STACK_SERVER_SECRET_OLD = savedOld;
  });

  it("1. new login after Deploy 1: fresh JWT signs with new secret, verifies, and carries the new kid", async () => {
    const newSecret = randomSecret();
    const oldSecret = randomSecret();
    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;

    const jwt = await signJWT({ issuer: "iss", audience: "aud", payload: { sub: "user-1" } });
    const payload = await verifyJWT({ allowedIssuers: ["iss"], jwt });
    expect(payload.sub).toBe("user-1");

    const jwks = await getPrivateJwks({ audience: "aud" });
    expect(jose.decodeProtectedHeader(jwt).kid).toBe(jwks[0].kid);
  });

  it("2. old access token still works after Deploy 1: JWT signed with old secret verifies post-rotation", async () => {
    const oldSecret = randomSecret();
    const newSecret = randomSecret();

    process.env.STACK_SERVER_SECRET = oldSecret;
    const oldJwt = await signJWT({ issuer: "iss", audience: "aud", payload: { sub: "user-2" } });

    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;

    const payload = await verifyJWT({ allowedIssuers: ["iss"], jwt: oldJwt });
    expect(payload.sub).toBe("user-2");
  });

  it("3. any JWT minted during Deploy 1 carries the new-secret kid (refresh-flow invariant; refresh itself is DB-backed)", async () => {
    // The refresh exchange lives in apps/backend/src/lib/tokens.tsx and is not covered here.
    // What this test pins is the JWT-layer invariant that the refresh exchange relies on:
    // any access token minted while both secrets are configured carries the new-secret kid.
    const oldSecret = randomSecret();
    const newSecret = randomSecret();

    process.env.STACK_SERVER_SECRET = oldSecret;
    const preRotationKids = new Set(
      (await getPrivateJwks({ audience: "aud" })).map(j => j.kid),
    );

    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;

    const mintedJwt = await signJWT({ issuer: "iss", audience: "aud", payload: { sub: "user-3" } });
    const header = jose.decodeProtectedHeader(mintedJwt);
    expect(preRotationKids.has(header.kid as string)).toBe(false);
    await expect(verifyJWT({ allowedIssuers: ["iss"], jwt: mintedJwt })).resolves.toBeTruthy();
  });

  it("4. verification accepts both old-signed and new-signed JWTs during overlap", async () => {
    const oldSecret = randomSecret();
    const newSecret = randomSecret();

    process.env.STACK_SERVER_SECRET = oldSecret;
    const oldJwt = await signJWT({ issuer: "iss", audience: "aud", payload: { kind: "old" } });

    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;
    const newJwt = await signJWT({ issuer: "iss", audience: "aud", payload: { kind: "new" } });

    expect((await verifyJWT({ allowedIssuers: ["iss"], jwt: oldJwt })).kind).toBe("old");
    expect((await verifyJWT({ allowedIssuers: ["iss"], jwt: newJwt })).kind).toBe("new");
  });

  it("5. after Deploy 1, new JWTs are never signed with the old secret (no signing overlap)", async () => {
    const oldSecret = randomSecret();
    const newSecret = randomSecret();

    process.env.STACK_SERVER_SECRET = oldSecret;
    const oldSecretKids = new Set(
      (await getPrivateJwks({ audience: "aud" })).map(j => j.kid),
    );

    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;

    const jwt = await signJWT({ issuer: "iss", audience: "aud", payload: {} });
    expect(oldSecretKids.has(jose.decodeProtectedHeader(jwt).kid as string)).toBe(false);
  });

  it("6. in-progress OIDC flow: cookie key derived from the old secret stays in the verify set during overlap", async () => {
    const oldSecret = randomSecret();
    const newSecret = randomSecret();
    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;

    const keys = await buildOidcCookieKeys();
    // Koa keygrip (used by oidc-provider for `cookies.keys`) verifies against any entry.
    expect(keys).toContain(await deriveOidcCookieKey(oldSecret));
  });

  it("7. new OIDC flow after Deploy 1 signs cookies with the new-secret-derived key", async () => {
    const oldSecret = randomSecret();
    const newSecret = randomSecret();
    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;

    const keys = await buildOidcCookieKeys();
    // Koa keygrip signs using keys[0], so keys[0] must be the new-secret derivation.
    expect(keys[0]).toBe(await deriveOidcCookieKey(newSecret));
    expect(keys[0]).not.toBe(await deriveOidcCookieKey(oldSecret));
  });

  it("8. tampered, third-party-signed, or garbage JWTs are rejected during overlap", async () => {
    const oldSecret = randomSecret();
    const newSecret = randomSecret();
    const unrelatedSecret = randomSecret();

    // (a) signed by a totally unrelated secret — not in the verify set
    process.env.STACK_SERVER_SECRET = unrelatedSecret;
    const unrelatedJwt = await signJWT({ issuer: "iss", audience: "aud", payload: {} });

    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;
    await expect(verifyJWT({ allowedIssuers: ["iss"], jwt: unrelatedJwt })).rejects.toThrow();

    // (b) tampered signature on an otherwise-valid JWT
    const goodJwt = await signJWT({ issuer: "iss", audience: "aud", payload: {} });
    const [h, p] = goodJwt.split(".");
    const tampered = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    await expect(verifyJWT({ allowedIssuers: ["iss"], jwt: tampered })).rejects.toThrow();

    // (c) complete garbage
    await expect(verifyJWT({ allowedIssuers: ["iss"], jwt: "not.a.jwt" })).rejects.toThrow();
  });

  it("9. expired old-signed JWT is rejected on exp even though its signature still verifies", async () => {
    const oldSecret = randomSecret();
    const newSecret = randomSecret();

    process.env.STACK_SERVER_SECRET = oldSecret;
    const expiredJwt = await signJWTWithExplicitExp({
      audience: "aud",
      issuer: "iss",
      expUnixSeconds: Math.floor(Date.now() / 1000) - 60,
    });

    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;

    await expect(verifyJWT({ allowedIssuers: ["iss"], jwt: expiredJwt })).rejects.toThrow(/exp/i);
  });

  it("10. overlap JWKS equals the union of the new-secret-only and old-secret-only public sets, with no private scalars", async () => {
    const oldSecret = randomSecret();
    const newSecret = randomSecret();

    // New-secret-only public set (what the JWKS looks like before Deploy 1 and after Deploy 2).
    process.env.STACK_SERVER_SECRET = newSecret;
    const newOnly = await getPublicJwkSet(await getPrivateJwks({ audience: "aud" }));
    expect(newOnly.keys).toHaveLength(2);

    // Old-secret-only public set (what the JWKS looked like before the rotation started).
    process.env.STACK_SERVER_SECRET = oldSecret;
    delete process.env.STACK_SERVER_SECRET_OLD;
    const oldOnly = await getPublicJwkSet(await getPrivateJwks({ audience: "aud" }));
    expect(oldOnly.keys).toHaveLength(2);

    // Overlap set during Deploy 1.
    process.env.STACK_SERVER_SECRET = newSecret;
    process.env.STACK_SERVER_SECRET_OLD = oldSecret;
    const overlap = await getPublicJwkSet(await getPrivateJwks({ audience: "aud" }));
    expect(overlap.keys).toHaveLength(4);

    // Identity: overlap kids == (new-only kids) ∪ (old-only kids).
    const overlapKids = new Set(overlap.keys.map(k => k.kid));
    const expectedUnionKids = new Set<string>([
      ...newOnly.keys.map(k => k.kid),
      ...oldOnly.keys.map(k => k.kid),
    ]);
    expect(overlapKids).toEqual(expectedUnionKids);

    // Sanity: the two secrets produce disjoint kids (they're derived by hashing the secret).
    const newKids = new Set(newOnly.keys.map(k => k.kid));
    const oldKids = new Set(oldOnly.keys.map(k => k.kid));
    for (const k of newKids) expect(oldKids.has(k)).toBe(false);

    // The public JWKs must not leak the private scalar `d`.
    for (const k of overlap.keys) expect((k as unknown as { d?: unknown }).d).toBeUndefined();
  });

  it("rejects STACK_SERVER_SECRET_OLD that is set but not valid base64url", async () => {
    process.env.STACK_SERVER_SECRET = randomSecret();
    process.env.STACK_SERVER_SECRET_OLD = "not valid base64url!!!";
    await expect(getPrivateJwks({ audience: "aud" })).rejects.toThrow(/STACK_SERVER_SECRET_OLD/);
  });
});
