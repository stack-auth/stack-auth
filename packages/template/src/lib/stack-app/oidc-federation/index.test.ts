import { afterEach, describe, expect, it, vi } from "vitest";
import { createOidcFederationTokenStoreForServerApp } from "./index";

describe("createOidcFederationTokenStoreForServerApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses x-stack-branch-id from extraRequestHeaders when exchanging the OIDC token", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async (input, _init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.example.com/api/v1/auth/oidc-federation/exchange") {
        return new Response(JSON.stringify({ access_token: "stack-token", expires_in: 300 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokenStore = createOidcFederationTokenStoreForServerApp({
      projectId: "internal",
      apiBaseUrl: "https://api.example.com",
      extraRequestHeaders: {
        "x-stack-branch-id": "preview",
      },
      getOidcToken: async () => "oidc-token",
    });

    await tokenStore.getAccessToken();

    // Wrap in `Headers` so we go through the standard, typesafe lookup path regardless of which
    // shape (Record / Headers / [string, string][]) the SDK passed.
    const sentHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sentHeaders.get("x-stack-branch-id")).toBe("preview");
  });
});
