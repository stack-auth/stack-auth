import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import * as jose from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicJwks, signSpacetimeToken, spacetimeTokenAudience, spacetimeTokenIssuer } from "./spacetimedb-token";

// The module under test imports the `server-only` marker package, which throws
// when loaded outside a React Server Components bundler context.
vi.mock("server-only", () => ({}));

async function generatePrivateEcJwk(): Promise<jose.JWK> {
  const { privateKey } = await jose.generateKeyPair("ES256", { extractable: true });
  return await jose.exportJWK(privateKey);
}

function stubSigningKey(jwk: object) {
  vi.stubEnv("HEXCLAVE_SPACETIMEDB_SIGNING_KEY_JWK", JSON.stringify(jwk));
}

function stubDefaultEnv() {
  vi.stubEnv("HEXCLAVE_SPACETIMEDB_TOKEN_ISSUER", "https://internal.example.com");
  vi.stubEnv("HEXCLAVE_SPACETIMEDB_EXPECTED_AUDIENCE", "");
  // getEnvVariable also reads the legacy STACK_-prefixed twins; stub them to
  // empty (= unset) so a stray var in the runner's environment can't interfere.
  vi.stubEnv("STACK_SPACETIMEDB_SIGNING_KEY_JWK", "");
  vi.stubEnv("STACK_SPACETIMEDB_TOKEN_ISSUER", "");
  vi.stubEnv("STACK_SPACETIMEDB_EXPECTED_AUDIENCE", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicJwks", () => {
  it("serves only the allowlisted public members, never `d` or unknown extras", async () => {
    stubDefaultEnv();
    const privateEcJwk = await generatePrivateEcJwk();
    stubSigningKey({
      ...privateEcJwk,
      kid: "test-kid",
      alg: "ES256",
      // Simulate a JWK that carries members we don't know about; they must
      // not be reflected on the public endpoint.
      key_ops: ["sign"],
      unexpected_member: "must-not-leak",
    });

    const jwks = publicJwks();
    expect(jwks.keys).toHaveLength(1);
    const key = jwks.keys[0];
    expect(Object.keys(key).sort()).toMatchInlineSnapshot(`
      [
        "alg",
        "crv",
        "kid",
        "kty",
        "x",
        "y",
      ]
    `);
    expect(key.x).toBe(privateEcJwk.x);
    expect(key.y).toBe(privateEcJwk.y);
    expect(key.kid).toBe("test-kid");
    expect(key.alg).toBe("ES256");
  });

  it("omits kid/alg entirely when the private JWK doesn't carry them", async () => {
    stubDefaultEnv();
    stubSigningKey(await generatePrivateEcJwk());

    const key = publicJwks().keys[0];
    expect(Object.keys(key).sort()).toMatchInlineSnapshot(`
      [
        "crv",
        "kty",
        "x",
        "y",
      ]
    `);
  });

  it("rejects an RSA private key instead of serving its private members", async () => {
    stubDefaultEnv();
    const { privateKey } = await jose.generateKeyPair("RS256", { extractable: true, modulusLength: 2048 });
    const rsaJwk = await jose.exportJWK(privateKey);
    // Sanity-check the threat: an RSA private JWK keeps secrets beyond `d`.
    expect(rsaJwk.p).toBeDefined();
    stubSigningKey(rsaJwk);

    expect(() => publicJwks()).toThrow(HexclaveAssertionError);
  });

  it("rejects a symmetric (oct) key", () => {
    stubDefaultEnv();
    stubSigningKey({ kty: "oct", k: "c2VjcmV0LXN5bW1ldHJpYy1rZXk" });

    expect(() => publicJwks()).toThrow(HexclaveAssertionError);
  });

  it("rejects an EC key on the wrong curve", async () => {
    stubDefaultEnv();
    const { privateKey } = await jose.generateKeyPair("ES384", { extractable: true });
    stubSigningKey(await jose.exportJWK(privateKey));

    expect(() => publicJwks()).toThrow(HexclaveAssertionError);
  });

  it("throws when the signing key env var is not configured", () => {
    stubDefaultEnv();
    vi.stubEnv("HEXCLAVE_SPACETIMEDB_SIGNING_KEY_JWK", "");

    expect(() => publicJwks()).toThrow("HEXCLAVE_SPACETIMEDB_SIGNING_KEY_JWK is not configured");
  });
});

describe("signSpacetimeToken", () => {
  it("mints a token that verifies against the published JWKS", async () => {
    stubDefaultEnv();
    stubSigningKey({ ...await generatePrivateEcJwk(), kid: "test-kid" });

    const token = await signSpacetimeToken({ subject: "user-123", name: "Ada Lovelace" });
    // Verifying with the JWKS output (not the private key) also proves the
    // allowlisted public members are sufficient for verification.
    const publicKey = await jose.importJWK(publicJwks().keys[0], "ES256");
    const { payload, protectedHeader } = await jose.jwtVerify(token, publicKey, {
      issuer: "https://internal.example.com",
      audience: "spacetimedb",
    });

    expect(protectedHeader.alg).toBe("ES256");
    expect(protectedHeader.kid).toBe("test-kid");
    expect(payload.sub).toBe("user-123");
    expect(payload.name).toBe("Ada Lovelace");
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
    // Default TTL is 30 minutes (see USER_TOKEN_TTL for why it's much longer
    // than the frontend's 8-minute refresh interval).
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(30 * 60);
  });

  it("omits the name claim when name is not provided or empty", async () => {
    stubDefaultEnv();
    stubSigningKey(await generatePrivateEcJwk());

    for (const options of [{ subject: "user-123" }, { subject: "user-123", name: "" }]) {
      const token = await signSpacetimeToken(options);
      const payload = jose.decodeJwt(token);
      expect("name" in payload).toBe(false);
    }
  });

  it("respects a custom expiresIn", async () => {
    stubDefaultEnv();
    stubSigningKey(await generatePrivateEcJwk());

    const token = await signSpacetimeToken({ subject: "svc", expiresIn: "3600s" });
    const payload = jose.decodeJwt(token);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
  });
});

describe("spacetimeTokenIssuer", () => {
  it("strips trailing slashes", () => {
    stubDefaultEnv();
    vi.stubEnv("HEXCLAVE_SPACETIMEDB_TOKEN_ISSUER", "https://internal.example.com///");

    expect(spacetimeTokenIssuer()).toBe("https://internal.example.com");
  });

  it("throws when unset or blank", () => {
    stubDefaultEnv();
    vi.stubEnv("HEXCLAVE_SPACETIMEDB_TOKEN_ISSUER", "   ");

    expect(() => spacetimeTokenIssuer()).toThrow("HEXCLAVE_SPACETIMEDB_TOKEN_ISSUER is not configured");
  });
});

describe("spacetimeTokenAudience", () => {
  it("defaults to spacetimedb", () => {
    stubDefaultEnv();

    expect(spacetimeTokenAudience()).toBe("spacetimedb");
  });

  it("respects the env override", () => {
    stubDefaultEnv();
    vi.stubEnv("HEXCLAVE_SPACETIMEDB_EXPECTED_AUDIENCE", "custom-audience");

    expect(spacetimeTokenAudience()).toBe("custom-audience");
  });
});
