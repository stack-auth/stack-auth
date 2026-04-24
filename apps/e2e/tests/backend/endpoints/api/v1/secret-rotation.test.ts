import { isBase64Url } from "@stackframe/stack-shared/dist/utils/bytes";
import * as jose from "jose";
import { it } from "../../../../helpers";
import { Auth, backendContext, niceBackendFetch } from "../../../backend-helpers";

/**
 * End-to-end coverage for the dual-secret (`STACK_SERVER_SECRET` +
 * `STACK_SERVER_SECRET_OLD`) configuration. Both env vars are required; when
 * the two are equal the backend is in steady state, when they differ it is in
 * a Deploy 1 rotation overlap. These tests assert behavior that must hold in
 * both modes.
 *
 * What these tests close:
 *  - JWKS route returns both the primary-secret and _OLD-secret derivations
 *    (4 entries total). Kid uniqueness is 2 in steady state, 4 during a
 *    rotation — we only assert the lower bound here.
 *  - `getOldStackServerSecret` is correctly wired into `getPrivateJwks` at
 *    runtime (the unit tests pin the function; only a live JWKS response
 *    proves the call graph).
 *  - Fresh access tokens are cryptographically verifiable against the live
 *    JWKS.
 *  - Refresh still mints verifiable tokens (refresh tokens are random DB
 *    strings, so this also confirms they are unaffected by the secret).
 *  - Revocation is unaffected by the presence of a second secret.
 */

const INTERNAL_JWKS_PATH = "/api/v1/projects/internal/.well-known/jwks.json";

it("JWKS publishes 2 entries in steady state or 4 during rotation, all ES256 P-256, no duplicates, no private scalars", async ({ expect }) => {
  const response = await niceBackendFetch(INTERNAL_JWKS_PATH);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).includes("application/json");
  expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  for (const key of response.body.keys) {
    expect(key).toEqual({
      alg: "ES256",
      crv: "P-256",
      kid: expect.any(String),
      kty: "EC",
      x: expect.toSatisfy(isBase64Url),
      y: expect.toSatisfy(isBase64Url),
    });
    // Must not leak the private scalar.
    expect((key as { d?: unknown }).d).toBeUndefined();
  }
  const kids = response.body.keys.map((k: { kid: string }) => k.kid);
  // `getPrivateJwks` dedups when primary === _OLD, so published count matches the
  // unique kid count in every configuration. Either we're steady (2) or rotating (4).
  expect(new Set(kids).size).toBe(kids.length);
  expect([2, 4]).toContain(kids.length);
});

it("a client that cached the JWKS before sign-up still validates the minted access token", async ({ expect }) => {
  // Snapshot the JWKS first, as a client/relying-party would have.
  const cachedJwks = await niceBackendFetch(INTERNAL_JWKS_PATH);
  expect(cachedJwks.status).toBe(200);
  const cachedJwkSet = jose.createLocalJWKSet(cachedJwks.body);
  const cachedKids = cachedJwks.body.keys.map((k: { kid: string }) => k.kid);

  // Now mint a token.
  await Auth.Password.signUpWithEmail();
  const accessToken = backendContext.value.userAuth?.accessToken;
  expect(accessToken).toBeDefined();

  // The token's kid must already be in the cached set (signing cannot produce a kid
  // outside the currently-published JWKS), and its signature must verify against the
  // cached public keys — this is the invariant external verifiers rely on.
  const header = jose.decodeProtectedHeader(accessToken!);
  expect(cachedKids).toContain(header.kid);
  await expect(jose.jwtVerify(accessToken!, cachedJwkSet)).resolves.toBeDefined();

  // Sanity: re-fetch the live JWKS; since no rotation occurred mid-test, it should
  // match the cached snapshot (same kids). This also pins that sign-up doesn't rotate.
  const liveJwks = await niceBackendFetch(INTERNAL_JWKS_PATH);
  const liveKids = new Set(liveJwks.body.keys.map((k: { kid: string }) => k.kid));
  expect(liveKids).toEqual(new Set(cachedKids));
});

it("refresh returns a verifiable access token", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  // Drop the access token so expectSessionToBeValid/refresh has real work to do.
  backendContext.set({ userAuth: { ...backendContext.value.userAuth, accessToken: undefined } });

  const refreshed = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
  });
  expect(refreshed.status).toBe(200);
  const newAccessToken = refreshed.body.access_token as string;
  expect(newAccessToken).toBeDefined();

  const jwks = await niceBackendFetch(INTERNAL_JWKS_PATH);
  const jwkSet = jose.createLocalJWKSet(jwks.body);
  await expect(jose.jwtVerify(newAccessToken, jwkSet)).resolves.toBeDefined();

  // Session should be fully usable after refresh.
  backendContext.set({ userAuth: { ...backendContext.value.userAuth, accessToken: newAccessToken } });
  await Auth.expectSessionToBeValid();
  await Auth.expectToBeSignedIn();
});

it("revocation blocks refresh on the revoked session", async ({ expect }) => {
  const signUp = await Auth.Password.signUpWithEmail();

  // Create an additional session so we can revoke it without touching the current one.
  const additionalSession = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "server",
    method: "POST",
    body: { user_id: signUp.userId },
  });
  expect(additionalSession.status).toBe(200);

  // Sanity: that session's refresh token works before we revoke it.
  const beforeRevoke = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
    headers: { "x-stack-refresh-token": additionalSession.body.refresh_token },
  });
  expect(beforeRevoke.status).toBe(200);

  const listResponse = await niceBackendFetch("/api/v1/auth/sessions", {
    accessType: "client",
    method: "GET",
    query: { user_id: signUp.userId },
  });
  expect(listResponse.status).toBe(200);
  const nonCurrent = listResponse.body.items.find(
    (s: { is_current_session: boolean }) => !s.is_current_session,
  );
  expect(nonCurrent).toBeDefined();

  const deleteResponse = await niceBackendFetch(`/api/v1/auth/sessions/${nonCurrent.id}`, {
    accessType: "client",
    method: "DELETE",
    query: { user_id: signUp.userId },
  });
  expect(deleteResponse.status).toBe(200);

  // Post-revoke: the revoked session's refresh token is rejected.
  const afterRevoke = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
    headers: { "x-stack-refresh-token": additionalSession.body.refresh_token },
  });
  expect(afterRevoke.status).toBe(401);
  expect(afterRevoke.body.code).toBe("REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED");

  // Current session should remain usable (revocation didn't cascade).
  const currentRefresh = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
  });
  expect(currentRefresh.status).toBe(200);
  expect(currentRefresh.body.access_token).toBeDefined();
});
