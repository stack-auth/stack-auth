import { describe, expect, it } from "vitest";
import { StackClientApp } from "../interfaces/client-app";

function createAccessTokenString(refreshTokenId: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      sub: "user-id",
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

describe("StackClientApp sign-in cache warm-up", () => {
  it("has the new session's user cached by the time the token store change is published", async () => {
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "none",
      noAutomaticPrefetch: true,
    });

    const clientInterface = Reflect.get(clientApp, "_interface");
    let getClientUserByTokenCalls = 0;
    Reflect.set(clientInterface, "getClientUserByToken", async () => {
      getClientUserByTokenCalls += 1;
      return { id: "user-id", is_anonymous: false, is_restricted: false };
    });

    // The new session's user is cached before the token store update is published, so `useUser()` hooks that re-render
    // because of the new session read a warm cache instead of suspending and flashing their Suspense fallback.
    const cacheStatusesOnTokenStoreChange: string[] = [];
    const tokenStore = Reflect.get(clientApp, "_getOrCreateTokenStore").call(
      clientApp,
      await Reflect.get(clientApp, "_createCookieHelper").call(clientApp),
    );
    tokenStore.onChange(() => {
      const session = Reflect.get(clientApp, "_getSessionFromTokenStore").call(clientApp, tokenStore);
      const currentUserCache = Reflect.get(clientApp, "_currentUserCache");
      cacheStatusesOnTokenStoreChange.push(currentUserCache.getIfCached([session]).status);
    });

    await Reflect.get(clientApp, "_signInToAccountWithTokens").call(clientApp, {
      accessToken: createAccessTokenString("refresh-token-id"),
      refreshToken: "refresh-token",
    });

    const session = await Reflect.get(clientApp, "_getSession").call(clientApp);
    const cachedUser = Reflect.get(clientApp, "_currentUserCache").getIfCached([session]);
    expect(cachedUser.status).toBe("ok");
    expect(cachedUser.data.data).toMatchObject({ id: "user-id" });
    expect(getClientUserByTokenCalls).toBe(1);
    expect(cacheStatusesOnTokenStoreChange).toEqual(["ok"]);
  });

  it("doesn't let a slow sign-in publish its tokens on top of a sign-in that started later", async () => {
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "none",
      noAutomaticPrefetch: true,
    });

    let onFirstPrefetchStarted!: () => void;
    const firstPrefetchStarted = new Promise<void>((resolve) => { onFirstPrefetchStarted = resolve; });
    let releaseFirstPrefetch!: () => void;
    const firstPrefetchReleased = new Promise<void>((resolve) => { releaseFirstPrefetch = resolve; });

    const clientInterface = Reflect.get(clientApp, "_interface");
    let getClientUserByTokenCalls = 0;
    Reflect.set(clientInterface, "getClientUserByToken", async () => {
      getClientUserByTokenCalls += 1;
      // The first sign-in's pre-fetch only finishes once we let it, so the second one deterministically gets to publish
      // while the first one is still waiting.
      if (getClientUserByTokenCalls === 1) {
        onFirstPrefetchStarted();
        await firstPrefetchReleased;
      }
      return { id: "user-id", is_anonymous: false, is_restricted: false };
    });

    const signIn = (refreshToken: string, refreshTokenId: string) => Reflect.get(clientApp, "_signInToAccountWithTokens").call(clientApp, {
      accessToken: createAccessTokenString(refreshTokenId),
      refreshToken,
    });

    const slowSignIn = signIn("old-refresh-token", "old-refresh-token-id");
    await firstPrefetchStarted;
    await signIn("new-refresh-token", "new-refresh-token-id");
    releaseFirstPrefetch();
    await slowSignIn;
    expect(getClientUserByTokenCalls).toBe(2);

    const tokenStore = Reflect.get(clientApp, "_getOrCreateTokenStore").call(
      clientApp,
      await Reflect.get(clientApp, "_createCookieHelper").call(clientApp),
    );
    expect(tokenStore.get().refreshToken).toBe("new-refresh-token");
  });
});
