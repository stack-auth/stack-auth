import { describe, expect, it } from "vitest";
import { StackClientApp } from "../interfaces/client-app";

/**
 * Builds a decodable (unsigned) access-token JWT. `refreshTokenId` is the session identifier; `iatOffsetSeconds`
 * lets two tokens for the same session differ as strings while sharing a `refresh_token_id`.
 */
function createAccessTokenString(refreshTokenId: string, options?: { iatOffsetSeconds?: number, sub?: string }): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1000) + (options?.iatOffsetSeconds ?? 0);
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      sub: options?.sub ?? "user-id",
      exp: nowSeconds + 60,
      iat: nowSeconds,
      iss: "https://api.example.test",
      aud: "project-id",
      project_id: "project-id",
      branch_id: "main",
      refresh_token_id: refreshTokenId,
      role: "authenticated",
      name: null,
      email: null,
      email_verified: false,
      selected_team_id: null,
      signed_up_at: nowSeconds,
      is_anonymous: false,
      is_restricted: false,
      restricted_reason: null,
      requires_totp_mfa: false,
    }),
    "",
  ].join(".");
}

describe("StackClientApp access-only session reuse", () => {
  function createApp() {
    const app = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000006",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "none",
      noAutomaticPrefetch: true,
    });
    // The sign-in path pre-warms the current-user cache; stub it so the test stays network-free.
    Reflect.set(Reflect.get(app, "_currentUserCache"), "getOrWait", () => Promise.resolve());
    return app;
  }

  async function signInWithAccessOnlyToken(app: StackClientApp, accessToken: string) {
    const signInToAccount = Reflect.get(app, "_signInToAccountWithTokens");
    if (typeof signInToAccount !== "function") {
      throw new Error("Expected StackClientApp to expose _signInToAccountWithTokens in tests.");
    }
    await signInToAccount.call(app, { accessToken, refreshToken: "" });
  }

  function currentSession(app: StackClientApp) {
    const getSessionFromTokenStore = Reflect.get(app, "_getSessionFromTokenStore");
    if (typeof getSessionFromTokenStore !== "function") {
      throw new Error("Expected StackClientApp to expose _getSessionFromTokenStore in tests.");
    }
    return getSessionFromTokenStore.call(app, Reflect.get(app, "_memoryTokenStore"));
  }

  it("reuses the same InternalSession object when an access-only token is re-minted", async () => {
    const app = createApp();
    const first = createAccessTokenString("rtid-1", { iatOffsetSeconds: 0 });
    const reminted = createAccessTokenString("rtid-1", { iatOffsetSeconds: 1 });
    expect(reminted).not.toBe(first);

    await signInWithAccessOnlyToken(app, first);
    const session1 = currentSession(app);

    await signInWithAccessOnlyToken(app, reminted);
    const session2 = currentSession(app);

    // Same session object => useUser/useConfig/... keep their warm cache entries => no Suspense, no blank.
    // (This is the regression: keying access-only sessions by the raw token used to spawn a new object here.)
    expect(session2).toBe(session1);
    // ...and the reused session adopts the freshly minted token in place.
    expect(session2.getAccessTokenIfNotExpiredYet(20_000, null)?.token).toBe(reminted);
  });

  it("swaps to a new InternalSession when the token belongs to a different session", async () => {
    const app = createApp();

    await signInWithAccessOnlyToken(app, createAccessTokenString("rtid-1"));
    const session1 = currentSession(app);

    await signInWithAccessOnlyToken(app, createAccessTokenString("rtid-2", { sub: "other-user" }));
    const session2 = currentSession(app);

    expect(session2).not.toBe(session1);
  });
});
