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
  // ---------------------------------------------------------------------------
  // Helpers — reduce boilerplate across tests
  // ---------------------------------------------------------------------------

  /** Builds a list of N URL bases: ["https://url-0.test", "https://url-1.test", ...] */
  function urlList(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `https://url-${i}.test`);
  }

  /** Returns the index of the URL base that `fullUrl` starts with, or -1. */
  function urlIndex(urls: string[], fullUrl: string): number {
    return urls.findIndex(base => fullUrl.startsWith(base));
  }

  /** Records every fetch URL and calls `handler` to decide the outcome. */
  function mockFetch(handler: (url: string) => "ok" | "fail") {
    const log: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      log.push(url);
      if (handler(url) === "fail") throw new TypeError("Failed to fetch");
      return createJsonResponse({ display_name: "test" });
    }));
    return log;
  }

  function sendRequest(iface: StackClientInterface) {
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    return iface.sendClientRequest("/users/me", { method: "GET" }, session);
  }

  // ---------------------------------------------------------------------------
  // Single URL — no fallback
  // ---------------------------------------------------------------------------

  it("single URL uses standard 5-retry behavior", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new TypeError("Failed to fetch");
      return createJsonResponse({ display_name: "test" });
    }));

    const iface = createClientInterface({ apiUrls: urlList(1) });
    await sendRequest(iface);
    expect(attempts).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Normal mode — iterating through URLs in order
  // ---------------------------------------------------------------------------

  it("uses primary when it is healthy", async () => {
    const urls = urlList(3);
    const log = mockFetch(() => "ok");

    const iface = createClientInterface({ apiUrls: urls });
    await sendRequest(iface);

    expect(log.every(u => urlIndex(urls, u) === 0)).toBe(true);
  });

  it("tries URLs in order and succeeds on first working one", async () => {
    const urls = urlList(4);
    // url-0 and url-1 are down, url-2 is up
    const log = mockFetch((u) => urlIndex(urls, u) < 2 ? "fail" : "ok");

    const iface = createClientInterface({ apiUrls: urls });
    await sendRequest(iface);

    expect(urlIndex(urls, log[0])).toBe(0);
    expect(urlIndex(urls, log[1])).toBe(1);
    expect(urlIndex(urls, log[2])).toBe(2);
    expect(log.length).toBe(3);
  });

  it("does not fall back on KnownError", async () => {
    const urls = urlList(3);
    const log: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      log.push(input.toString());
      return createKnownErrorResponse(new KnownErrors.UserNotFound());
    }));

    const iface = createClientInterface({ apiUrls: urls });
    await expect(sendRequest(iface)).rejects.toThrow();
    expect(log.every(u => urlIndex(urls, u) === 0)).toBe(true);
  });

  it("makes 2 passes × N URLs attempts before throwing", async () => {
    for (const n of [2, 3, 5]) {
      const urls = urlList(n);
      const log = mockFetch(() => "fail");

      const iface = createClientInterface({ apiUrls: urls });
      await expect(sendRequest(iface)).rejects.toThrow();

      expect(log.length).toBe(2 * n);
      for (let i = 0; i < n; i++) {
        expect(log.filter(u => urlIndex(urls, u) === i).length).toBe(2);
      }
    }
  });

  it("bypasses fallback when apiUrlOverride is provided", async () => {
    const log: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      log.push(input.toString());
      return createJsonResponse({ display_name: "test" });
    }));

    const iface = createClientInterface({ apiUrls: urlList(3) });
    const session = iface.createSession({ refreshToken: null, accessToken: null });
    await iface.sendClientRequest("/users/me", { method: "GET" }, session, "client", "https://override.test/api/v1");

    expect(log.every(u => u.startsWith("https://override.test"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Sticky mode — remembering the working fallback
  // ---------------------------------------------------------------------------

  it("enters sticky mode: subsequent requests skip straight to the working fallback", async () => {
    const urls = urlList(4);
    const iface = createClientInterface({ apiUrls: urls, probeRate: 0 });

    // url-0,1,2 down → sticky on url-3
    mockFetch((u) => urlIndex(urls, u) === 3 ? "ok" : "fail");
    await sendRequest(iface);

    // Next request goes directly to url-3 (probeRate=0 means no probe)
    const log = mockFetch(() => "ok");
    await sendRequest(iface);

    expect(log.length).toBe(1);
    expect(urlIndex(urls, log[0])).toBe(3);
  });

  it("probes primary and exits sticky mode when probe succeeds", async () => {
    const urls = urlList(3);
    const iface = createClientInterface({ apiUrls: urls, probeRate: 1 });

    // url-0 down → sticky on url-1
    mockFetch((u) => urlIndex(urls, u) === 0 ? "fail" : "ok");
    await sendRequest(iface);

    // url-0 recovers. probeRate=1 → always probes → probe succeeds → exits sticky
    const log = mockFetch(() => "ok");
    await sendRequest(iface);
    expect(urlIndex(urls, log[0])).toBe(0);

    // Next request should go to url-0 directly (no longer sticky)
    const log2 = mockFetch(() => "ok");
    await sendRequest(iface);
    expect(log2.length).toBe(1);
    expect(urlIndex(urls, log2[0])).toBe(0);
  });

  it("halves probe rate on each failed probe", async () => {
    const urls = urlList(2);
    const iface = createClientInterface({ apiUrls: urls, probeRate: 1 });

    // Enter sticky on url-1, url-0 stays permanently down
    mockFetch((u) => urlIndex(urls, u) === 0 ? "fail" : "ok");
    await sendRequest(iface);

    // probeRate=1 → probes url-0, fails → rate becomes 0.5
    mockFetch((u) => urlIndex(urls, u) === 0 ? "fail" : "ok");
    await sendRequest(iface);

    // probeRate=0.5 → probes (random < 0.5), fails → rate becomes 0.25
    const randomMock = vi.spyOn(Math, "random").mockReturnValue(0.4);
    mockFetch((u) => urlIndex(urls, u) === 0 ? "fail" : "ok");
    await sendRequest(iface);

    // rate=0.25, random=0.3 ≥ 0.25 → should NOT probe primary
    randomMock.mockReturnValue(0.3);
    const log = mockFetch(() => "ok");
    await sendRequest(iface);

    expect(log.length).toBe(1);
    expect(urlIndex(urls, log[0])).toBe(1);

    randomMock.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Sticky URL goes down — falls through to full iteration
  // ---------------------------------------------------------------------------

  it("falls through to full iteration when sticky URL also goes down", async () => {
    const urls = urlList(3);
    const iface = createClientInterface({ apiUrls: urls, probeRate: 0 });

    // url-0,1 down → sticky on url-2
    mockFetch((u) => urlIndex(urls, u) === 2 ? "ok" : "fail");
    await sendRequest(iface);

    // Now url-2 also down, url-1 recovers
    const log = mockFetch((u) => urlIndex(urls, u) === 1 ? "ok" : "fail");
    await sendRequest(iface);

    // Should have tried sticky url-2 (failed), then iterated 0→1 (found url-1)
    expect(log.some(u => urlIndex(urls, u) === 2)).toBe(true);
    expect(log.some(u => urlIndex(urls, u) === 1)).toBe(true);
  });

  it("re-enters sticky on the new working URL after fallthrough", async () => {
    const urls = urlList(4);
    const iface = createClientInterface({ apiUrls: urls, probeRate: 0 });

    // sticky on url-3
    mockFetch((u) => urlIndex(urls, u) === 3 ? "ok" : "fail");
    await sendRequest(iface);

    // url-3 dies, url-2 recovers → should re-sticky on url-2
    mockFetch((u) => urlIndex(urls, u) === 2 ? "ok" : "fail");
    await sendRequest(iface);

    // Next request goes directly to url-2
    const log = mockFetch(() => "ok");
    await sendRequest(iface);

    expect(log.length).toBe(1);
    expect(urlIndex(urls, log[0])).toBe(2);
  });

  it("throws when sticky URL fails and all URLs fail in iteration", async () => {
    const urls = urlList(3);
    const iface = createClientInterface({ apiUrls: urls, probeRate: 0 });

    // sticky on url-1
    mockFetch((u) => urlIndex(urls, u) === 1 ? "ok" : "fail");
    await sendRequest(iface);

    // Everything is now down
    const log = mockFetch(() => "fail");
    await expect(sendRequest(iface)).rejects.toThrow();

    // sticky attempt (1) + 2 passes × 3 URLs (6) = 7
    expect(log.length).toBe(7);
  });

  it("does not probe primary when sticky URL fails (probe only before sticky attempt)", async () => {
    const urls = urlList(3);
    const iface = createClientInterface({ apiUrls: urls, probeRate: 1 });

    // sticky on url-2, url-0 stays down
    mockFetch((u) => urlIndex(urls, u) === 2 ? "ok" : "fail");
    await sendRequest(iface);

    // url-0 still down, url-2 also dies, url-1 is the only one up
    // probeRate=1 → probes url-0 first (fails), then tries sticky url-2 (fails),
    // then full iteration finds url-1
    const log = mockFetch((u) => urlIndex(urls, u) === 1 ? "ok" : "fail");
    await sendRequest(iface);

    const hitOrder = log.map(u => urlIndex(urls, u));
    // probe url-0, sticky url-2, then iteration: 0, 1 (succeeds)
    expect(hitOrder[0]).toBe(0);  // probe
    expect(hitOrder[1]).toBe(2);  // sticky attempt
    expect(hitOrder).toContain(1);  // found during iteration
  });
});
