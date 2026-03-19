import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalSession } from "../sessions";
import { Result } from "../utils/results";
import { StackClientInterface } from "./client-interface";

function createClientInterface() {
  return new StackClientInterface({
    clientVersion: "test",
    getBaseUrl: () => "https://api.example.com",
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
