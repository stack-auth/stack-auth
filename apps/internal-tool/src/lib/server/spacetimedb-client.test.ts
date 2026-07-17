import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApiError } from "./route-utils";
import { callReducerStrict, callSql } from "./spacetimedb-client";

// The modules under test import the `server-only` marker package, which throws
// when loaded outside a React Server Components bundler context.
vi.mock("server-only", () => ({}));

// A stand-in for what SpacetimeDB actually puts in error bodies: reducer panic
// text with module internals that must never reach an API caller.
const UPSTREAM_BODY = "panic in reducer update_mcp_qa_review: no such row in mcp_call_log";

function stubDefaultEnv() {
  vi.stubEnv("HEXCLAVE_SPACETIMEDB_URL", "http://spacetimedb.example.com");
  vi.stubEnv("HEXCLAVE_SPACETIMEDB_DB_NAME", "test-db");
  // getEnvVariable also reads the legacy STACK_-prefixed twins; stub them to
  // empty (= unset) so a stray var in the runner's environment can't interfere.
  vi.stubEnv("STACK_SPACETIMEDB_URL", "");
  vi.stubEnv("STACK_SPACETIMEDB_DB_NAME", "");
}

function stubUpstreamResponse(status: number, body: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected promise to reject");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each([
  { name: "callReducerStrict", call: () => callReducerStrict("token", "some_reducer", []) },
  { name: "callSql", call: () => callSql("token", "SELECT 1") },
])("$name upstream error mapping", ({ call }) => {
  it("maps an upstream 4xx to an assertion error, never a client StatusError", async () => {
    stubDefaultEnv();
    stubUpstreamResponse(400, UPSTREAM_BODY);

    const err = await rejectionOf(call());
    // A client (4xx) StatusError would make handleApiError return the message
    // — including the upstream body — verbatim to the API caller.
    expect(err).toBeInstanceOf(HexclaveAssertionError);
    expect(String((err as Error).message)).toContain(UPSTREAM_BODY);
  });

  it("maps an upstream 5xx to a BadGateway StatusError, keeping the body in the message for logs", async () => {
    stubDefaultEnv();
    stubUpstreamResponse(503, UPSTREAM_BODY);

    const err = await rejectionOf(call());
    expect(StatusError.isStatusError(err)).toBe(true);
    expect((err as StatusError).statusCode).toBe(502);
    expect((err as StatusError).isClientError()).toBe(false);
    expect((err as Error).message).toContain(UPSTREAM_BODY);
  });
});

describe("handleApiError responses for upstream failures", () => {
  it("never returns the upstream body to the API caller", async () => {
    stubDefaultEnv();
    for (const upstreamStatus of [400, 401, 404, 500, 503]) {
      stubUpstreamResponse(upstreamStatus, UPSTREAM_BODY);
      const err = await rejectionOf(callReducerStrict("token", "some_reducer", []));

      const res = handleApiError("test-scope", err);
      const body = await res.text();
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(body).not.toContain(UPSTREAM_BODY);
      expect(body).not.toContain("some_reducer");
    }
  });

  it("still returns authored client StatusError messages verbatim", async () => {
    const res = handleApiError("test-scope", new StatusError(StatusError.BadRequest, "Request body must be valid JSON."));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Request body must be valid JSON.");
  });
});
