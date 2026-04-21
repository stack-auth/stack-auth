/**
 * Mock OIDC Identity Provider for local development of the Stack Auth
 * OIDC-federation feature. It mimics the discovery + JWKS + token-minting
 * surface that Vercel / GitHub Actions / GCP / any OIDC-compliant IdP expose
 * at runtime, so the backend's `/api/v1/auth/oidc-federation/exchange`
 * endpoint has something to validate against without network egress.
 *
 * Endpoints:
 *   GET  /.well-known/openid-configuration  — OIDC discovery doc
 *   GET  /jwks                              — JSON Web Key Set (RSA public key)
 *   POST /mint                              — non-standard. Mints an ID-token
 *                                             with caller-supplied `sub`, `aud`,
 *                                             and extra claims. Used by the
 *                                             demo app to simulate a workload
 *                                             token without the caller having
 *                                             to sign their own JWT.
 *
 * This server does NOT implement the OAuth 2.0 authorization-code flow. It
 * exists solely to serve as a trusted OIDC issuer for federation testing.
 */

import express from "express";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const stackPortPrefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";
const defaultPort = Number(`${stackPortPrefix}15`);
const port = Number(process.env.PORT ?? defaultPort);
const issuer = process.env.STACK_MOCK_OIDC_ISSUER_URL ?? `http://localhost:${port}`;

async function main() {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "mock-oidc-idp-key-1";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  const app = express();
  app.use(express.json());

  app.get("/.well-known/openid-configuration", (_req, res) => {
    res.json({
      issuer,
      jwks_uri: `${issuer}/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
      // The remaining fields are not used by the backend but make this doc
      // parseable by generic OIDC clients that probe a few optional keys.
      response_types_supported: ["id_token"],
      subject_types_supported: ["public"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  app.get("/jwks", (_req, res) => {
    res.json({ keys: [publicJwk] });
  });

  // Non-standard mint endpoint. Real IdPs don't expose anything like this —
  // they mint tokens at the end of a controlled auth flow. We expose it so
  // the demo app can request a workload-style token on demand.
  app.post("/mint", async (req, res) => {
    const body = (req.body ?? {}) as {
      sub?: unknown,
      aud?: unknown,
      extraClaims?: unknown,
      ttlSeconds?: unknown,
    };
    const sub = typeof body.sub === "string" && body.sub.length > 0 ? body.sub : "workload:demo";
    const aud = typeof body.aud === "string" && body.aud.length > 0 ? body.aud : `${issuer}/default-audience`;
    const ttlSeconds = typeof body.ttlSeconds === "number" && body.ttlSeconds > 0 && body.ttlSeconds <= 3600 ? body.ttlSeconds : 300;
    const extraClaims = typeof body.extraClaims === "object" && body.extraClaims !== null && !Array.isArray(body.extraClaims)
      ? (body.extraClaims as Record<string, unknown>)
      : {};

    const jwt = await new SignJWT(extraClaims)
      .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid, typ: "JWT" })
      .setIssuer(issuer)
      .setSubject(sub)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
      .sign(privateKey);

    res.json({
      id_token: jwt,
      issuer,
      sub,
      aud,
      expires_in: ttlSeconds,
    });
  });

  app.get("/", (_req, res) => {
    res.type("text/plain").send(
      [
        "Mock OIDC IdP (Stack Auth OIDC federation local dev)",
        `issuer: ${issuer}`,
        "",
        "GET  /.well-known/openid-configuration",
        "GET  /jwks",
        "POST /mint   { sub, aud, extraClaims, ttlSeconds } -> { id_token, ... }",
      ].join("\n"),
    );
  });

  app.listen(port, () => {
    console.log(`Mock OIDC IdP listening on ${issuer}`);
  });
}

void main().then(
  () => {
    // started OK — listener logs its own ready message
  },
  (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Mock OIDC IdP failed to start:", err);
    process.exit(1);
  },
);
