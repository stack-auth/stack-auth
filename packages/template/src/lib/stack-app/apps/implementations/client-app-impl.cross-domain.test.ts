import { describe, expect, it } from "vitest";
import { StackClientApp } from "../interfaces/client-app";

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
});
