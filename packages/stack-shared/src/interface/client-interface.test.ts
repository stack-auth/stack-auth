import { afterEach, describe, expect, it, vi } from "vitest";
import { KnownErrors } from "../known-errors";
import { InternalSession } from "../sessions";
import { Result } from "../utils/results";
import { StackClientInterface } from "./client-interface";

function createClientInterface(options?: {
  baseUrl?: string,
  apiUrls?: string[],
  probeRate?: number,
}) {
  const apiUrls = options?.apiUrls ?? [options?.baseUrl ?? "https://api.example.com"];
  return new StackClientInterface({
    clientVersion: "test",
    getBaseUrl: () => apiUrls[0],
    getApiUrls: () => apiUrls,
    probeRate: options?.probeRate,
    extraRequestHeaders: {},
    projectId: "project-id",
    publishableClientKey: "publishable-client-key",
  });
}

function createSession() {
  return new InternalSession({
    refreshAccessTokenCallback: async () => null,
    refreshToken: null,
    accessToken: null,
  });
}

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createKnownErrorResponse(error: InstanceType<typeof KnownErrors[keyof typeof KnownErrors]>): Response {
  return new Response(JSON.stringify({
    code: error.errorCode,
    message: error.message,
    details: error.details,
  }), {
    status: error.statusCode,
    headers: {
      "Content-Type": "application/json",
      "x-stack-known-error": error.errorCode,
    },
  });
}

function getRequestBody(fetchMock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const requestInit = fetchMock.mock.calls[0]?.[1];
  if (requestInit == null || typeof requestInit !== "object" || !("body" in requestInit)) {
    throw new Error("Expected request init to include a body");
  }

  const requestBody = requestInit.body;
  if (requestBody == null || typeof requestBody !== "string") {
    throw new Error("Expected request body to be a JSON string");
  }

  const parsed = JSON.parse(requestBody);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected parsed request body to be an object");
  }

  return parsed;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StackClientInterface bot challenge compatibility", () => {
  it("omits bot challenge from magic link requests when no token is provided", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ nonce: "nonce" }));
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    await iface.sendMagicLinkEmail("user@example.com", "https://app.example.com/callback");

    expect(getRequestBody(fetchMock)).toStrictEqual({
      email: "user@example.com",
      callback_url: "https://app.example.com/callback",
    });
  });

  it("serializes visible bot challenge retry fields for magic link requests", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ nonce: "nonce" }));
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    await iface.sendMagicLinkEmail("user@example.com", "https://app.example.com/callback", {
      token: " visible-token ",
      phase: "visible",
    });

    expect(getRequestBody(fetchMock)).toStrictEqual({
      email: "user@example.com",
      callback_url: "https://app.example.com/callback",
      bot_challenge_token: "visible-token",
      bot_challenge_phase: "visible",
    });
  });

  it("serializes bot challenge unavailability for magic link requests", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ nonce: "nonce" }));
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    await iface.sendMagicLinkEmail("user@example.com", "https://app.example.com/callback", {
      phase: "visible",
    });

    expect(getRequestBody(fetchMock)).toStrictEqual({
      email: "user@example.com",
      callback_url: "https://app.example.com/callback",
      bot_challenge_unavailable: "true",
    });
  });

  it("serializes explicit bot challenge unavailability for magic link requests", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ nonce: "nonce" }));
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    await iface.sendMagicLinkEmail("user@example.com", "https://app.example.com/callback", {
      unavailable: true,
    });

    expect(getRequestBody(fetchMock)).toStrictEqual({
      email: "user@example.com",
      callback_url: "https://app.example.com/callback",
      bot_challenge_unavailable: "true",
    });
  });

  it("returns BotChallengeFailed as a Result error for magic link requests", async () => {
    const fetchMock = vi.fn(async () => createKnownErrorResponse(
      new KnownErrors.BotChallengeFailed("Visible bot challenge verification failed"),
    ));
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    const result = await iface.sendMagicLinkEmail("user@example.com", "https://app.example.com/callback", {
      phase: "visible",
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error("Expected magic link request to fail with BotChallengeFailed");
    }
    expect(result.error).toBeInstanceOf(KnownErrors.BotChallengeFailed);
  });

  it("omits bot challenge from credential signup requests when no token is provided", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({
      access_token: "access-token",
      refresh_token: "refresh-token",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    await iface.signUpWithCredential(
      "user@example.com",
      "password",
      undefined,
      createSession(),
      undefined,
    );

    expect(getRequestBody(fetchMock)).toStrictEqual({
      email: "user@example.com",
      password: "password",
    });
  });

  it("returns BotChallengeFailed as a Result error for credential signup requests", async () => {
    const fetchMock = vi.fn(async () => createKnownErrorResponse(
      new KnownErrors.BotChallengeFailed("Visible bot challenge verification failed"),
    ));
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    const result = await iface.signUpWithCredential(
      "user@example.com",
      "password",
      undefined,
      createSession(),
      {
        phase: "visible",
      },
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error("Expected credential signup to fail with BotChallengeFailed");
    }
    expect(result.error).toBeInstanceOf(KnownErrors.BotChallengeFailed);
  });

  it("omits bot challenge from OAuth URLs when no token is provided", async () => {
    const iface = createClientInterface();
    const oauthUrl = await iface.getOAuthUrl({
      provider: "github",
      redirectUrl: "https://app.example.com/oauth/callback",
      errorRedirectUrl: "https://app.example.com/error",
      codeChallenge: "code-challenge",
      state: "state",
      type: "authenticate",
      session: createSession(),
    });

    expect(new URL(oauthUrl).searchParams.has("bot_challenge_token")).toBe(false);
  });

  it("serializes visible bot challenge retry fields in OAuth URLs", async () => {
    const iface = createClientInterface();
    const oauthUrl = await iface.getOAuthUrl({
      provider: "github",
      redirectUrl: "https://app.example.com/oauth/callback",
      errorRedirectUrl: "https://app.example.com/error",
      codeChallenge: "code-challenge",
      state: "state",
      type: "authenticate",
      botChallenge: {
        token: "visible-token",
        phase: "visible",
      },
      session: createSession(),
    });

    expect(Object.fromEntries(new URL(oauthUrl).searchParams.entries())).toMatchObject({
      bot_challenge_token: "visible-token",
      bot_challenge_phase: "visible",
    });
  });

  it("serializes bot challenge unavailability in OAuth URLs", async () => {
    const iface = createClientInterface();
    const oauthUrl = await iface.getOAuthUrl({
      provider: "github",
      redirectUrl: "https://app.example.com/oauth/callback",
      errorRedirectUrl: "https://app.example.com/error",
      codeChallenge: "code-challenge",
      state: "state",
      type: "authenticate",
      botChallenge: {
        phase: "visible",
      },
      session: createSession(),
    });

    expect(Object.fromEntries(new URL(oauthUrl).searchParams.entries())).toMatchObject({
      bot_challenge_unavailable: "true",
    });
  });

  it("authorizes OAuth via a JSON response instead of relying on manual redirects", async () => {
    const fetchCalls: [input: RequestInfo | URL, init?: RequestInit][] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push([input, init]);
      return createJsonResponse({
        location: "https://accounts.example.com/oauth/authorize",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {} as Window & typeof globalThis);

    const iface = createClientInterface();
    const result = await iface.authorizeOAuth({
      provider: "github",
      redirectUrl: "https://app.example.com/oauth/callback",
      errorRedirectUrl: "https://app.example.com/error",
      codeChallenge: "code-challenge",
      state: "state",
      type: "authenticate",
      session: createSession(),
    });

    expect(Result.orThrow(result)).toBe("https://accounts.example.com/oauth/authorize");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchCalls[0] ?? [];
    if (!(typeof requestUrl === "string" || requestUrl instanceof URL)) {
      throw new Error("Expected authorizeOAuth to call fetch with a URL");
    }
    expect(new URL(requestUrl.toString()).searchParams.get("stack_response_mode")).toBe("json");
    expect(requestInit).toMatchObject({
      method: "GET",
    });
    expect(requestInit).not.toHaveProperty("credentials");
  });

  it("returns BotChallengeFailed as a Result error for OAuth authorization", async () => {
    const fetchMock = vi.fn(async () => createKnownErrorResponse(
      new KnownErrors.BotChallengeFailed("Visible bot challenge verification failed"),
    ));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {} as Window & typeof globalThis);

    const iface = createClientInterface();
    const result = await iface.authorizeOAuth({
      provider: "github",
      redirectUrl: "https://app.example.com/oauth/callback",
      errorRedirectUrl: "https://app.example.com/error",
      codeChallenge: "code-challenge",
      state: "state",
      type: "authenticate",
      session: createSession(),
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error("Expected OAuth authorization to fail with BotChallengeFailed");
    }
    expect(result.error).toBeInstanceOf(KnownErrors.BotChallengeFailed);
  });

  it("serializes bot challenge unavailability for credential signup requests", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({
      access_token: "access-token",
      refresh_token: "refresh-token",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    await iface.signUpWithCredential(
      "user@example.com",
      "password",
      undefined,
      createSession(),
      {
        phase: "visible",
      },
    );

    expect(getRequestBody(fetchMock)).toStrictEqual({
      email: "user@example.com",
      password: "password",
      bot_challenge_unavailable: "true",
    });
  });
});

describe("_withFallback", () => {
  it("uses primary URL when no fallback is configured", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface();
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(urls.every(u => u.startsWith("https://api.example.com/api/v1"))).toBe(true);
  });

  it("uses primary URL when it is healthy", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({ apiUrls: ["https://api.example.com", "https://fallback.example.com"] });
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(urls.every(u => u.startsWith("https://api.example.com"))).toBe(true);
  });

  it("falls back on network error", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      urls.push(url);
      if (url.startsWith("https://api.example.com")) {
        throw new TypeError("Failed to fetch");
      }
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({ apiUrls: ["https://api.example.com", "https://fallback.example.com"] });
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(urls.some(u => u.startsWith("https://fallback.example.com"))).toBe(true);
  });

  it("makes only 1 request to primary before falling back", async () => {
    let primaryHits = 0;
    let fallbackHits = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith("https://api.example.com")) {
        primaryHits++;
        throw new TypeError("Failed to fetch");
      }
      fallbackHits++;
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({ apiUrls: ["https://api.example.com", "https://fallback.example.com"] });
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(primaryHits).toBe(1);
    expect(fallbackHits).toBe(1);
  });

  it("does not fall back on KnownError", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      return createKnownErrorResponse(new KnownErrors.UserNotFound());
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({ apiUrls: ["https://api.example.com", "https://fallback.example.com"] });
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await expect(iface.sendClientRequest("/users/me", { method: "GET" }, session)).rejects.toThrow();

    expect(urls.every(u => u.startsWith("https://api.example.com"))).toBe(true);
  });

  it("enters sticky fallback mode after first failover", async () => {
    const iface = createClientInterface({
      apiUrls: ["https://api.example.com", "https://fallback.example.com"],
      probeRate: 0,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith("https://api.example.com")) {
        throw new TypeError("Failed to fetch");
      }
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    // Second request should go directly to fallback (probeRate=0, no probing)
    const urls: string[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      return createJsonResponse({ display_name: "test" });
    });

    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(urls.every(u => u.startsWith("https://fallback.example.com"))).toBe(true);
  });

  it("exits sticky mode when primary probe succeeds", async () => {
    const iface = createClientInterface({
      apiUrls: ["https://api.example.com", "https://fallback.example.com"],
      probeRate: 1,
    });

    let primaryDown = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith("https://api.example.com") && primaryDown) {
        throw new TypeError("Failed to fetch");
      }
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = iface.createSession({ refreshToken: null, accessToken: null });

    // Enter sticky mode
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    // Primary recovers
    primaryDown = false;

    // Probe succeeds (probeRate=1), exits sticky mode
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    // Third request should hit primary directly
    const urls: string[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      return createJsonResponse({ display_name: "test" });
    });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(urls[0]).toContain("api.example.com");
  });

  it("halves probe rate on failed probe", async () => {
    const iface = createClientInterface({
      apiUrls: ["https://api.example.com", "https://fallback.example.com"],
      probeRate: 1,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith("https://api.example.com")) {
        throw new TypeError("Failed to fetch");
      }
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = iface.createSession({ refreshToken: null, accessToken: null });

    // Enter sticky mode
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    // Failed probe: rate 1 → 0.5
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    // Failed probe: rate 0.5 → 0.25
    const randomMock = vi.spyOn(Math, "random").mockReturnValue(0.4);
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    // rate is 0.25, random=0.3 >= 0.25 → should NOT probe
    let primaryHits = 0;
    randomMock.mockReturnValue(0.3);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input.toString().startsWith("https://api.example.com")) primaryHits++;
      return createJsonResponse({ display_name: "test" });
    });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(primaryHits).toBe(0);
  });

  it("bypasses fallback when apiUrlOverride is provided", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({ apiUrls: ["https://api.example.com", "https://fallback.example.com"] });
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session, "client", "https://override.example.com/api/v1");

    expect(urls.every(u => u.startsWith("https://override.example.com"))).toBe(true);
  });

  it("throws when all URLs fail", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({ apiUrls: ["https://api.example.com", "https://fallback.example.com"] });
    const session = iface.createSession({ refreshToken: null, accessToken: null });

    await expect(iface.sendClientRequest("/users/me", { method: "GET" }, session)).rejects.toThrow();
  });

  it("iterates through all URLs for 2 passes before giving up", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({ apiUrls: ["https://api.example.com", "https://fallback.example.com"] });
    const session = iface.createSession({ refreshToken: null, accessToken: null });

    await expect(iface.sendClientRequest("/users/me", { method: "GET" }, session)).rejects.toThrow();

    // 2 passes × 2 URLs = 4 attempts total
    const primaryHits = urls.filter(u => u.startsWith("https://api.example.com")).length;
    const fallbackHits = urls.filter(u => u.startsWith("https://fallback.example.com")).length;
    expect(primaryHits).toBe(2);
    expect(fallbackHits).toBe(2);
  });

  it("iterates through 3 URLs in correct order", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      urls.push(url);
      if (url.startsWith("https://api.example.com") || url.startsWith("https://fallback1.example.com")) {
        throw new TypeError("Failed to fetch");
      }
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({
      apiUrls: ["https://api.example.com", "https://fallback1.example.com", "https://fallback2.example.com"],
    });
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    // Should try: primary → fallback1 → fallback2 (succeeds)
    expect(urls[0]).toContain("api.example.com");
    expect(urls[1]).toContain("fallback1.example.com");
    expect(urls[2]).toContain("fallback2.example.com");
  });

  it("enters sticky mode on URL index 2 with 3 URLs", async () => {
    const iface = createClientInterface({
      apiUrls: ["https://api.example.com", "https://fallback1.example.com", "https://fallback2.example.com"],
      probeRate: 0,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith("https://api.example.com") || url.startsWith("https://fallback1.example.com")) {
        throw new TypeError("Failed to fetch");
      }
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    // Second request should go directly to fallback2 (probeRate=0)
    const urls: string[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      return createJsonResponse({ display_name: "test" });
    });

    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(urls.length).toBe(1);
    expect(urls[0]).toContain("fallback2.example.com");
  });

  it("with 3 URLs, 2 passes = 6 total attempts when all fail", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(input.toString());
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({
      apiUrls: ["https://api.example.com", "https://fallback1.example.com", "https://fallback2.example.com"],
    });
    const session = iface.createSession({ refreshToken: null, accessToken: null });

    await expect(iface.sendClientRequest("/users/me", { method: "GET" }, session)).rejects.toThrow();

    // 2 passes × 3 URLs = 6 attempts
    expect(urls.length).toBe(6);
    expect(urls.filter(u => u.startsWith("https://api.example.com")).length).toBe(2);
    expect(urls.filter(u => u.startsWith("https://fallback1.example.com")).length).toBe(2);
    expect(urls.filter(u => u.startsWith("https://fallback2.example.com")).length).toBe(2);
  });

  it("single URL uses standard 5-retry behavior", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      attempts++;
      if (attempts < 3) {
        throw new TypeError("Failed to fetch");
      }
      return createJsonResponse({ display_name: "test" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const iface = createClientInterface({ apiUrls: ["https://api.example.com"] });
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session);

    expect(attempts).toBe(3);
  });
});
