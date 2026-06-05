import { describe, expect, it, vi } from "vitest";
import { AccessToken } from "@hexclave/shared/dist/sessions";
import { Store } from "@hexclave/shared/dist/utils/stores";
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

function createMockDocument(): Document {
  const cookieJar = new Map<string, string>();
  return {
    get cookie() {
      return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    set cookie(str: string) {
      const [nameValue] = str.split(";");
      const eqIndex = nameValue.indexOf("=");
      if (eqIndex < 0) return;
      cookieJar.set(nameValue.slice(0, eqIndex).trim(), nameValue.slice(eqIndex + 1).trim());
    },
    createElement: () => ({}),
  } as any;
}

describe("StackClientApp cross-domain auth", () => {
  it("uses the fresh post-auth refresh token when minting a cross-domain handoff", async () => {
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: {
        accessToken: "stale-access-token",
        refreshToken: "stale-refresh-token",
      },
      redirectMethod: "none",
      noAutomaticPrefetch: true,
    });

    const clientInterface = Reflect.get(clientApp, "_interface");
    const originalSendClientRequest = Reflect.get(clientInterface, "sendClientRequest");
    const capturedRefreshTokens: string[] = [];

    Reflect.set(clientInterface, "sendClientRequest", async (_path: unknown, _requestOptions: unknown, session: unknown) => {
      const getRefreshToken = Reflect.get(session ?? {}, "getRefreshToken");
      if (typeof getRefreshToken !== "function") {
        throw new Error("Expected cross-domain auth to pass a session to the client interface.");
      }
      const refreshToken = getRefreshToken.call(session);
      const refreshTokenString = Reflect.get(refreshToken ?? {}, "token");
      if (typeof refreshTokenString !== "string") {
        throw new Error("Expected cross-domain auth to pass a refresh-token-backed session.");
      }
      capturedRefreshTokens.push(refreshTokenString);
      return {
        ok: true,
        json: async () => ({ redirect_url: "https://example.com/handler/oauth-callback?code=handoff-code&state=handoff-state" }),
      };
    });

    try {
      const createCrossDomainAuthRedirectUrl = Reflect.get(clientApp, "_createCrossDomainAuthRedirectUrl");
      if (typeof createCrossDomainAuthRedirectUrl !== "function") {
        throw new Error("Expected StackClientApp to expose _createCrossDomainAuthRedirectUrl in tests.");
      }

      await expect(createCrossDomainAuthRedirectUrl.call(clientApp, {
        redirectUri: "https://example.com/handler/oauth-callback",
        state: "handoff-state",
        codeChallenge: "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789-._~",
        afterCallbackRedirectUrl: "https://example.com/account-settings",
        overrideTokenStoreInit: {
          accessToken: "fresh-access-token",
          refreshToken: "fresh-refresh-token",
        },
      })).resolves.toBe("https://example.com/handler/oauth-callback?code=handoff-code&state=handoff-state");
    } finally {
      Reflect.set(clientInterface, "sendClientRequest", originalSendClientRequest);
    }

    expect(capturedRefreshTokens).toEqual(["fresh-refresh-token"]);
  });

  it("uses a fresh nested OAuth state while preserving the outer cross-domain return state", async () => {
    const projectId = "00000000-0000-4000-8000-000000000002";
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId,
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "window",
      urls: {
        default: { type: "hosted" },
      },
      noAutomaticPrefetch: true,
    });
    const outerState = "outer-cross-domain-state";
    const outerCodeChallenge = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789-._~";
    const currentUrl = new URL(`https://${projectId}.example-stack-hosted.test/handler/sign-in`);
    currentUrl.searchParams.set("after_auth_return_to", `https://demo.stack-auth.com/?hexclave_cross_domain_auth=1&hexclave_cross_domain_state=${outerState}`);
    currentUrl.searchParams.set("hexclave_cross_domain_state", outerState);
    currentUrl.searchParams.set("hexclave_cross_domain_code_challenge", outerCodeChallenge);
    currentUrl.searchParams.set("hexclave_cross_domain_after_callback_redirect_url", "https://demo.stack-auth.com/");
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_refresh_token_id", "source-session");
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_callback_url", "https://demo.stack-auth.com/");

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";
    vi.spyOn(clientApp as any, "_getCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(null);
    vi.spyOn(clientApp as any, "_getCrossDomainHandoffParamsForRedirect").mockResolvedValue({
      state: "fresh-nested-state",
      codeChallenge: "fresh-nested-code-challenge",
    });
    vi.spyOn(clientApp as any, "_isTrusted").mockResolvedValue(true);

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentUrl.toString(),
        replace: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    const redirectUrl = new URL(redirectedUrl);
    expect(redirectUrl.searchParams.get("state")).toBe("fresh-nested-state");
    expect(redirectUrl.searchParams.get("code_challenge")).toBe("fresh-nested-code-challenge");
    const redirectUri = new URL(redirectUrl.searchParams.get("redirect_uri") ?? "");
    expect(redirectUri.searchParams.get("hexclave_cross_domain_state")).toBe(outerState);
    expect(redirectUri.searchParams.get("hexclave_cross_domain_code_challenge")).toBe(outerCodeChallenge);
    expect(redirectUri.searchParams.get("hexclave_cross_domain_after_callback_redirect_url")).toBe("https://demo.stack-auth.com/");
  });

  it("clears a stale target-domain session before deferring to the source-domain session", async () => {
    const projectId = "00000000-0000-4000-8000-000000000006";
    const hostedAccessToken = createAccessTokenString("hosted-old-refresh-token-id");
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId,
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "window",
      urls: {
        default: { type: "hosted" },
      },
      noAutomaticPrefetch: true,
    });
    const tokenStore = Reflect.get(clientApp, "_memoryTokenStore");
    if (!(tokenStore instanceof Store)) {
      throw new Error("Expected StackClientApp to use a memory token store in this test.");
    }
    tokenStore.set({
      refreshToken: "hosted-old-refresh-token",
      accessToken: hostedAccessToken,
    });

    const currentUrl = new URL(`https://${projectId}.example-stack-hosted.test/handler/sign-in`);
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_refresh_token_id", "source-anonymous-refresh-token-id");
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_callback_url", "https://demo.stack-auth.com/handler/oauth-callback");
    currentUrl.searchParams.set("hexclave_cross_domain_state", "outer-state");
    currentUrl.searchParams.set("hexclave_cross_domain_code_challenge", "outer-code-challenge");
    currentUrl.searchParams.set("hexclave_cross_domain_after_callback_redirect_url", "https://demo.stack-auth.com/app");

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";
    vi.spyOn(clientApp as any, "_isTrusted").mockResolvedValue(true);

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentUrl.toString(),
        replace: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(tokenStore.get()).toEqual({
      refreshToken: null,
      accessToken: null,
    });
    expect(new URL(redirectedUrl).origin).toBe("https://demo.stack-auth.com");
  });

  it("uses direct sign-out instead of hosted sign-out redirects when code execution is available", async () => {
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000003",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "window",
      urls: {
        handler: "/handler",
        signOut: { type: "hosted" },
      },
      noAutomaticPrefetch: true,
    });
    const signOutSpy = vi.spyOn(clientApp, "signOut").mockRejectedValue(new Error("INTENTIONAL_TEST_ABORT"));

    try {
      await expect(clientApp.redirectToSignOut()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
      expect(signOutSpy).toHaveBeenCalledWith();
    } finally {
      signOutSpy.mockRestore();
    }
  });

  it("keeps default hosted signOut() on the source domain when afterSignOut is not configured", async () => {
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000004",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "window",
      urls: {
        default: { type: "hosted" },
      },
      noAutomaticPrefetch: true,
    });
    const currentHref = "https://demo.stack-auth.com/settings?tab=profile";

    const clientInterface = Reflect.get(clientApp, "_interface");
    const originalSignOut = Reflect.get(clientInterface, "signOut");
    Reflect.set(clientInterface, "signOut", async () => {});
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentHref,
        replace: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      const signOut = Reflect.get(clientApp, "_signOut");
      if (typeof signOut !== "function") {
        throw new Error("Expected StackClientApp to expose _signOut in tests.");
      }
      await expect(signOut.call(clientApp, {})).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      Reflect.set(clientInterface, "signOut", originalSignOut);
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(redirectedUrl).toBe("/settings?tab=profile");
  });

  it("ignores stale session callbacks after a newer refresh token owns the token store", async () => {
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000005",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "none",
      noAutomaticPrefetch: true,
    });
    const oldAccessToken = createAccessTokenString("old-refresh-token-id");
    const refreshedOldAccessToken = createAccessTokenString("refreshed-old-refresh-token-id");
    const newAccessToken = createAccessTokenString("new-refresh-token-id");
    const tokenStore = new Store({
      refreshToken: "old-refresh-token",
      accessToken: oldAccessToken,
    });
    const clientInterface = Reflect.get(clientApp, "_interface");
    const originalFetchNewAccessToken = Reflect.get(clientInterface, "fetchNewAccessToken");
    Reflect.set(clientInterface, "fetchNewAccessToken", async () => {
      return AccessToken.createIfValid(refreshedOldAccessToken) ?? (() => {
        throw new Error("Expected test access token to be valid");
      })();
    });

    try {
      const getSessionFromTokenStore = Reflect.get(clientApp, "_getSessionFromTokenStore");
      if (typeof getSessionFromTokenStore !== "function") {
        throw new Error("Expected StackClientApp to expose _getSessionFromTokenStore in tests.");
      }
      const oldSession = getSessionFromTokenStore.call(clientApp, tokenStore);
      tokenStore.set({
        refreshToken: "new-refresh-token",
        accessToken: newAccessToken,
      });

      await oldSession.fetchNewTokens();
      expect(tokenStore.get()).toEqual({
        refreshToken: "new-refresh-token",
        accessToken: newAccessToken,
      });

      oldSession.markInvalid();
      expect(tokenStore.get()).toEqual({
        refreshToken: "new-refresh-token",
        accessToken: newAccessToken,
      });
    } finally {
      Reflect.set(clientInterface, "fetchNewAccessToken", originalFetchNewAccessToken);
    }
  });
});
