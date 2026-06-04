import { describe, expect, it, vi } from "vitest";
import { StackClientApp } from "../interfaces/client-app";

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
});
