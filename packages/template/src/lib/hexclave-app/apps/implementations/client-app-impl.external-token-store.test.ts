import { KnownErrors } from "@hexclave/shared";
import { describe, expect, it } from "vitest";
import { clerkTokenStore } from "../../common";
import { StackClientApp } from "../interfaces/client-app";

function createAccessTokenString(refreshTokenId: string, issuedAtOffsetSeconds = 0): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1000) + issuedAtOffsetSeconds;
  // The payload must satisfy accessTokenPayloadSchema, otherwise AccessToken.createIfValid rejects it.
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      sub: "user-id",
      exp: nowSeconds + 60,
      iat: nowSeconds,
      iss: "http://localhost:12345",
      aud: "00000000-0000-4000-8000-000000000000",
      project_id: "00000000-0000-4000-8000-000000000000",
      branch_id: "main",
      refresh_token_id: refreshTokenId,
      role: "authenticated",
      name: "Test User",
      email: "test@example.com",
      email_verified: true,
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

describe("StackClientApp external token stores", () => {
  it("exchanges provider tokens and preserves the session across token rotations", async () => {
    let providerSessionId = "clerk-session";
    let notifyProviderChange: (() => void) | undefined;
    let exchangeCount = 0;
    const externalTokenStore = clerkTokenStore({
      getSessionId: () => providerSessionId,
      getToken: async () => "clerk-token",
      subscribe: (callback) => {
        notifyProviderChange = callback;
        return () => {};
      },
    });
    const clientApp = new StackClientApp({
      automaticSideEffects: false,
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: externalTokenStore,
      redirectMethod: "none",
    });
    const clientInterface = Reflect.get(clientApp, "_interface");
    Reflect.set(clientInterface, "exchangeExternalAuthToken", async () => {
      exchangeCount += 1;
      return {
        status: "ok",
        data: {
          accessToken: createAccessTokenString("hexclave-external-session", exchangeCount),
          sessionId: "hexclave-external-session",
          userId: "user-id",
        },
      };
    });

    const getSession = Reflect.get(clientApp, "_getSession");
    const firstSession = await getSession.call(clientApp);
    expect(firstSession.sessionKey).toBe("external-clerk-integration-clerk-session");
    await firstSession.getOrFetchLikelyValidTokens(20_000, null);
    expect(exchangeCount).toBe(1);

    notifyProviderChange?.();
    const refreshedSession = await getSession.call(clientApp);
    expect(refreshedSession).toBe(firstSession);
    await refreshedSession.getOrFetchLikelyValidTokens(20_000, null);
    expect(exchangeCount).toBe(2);

    providerSessionId = "another-clerk-session";
    notifyProviderChange?.();
    const switchedSession = await getSession.call(clientApp);
    expect(switchedSession).not.toBe(firstSession);
    expect(switchedSession.sessionKey).toBe("external-clerk-integration-another-clerk-session");
  });

  it("retries a rejected exchange once with a fresh provider token before giving up", async () => {
    let tokenCounter = 0;
    const exchangedTokens: string[] = [];
    const clientApp = new StackClientApp({
      automaticSideEffects: false,
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: clerkTokenStore({
        getSessionId: () => "clerk-session",
        getToken: async () => `clerk-token-${++tokenCounter}`,
      }),
      redirectMethod: "none",
    });
    const clientInterface = Reflect.get(clientApp, "_interface");
    Reflect.set(clientInterface, "exchangeExternalAuthToken", async (_providerId: string, token: string) => {
      exchangedTokens.push(token);
      // The first provider token is treated as expired-in-flight; the retried, freshly fetched one succeeds.
      if (exchangedTokens.length === 1) {
        return { status: "error", error: new KnownErrors.InvalidExternalAuthToken() };
      }
      return {
        status: "ok",
        data: {
          accessToken: createAccessTokenString("hexclave-external-session"),
          sessionId: "hexclave-external-session",
          userId: "user-id",
        },
      };
    });

    const getSession = Reflect.get(clientApp, "_getSession");
    const session = await getSession.call(clientApp);
    const tokens = await session.getOrFetchLikelyValidTokens(20_000, null);
    expect(tokens).not.toBeNull();
    expect(exchangedTokens).toEqual(["clerk-token-1", "clerk-token-2"]);
    expect(session.isKnownToBeInvalid()).toBe(false);
  });

  it("invalidates the session when the retried exchange is rejected too", async () => {
    let exchangeCount = 0;
    const clientApp = new StackClientApp({
      automaticSideEffects: false,
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: clerkTokenStore({
        getSessionId: () => "clerk-session",
        getToken: async () => "clerk-token",
      }),
      redirectMethod: "none",
    });
    const clientInterface = Reflect.get(clientApp, "_interface");
    Reflect.set(clientInterface, "exchangeExternalAuthToken", async () => {
      exchangeCount += 1;
      return { status: "error", error: new KnownErrors.InvalidExternalAuthToken() };
    });

    const getSession = Reflect.get(clientApp, "_getSession");
    const session = await getSession.call(clientApp);
    const tokens = await session.getOrFetchLikelyValidTokens(20_000, null);
    expect(tokens).toBeNull();
    expect(exchangeCount).toBe(2);
    expect(session.isKnownToBeInvalid()).toBe(true);
  });

  it("treats a missing provider token as transient while the provider still reports a session", async () => {
    let providerToken: string | null = null;
    let exchangeCount = 0;
    const clientApp = new StackClientApp({
      automaticSideEffects: false,
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: clerkTokenStore({
        getSessionId: () => "clerk-session",
        getToken: async () => providerToken,
      }),
      redirectMethod: "none",
    });
    const clientInterface = Reflect.get(clientApp, "_interface");
    Reflect.set(clientInterface, "exchangeExternalAuthToken", async () => {
      exchangeCount += 1;
      return {
        status: "ok",
        data: {
          accessToken: createAccessTokenString("hexclave-external-session"),
          sessionId: "hexclave-external-session",
          userId: "user-id",
        },
      };
    });

    const getSession = Reflect.get(clientApp, "_getSession");
    const session = await getSession.call(clientApp);
    // The provider SDK is still initializing (session reported, but no token yet): the fetch must
    // fail loudly instead of permanently invalidating the session.
    await expect(session.getOrFetchLikelyValidTokens(20_000, null)).rejects.toThrow("external token store returned no token");
    expect(session.isKnownToBeInvalid()).toBe(false);
    expect(exchangeCount).toBe(0);

    providerToken = "clerk-token";
    const tokens = await session.getOrFetchLikelyValidTokens(20_000, null);
    expect(tokens).not.toBeNull();
    expect(exchangeCount).toBe(1);
  });

  it("rejects signing out an external session without revoking the Hexclave session", async () => {
    const clientApp = new StackClientApp({
      automaticSideEffects: false,
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: clerkTokenStore({
        getSessionId: () => "clerk-session",
        getToken: async () => "clerk-token",
      }),
      redirectMethod: "none",
    });
    const clientInterface = Reflect.get(clientApp, "_interface");
    let hexclaveSignOutCount = 0;
    Reflect.set(clientInterface, "signOut", async () => {
      hexclaveSignOutCount += 1;
    });
    Reflect.set(clientApp, "_redirectToDefaultAfterSignOut", async () => {});

    const getSession = Reflect.get(clientApp, "_getSession");
    const session = await getSession.call(clientApp);
    const signOut = Reflect.get(clientApp, "_signOut");
    await expect(signOut.call(clientApp, session)).rejects.toThrow(
      "Cannot sign out an externally authenticated session through Hexclave",
    );

    expect(hexclaveSignOutCount).toBe(0);
  });
});
