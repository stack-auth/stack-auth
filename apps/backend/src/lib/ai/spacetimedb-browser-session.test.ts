import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callReducerStrict } from "@/lib/ai/spacetimedb-client";
import { enrollSpacetimeBrowserIdentity, mintSpacetimeBrowserSession } from "./spacetimedb-browser-session";

vi.mock("@hexclave/shared/dist/utils/env", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getEnvVariable: (key: string, fallback?: string) => {
      switch (key) {
        case "STACK_SPACETIMEDB_URL": {
          return "http://spacetime.test";
        }
        case "STACK_SPACETIMEDB_DB_NAME": {
          return "test-db";
        }
        case "STACK_MCP_LOG_TOKEN": {
          return "test-log-token";
        }
        default: {
          return fallback ?? "";
        }
      }
    },
  };
});

vi.mock("@/lib/ai/spacetimedb-client", () => ({
  callReducerStrict: vi.fn(),
}));

const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();

const identity = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeIdentityToken(hexIdentity: string): string {
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ hex_identity: hexIdentity })).toString("base64url");
  return `${header}.${payload}.signature`;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(callReducerStrict).mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SpacetimeDB browser sessions", () => {
  it("mints a browser session with websocket host, database name, identity, token, and user-scoped cache key", async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({
      identity: `0x${identity}`,
      token: "spacetime-token",
    }));

    const session = await mintSpacetimeBrowserSession("user-1");

    expect(fetchMock).toHaveBeenCalledWith("http://spacetime.test/v1/identity", expect.objectContaining({
      method: "POST",
    }));
    expect(session).toEqual({
      host: "ws://spacetime.test",
      dbName: "test-db",
      identity,
      token: "spacetime-token",
      scopeKey: "spacetimedb:ws://spacetime.test:test-db:user-1:browser_session",
    });
  });

  it("derives the identity from the minted token when SpacetimeDB omits identity fields", async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({
      token: makeIdentityToken(identity),
    }));

    await expect(mintSpacetimeBrowserSession("user-1")).resolves.toMatchObject({
      identity,
      token: makeIdentityToken(identity),
    });
  });

  it("enrolls browser identities under a non-reserved SpacetimeDB stackUserId", async () => {
    const callReducerStrictMock = vi.mocked(callReducerStrict);
    callReducerStrictMock.mockResolvedValue(undefined);

    await enrollSpacetimeBrowserIdentity(identity, "__local_fixture_user__", "Local Reviewer");

    expect(callReducerStrictMock).toHaveBeenCalledTimes(1);
    expect(callReducerStrictMock).toHaveBeenCalledWith("add_operator", [
      "test-log-token",
      [`0x${identity}`],
      "hexclave-user:__local_fixture_user__",
      "Local Reviewer",
    ]);
  });

  it("removes and re-enrolls a cached browser identity after a stale operator binding failure", async () => {
    const callReducerStrictMock = vi.mocked(callReducerStrict);
    callReducerStrictMock
      .mockRejectedValueOnce(new StatusError(StatusError.BadGateway, "Reducer add_operator failed"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await enrollSpacetimeBrowserIdentity(identity, "user-1", "Reviewer");

    expect(callReducerStrictMock).toHaveBeenNthCalledWith(1, "add_operator", [
      "test-log-token",
      [`0x${identity}`],
      "hexclave-user:user-1",
      "Reviewer",
    ]);
    expect(callReducerStrictMock).toHaveBeenNthCalledWith(2, "remove_operator", [
      "test-log-token",
      [`0x${identity}`],
    ]);
    expect(callReducerStrictMock).toHaveBeenNthCalledWith(3, "add_operator", [
      "test-log-token",
      [`0x${identity}`],
      "hexclave-user:user-1",
      "Reviewer",
    ]);
  });
});
