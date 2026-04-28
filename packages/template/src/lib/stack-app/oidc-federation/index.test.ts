import { afterEach, describe, expect, it, vi } from "vitest";
import { createOidcFederationTokenStoreForServerApp } from "./index";

describe("createOidcFederationTokenStoreForServerApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses x-stack-branch-id from extraRequestHeaders when exchanging the OIDC token", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async (input, _init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.example.com/api/latest/auth/oidc-federation/exchange") {
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

  it("reuses x-stack-branch-id case-insensitively", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async () => {
      return new Response(JSON.stringify({ access_token: "stack-token", expires_in: 300 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokenStore = createOidcFederationTokenStoreForServerApp({
      projectId: "internal",
      apiBaseUrl: "https://api.example.com",
      extraRequestHeaders: {
        "X-Stack-Branch-Id": "preview",
      },
      getOidcToken: async () => "oidc-token",
    });

    await tokenStore.getAccessToken();

    const sentHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sentHeaders.get("x-stack-branch-id")).toBe("preview");
  });

  it("continues serving a still-valid cached token when refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    try {
      const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async () => {
        return new Response(JSON.stringify({ access_token: "stack-token", expires_in: 100 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const getOidcToken = vi.fn(async () => "oidc-token");

      const tokenStore = createOidcFederationTokenStoreForServerApp({
        projectId: "internal",
        apiBaseUrl: "https://api.example.com",
        extraRequestHeaders: {},
        getOidcToken,
      });

      await expect(tokenStore.getAccessToken()).resolves.toBe("stack-token");
      vi.advanceTimersByTime(81_000);
      getOidcToken.mockRejectedValueOnce(new Error("provider down"));

      await expect(tokenStore.getAccessToken()).resolves.toBe("stack-token");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects non-object exchange JSON with a controlled exchange error", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async () => {
      return new Response("null", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokenStore = createOidcFederationTokenStoreForServerApp({
      projectId: "internal",
      apiBaseUrl: "https://api.example.com",
      extraRequestHeaders: {},
      getOidcToken: async () => "oidc-token",
    });

    await expect(tokenStore.getAccessToken()).rejects.toMatchObject({
      name: "OidcFederationExchangeError",
      message: "OIDC federation exchange response must be a JSON object",
    });
    await expect(tokenStore.getAccessToken()).rejects.toMatchObject({
      name: "OidcFederationExchangeError",
      message: "OIDC federation exchange response must be a JSON object",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
