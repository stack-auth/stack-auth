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
    const freshAccessToken = createAccessTokenString("fresh-refresh-token-id");
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: {
        accessToken: createAccessTokenString("stale-refresh-token-id"),
        refreshToken: "stale-refresh-token",
      },
      redirectMethod: "none",
      noAutomaticPrefetch: true,
    });

    const clientInterface = Reflect.get(clientApp, "_interface");
    const originalSendClientRequest = Reflect.get(clientInterface, "sendClientRequest");
    const originalFetchNewAccessToken = Reflect.get(clientInterface, "fetchNewAccessToken");
    const capturedRefreshTokens: string[] = [];
    const capturedAccessTokenRefreshTokenIds: string[] = [];
    const refreshedRawRefreshTokens: string[] = [];

    Reflect.set(clientInterface, "sendClientRequest", async (_path: unknown, _requestOptions: unknown, session: unknown) => {
      const getRefreshToken = Reflect.get(session ?? {}, "getRefreshToken");
      const getOrFetchLikelyValidTokens = Reflect.get(session ?? {}, "getOrFetchLikelyValidTokens");
      if (typeof getRefreshToken !== "function") {
        throw new Error("Expected cross-domain auth to pass a session to the client interface.");
      }
      if (typeof getOrFetchLikelyValidTokens !== "function") {
        throw new Error("Expected cross-domain auth to pass a session with token accessors.");
      }
      const refreshToken = getRefreshToken.call(session);
      const refreshTokenString = Reflect.get(refreshToken ?? {}, "token");
      if (typeof refreshTokenString !== "string") {
        throw new Error("Expected cross-domain auth to pass a refresh-token-backed session.");
      }
      capturedRefreshTokens.push(refreshTokenString);
      const tokens = await getOrFetchLikelyValidTokens.call(session, 0, null);
      capturedAccessTokenRefreshTokenIds.push(tokens.accessToken.payload.refresh_token_id);
      return {
        ok: true,
        json: async () => ({ redirect_url: "https://example.com/handler/oauth-callback?code=handoff-code&state=handoff-state" }),
      };
    });
    Reflect.set(clientInterface, "fetchNewAccessToken", async (refreshToken: unknown) => {
      const refreshTokenString = Reflect.get(refreshToken ?? {}, "token");
      if (typeof refreshTokenString !== "string") {
        throw new Error("Expected refresh token while fetching a new access token.");
      }
      refreshedRawRefreshTokens.push(refreshTokenString);
      return AccessToken.createIfValid(freshAccessToken) ?? (() => {
        throw new Error("Expected test access token to be valid");
      })();
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
          accessToken: createAccessTokenString("fresh-stale-refresh-token-id"),
          refreshToken: "fresh-refresh-token",
        },
      })).resolves.toBe("https://example.com/handler/oauth-callback?code=handoff-code&state=handoff-state");
    } finally {
      Reflect.set(clientInterface, "sendClientRequest", originalSendClientRequest);
      Reflect.set(clientInterface, "fetchNewAccessToken", originalFetchNewAccessToken);
    }

    expect(refreshedRawRefreshTokens).toEqual(["fresh-refresh-token"]);
    expect(capturedRefreshTokens).toEqual(["fresh-refresh-token"]);
    expect(capturedAccessTokenRefreshTokenIds).toEqual(["fresh-refresh-token-id"]);
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
    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(null);
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
    const clientInterface = Reflect.get(clientApp, "_interface");
    const originalFetchNewAccessToken = Reflect.get(clientInterface, "fetchNewAccessToken");
    Reflect.set(clientInterface, "fetchNewAccessToken", async () => {
      return AccessToken.createIfValid(hostedAccessToken) ?? (() => {
        throw new Error("Expected test access token to be valid");
      })();
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
      Reflect.set(clientInterface, "fetchNewAccessToken", originalFetchNewAccessToken);
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(tokenStore.get()).toEqual({
      refreshToken: null,
      accessToken: null,
    });
    expect(new URL(redirectedUrl).origin).toBe("https://demo.stack-auth.com");
  });

  it("uses the latest browser refresh cookie before computing nested cross-domain session IDs", async () => {
    const projectId = "00000000-0000-4000-8000-000000000007";
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: "https://demo.stack-auth.com/",
        protocol: "https:",
        hostname: "demo.stack-auth.com",
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as any;

    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId,
      publishableClientKey: "stack-pk-test",
      tokenStore: "cookie",
      redirectMethod: "none",
      noAutomaticPrefetch: true,
    });
    const clientInterface = Reflect.get(clientApp, "_interface");
    const originalFetchNewAccessToken = Reflect.get(clientInterface, "fetchNewAccessToken");
    const refreshedRawRefreshTokens: string[] = [];

    // Cookie-store writes queue a background trusted-parent-domain lookup. Without this stub, that
    // lookup fetches the (unreachable) baseUrl with retries while holding the global store lock,
    // which starves any later test that needs the write lock (e.g. signOut). Not restored on
    // purpose: queued tasks can still run after this test body finishes.
    vi.spyOn(clientApp as any, "_getTrustedParentDomain").mockResolvedValue(null);

    try {
      const getBrowserCookieTokenStore = Reflect.get(clientApp, "_getBrowserCookieTokenStore");
      if (typeof getBrowserCookieTokenStore !== "function") {
        throw new Error("Expected StackClientApp to expose _getBrowserCookieTokenStore in tests.");
      }
      const tokenStore = getBrowserCookieTokenStore.call(clientApp);
      tokenStore.set({
        refreshToken: "old-refresh-token",
        accessToken: createAccessTokenString("old-refresh-token-id"),
      });

      document.cookie = `__Host-hexclave-refresh-${projectId}--default=${JSON.stringify({
        refresh_token: "new-refresh-token",
        updated_at_millis: 1,
      })}`;
      Reflect.set(clientInterface, "fetchNewAccessToken", async (refreshToken: unknown) => {
        const refreshTokenString = Reflect.get(refreshToken ?? {}, "token");
        if (typeof refreshTokenString !== "string") {
          throw new Error("Expected refresh token while fetching a new access token.");
        }
        refreshedRawRefreshTokens.push(refreshTokenString);
        return AccessToken.createIfValid(createAccessTokenString("new-refresh-token-id")) ?? (() => {
          throw new Error("Expected test access token to be valid");
        })();
      });

      const fetchCurrentRefreshTokenIdIfSignedIn = Reflect.get(clientApp, "_fetchCurrentRefreshTokenIdIfSignedIn");
      if (typeof fetchCurrentRefreshTokenIdIfSignedIn !== "function") {
        throw new Error("Expected StackClientApp to expose _fetchCurrentRefreshTokenIdIfSignedIn in tests.");
      }
      await expect(fetchCurrentRefreshTokenIdIfSignedIn.call(clientApp, {
        awaitPendingAuthResolutions: false,
      })).resolves.toBe("new-refresh-token-id");
    } finally {
      Reflect.set(clientInterface, "fetchNewAccessToken", originalFetchNewAccessToken);
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(refreshedRawRefreshTokens).toEqual(["new-refresh-token"]);
  });

  it("does not re-bounce nested cross-domain auth after the OAuth callback consumed code+state from the URL", async () => {
    const projectId = "00000000-0000-4000-8000-000000000008";
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;

    const strippedUrl = new URL(`https://${projectId}.example-stack-hosted.test/handler/sign-in`);
    strippedUrl.searchParams.set("stack_nested_cross_domain_auth_refresh_token_id", "source-refresh-token-id");
    strippedUrl.searchParams.set("stack_nested_cross_domain_auth_callback_url", "https://demo.stack-auth.com/");
    const urlAtConstructionTime = new URL(strippedUrl);
    urlAtConstructionTime.searchParams.set("code", "one-time-code");
    urlAtConstructionTime.searchParams.set("state", "nested-oauth-state");

    // Construct before installing the window mock so the constructor does not schedule its own
    // nested-auth resolution; the assertions below drive the handler explicitly.
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId,
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "window",
      noAutomaticPrefetch: true,
    });

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: strippedUrl.toString(),
        replace: () => {
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(null);
    vi.spyOn(clientApp as any, "_getCrossDomainHandoffParamsForRedirect").mockResolvedValue({
      state: "fresh-nested-state",
      codeChallenge: "fresh-nested-code-challenge",
    });
    vi.spyOn(clientApp as any, "_isTrusted").mockResolvedValue(true);

    try {
      // Without the construction-time URL, the handler re-bounces (location.replace aborts).
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
      // With it, the in-flight OAuth callback wins and the handler stands down.
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth(urlAtConstructionTime)).resolves.toBe(false);
      // The live-URL guard must also stand down on its own when code+state are still present.
      (globalThis.window as any).location.href = urlAtConstructionTime.toString();
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).resolves.toBe(false);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });

  it("passes the construction-time URL to the nested cross-domain auth handler", async () => {
    const projectId = "00000000-0000-4000-8000-000000000009";
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;

    const callbackUrl = new URL(`https://${projectId}.example-stack-hosted.test/handler/sign-in`);
    callbackUrl.searchParams.set("stack_nested_cross_domain_auth_refresh_token_id", "source-refresh-token-id");
    callbackUrl.searchParams.set("code", "one-time-code");
    callbackUrl.searchParams.set("state", "nested-oauth-state");
    const strippedUrl = new URL(callbackUrl);
    strippedUrl.searchParams.delete("code");
    strippedUrl.searchParams.delete("state");

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: callbackUrl.toString(),
      },
    } as any;

    const nestedAuthSpy = vi.spyOn(StackClientApp.prototype as any, "_maybeHandleNestedCrossDomainAuth").mockResolvedValue(false);

    try {
      new StackClientApp({
        baseUrl: "http://localhost:12345",
        projectId,
        publishableClientKey: "stack-pk-test",
        tokenStore: "memory",
        redirectMethod: "window",
        noAutomaticPrefetch: true,
      });

      // Simulate consumeOAuthCallbackQueryParams stripping code+state before microtasks run.
      (globalThis.window as any).location.href = strippedUrl.toString();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(nestedAuthSpy).toHaveBeenCalledTimes(1);
      const urlArgument = nestedAuthSpy.mock.calls[0][0] as URL;
      expect(urlArgument).toBeInstanceOf(URL);
      expect(urlArgument.searchParams.get("code")).toBe("one-time-code");
      expect(urlArgument.searchParams.get("state")).toBe("nested-oauth-state");
    } finally {
      nestedAuthSpy.mockRestore();
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });

  it("redirects hosted current-page OAuth callback errors to the hosted error handler during startup", async () => {
    const projectId = "00000000-0000-4000-8000-000000000010";
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const callbackUrl = new URL("https://demo.stack-auth.com/dashboard");
    callbackUrl.searchParams.set("errorCode", "SIGN_UP_REJECTED");
    callbackUrl.searchParams.set("message", "Your sign up was rejected by an administrator's sign-up rule.");
    callbackUrl.searchParams.set("details", JSON.stringify({
      message: "Your sign up was rejected by an administrator's sign-up rule.",
    }));
    let currentHref = callbackUrl.toString();
    let redirectedUrl = "";
    const redirectSpy = vi.spyOn(StackClientApp.prototype as any, "_redirectTo").mockImplementation(async (options: { url: string | URL }) => {
      redirectedUrl = options.url.toString();
    });

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        get href() {
          return currentHref;
        },
        set href(value: string) {
          currentHref = value;
        },
        origin: callbackUrl.origin,
      },
      history: {
        replaceState: (_state: unknown, _title: string, url: string) => {
          currentHref = new URL(url, currentHref).toString();
        },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as any;

    try {
      new StackClientApp({
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

      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      redirectSpy.mockRestore();
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    const errorUrl = new URL(redirectedUrl);
    expect(errorUrl.origin).toBe(`https://${projectId}.built-with-stack-auth.com`);
    expect(errorUrl.pathname).toBe("/handler/error");
    expect(errorUrl.searchParams.get("errorCode")).toBe("SIGN_UP_REJECTED");
    expect(errorUrl.searchParams.get("message")).toBe("Your sign up was rejected by an administrator's sign-up rule.");
    expect(new URL(currentHref).searchParams.has("errorCode")).toBe(false);
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

  it("throws when public app.urls reads would return hosted component URLs", () => {
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000003",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "window",
      urls: {
        default: { type: "hosted" },
      },
      noAutomaticPrefetch: true,
    });

    expect(() => clientApp.urls.signIn).toThrowError(/app\.urls\.signIn cannot be used when this app is configured to use hosted components.*Use app\.redirectToSignIn\(\) instead/s);
    expect(() => clientApp.urls.signOut).toThrowError(/app\.urls\.signOut cannot be used when this app is configured to use hosted components.*Use app\.redirectToSignOut\(\) instead/s);
    expect(clientApp.urls.afterSignIn).toBe("/");
  });

  it("keeps public app.urls reads available for non-hosted targets", () => {
    const clientApp = new StackClientApp({
      baseUrl: "http://localhost:12345",
      projectId: "00000000-0000-4000-8000-000000000003",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "window",
      urls: {
        handler: "/custom-handler",
      },
      noAutomaticPrefetch: true,
    });

    expect(clientApp.urls.signIn).toBe("/custom-handler/sign-in");
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
      await expect(signOut.call(clientApp, Reflect.get(clientInterface, "createSession").call(clientInterface, {
        refreshToken: null,
      }))).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
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
