// @vitest-environment jsdom

import { HexclaveClientInterface, KnownErrors } from "@hexclave/shared";
import { describe, expect, it, vi } from "vitest";
import { callOAuthCallback, getNewOAuthProviderOrScopeUrl } from "./auth";

vi.mock("./cookie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cookie")>();
  return {
    ...actual,
    saveVerifierAndState: async () => ({
      codeChallenge: "<stripped code challenge>",
      state: "<stripped state>",
    }),
  };
});

function createTestInterface() {
  return new HexclaveClientInterface({
    clientVersion: "test",
    getBaseUrl: () => "https://api.example.com",
    getApiUrls: () => ["https://api.example.com"],
    extraRequestHeaders: {},
    projectId: "00000000-0000-4000-8000-000000000000",
    publishableClientKey: "pck_test",
  });
}

describe("getNewOAuthProviderOrScopeUrl", () => {
  it("returns the OAuth URL without performing navigation", async () => {
    window.history.replaceState({}, "", "/account?after_auth_return_to=%2Fsettings");

    const iface = createTestInterface();
    const session = iface.createSession({ refreshToken: null, accessToken: null });

    const location = await getNewOAuthProviderOrScopeUrl(
      iface,
      {
        provider: "github",
        redirectUrl: "/handler/oauth-callback",
        errorRedirectUrl: "/handler/error",
        providerScope: "repo user",
      },
      session,
    );

    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.example.com/api/v1/auth/oauth/authorize/github");
    expect(Object.fromEntries(url.searchParams.entries())).toMatchInlineSnapshot(`
      {
        "after_callback_redirect_url": "http://localhost:3000/account?after_auth_return_to=%2Fsettings",
        "client_id": "00000000-0000-4000-8000-000000000000",
        "client_secret": "pck_test",
        "code_challenge": "<stripped code challenge>",
        "code_challenge_method": "S256",
        "error_redirect_url": "http://localhost:3000/handler/error?after_auth_return_to=%2Fsettings",
        "grant_type": "authorization_code",
        "provider_scope": "repo user",
        "redirect_uri": "http://localhost:3000/handler/oauth-callback?after_auth_return_to=%2Fsettings",
        "response_type": "code",
        "scope": "legacy",
        "state": "<stripped state>",
        "type": "link",
      }
    `);
  });
});

describe("callOAuthCallback", () => {
  it("turns provider access denial callback params into a known error", async () => {
    window.history.replaceState({}, "", "/handler/oauth-callback?error=access_denied&error_description=User+cancelled");

    await expect(callOAuthCallback(createTestInterface(), "/handler/oauth-callback"))
      .rejects.toSatisfy((error: unknown) => KnownErrors.OAuthProviderAccessDenied.isInstance(error));
    expect(window.location.href).toBe("http://localhost:3000/handler/oauth-callback");
  });

  it("turns generic provider error callback params into a known error", async () => {
    window.history.replaceState({}, "", "/handler/oauth-callback?error=server_error&error_description=Provider+failed");

    await expect(callOAuthCallback(createTestInterface(), "/handler/oauth-callback"))
      .rejects.toSatisfy((error: unknown) => KnownErrors.OAuthProviderTemporarilyUnavailable.isInstance(error));
    expect(window.location.href).toBe("http://localhost:3000/handler/oauth-callback");
  });
});
