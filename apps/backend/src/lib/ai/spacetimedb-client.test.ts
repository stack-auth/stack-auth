/**
 * Exercises `callSql` 401 enrollment retry (shared with `callReducer` via
 * `withEnrollmentRetry`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        case "STACK_SPACETIMEDB_SERVICE_TOKEN": {
          return "test-service-token";
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

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeSqlSuccess(): Response {
  return makeJsonResponse([{
    schema: { elements: [{ name: { some: "question" } }, { name: { some: "answer" } }] },
    rows: [["q1", "a1"]],
  }]);
}

function isSqlRequest(url: unknown): boolean {
  return typeof url === "string" && url.endsWith("/sql");
}

function isEnrollRequest(url: unknown): boolean {
  return typeof url === "string" && url.endsWith("/call/enroll_service");
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // The module-level enrollmentPromise cache survives across tests; reset it
  // by re-importing the module fresh for each test.
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("callSql 401 enrollment retry", () => {
  it("retries SQL after a 401 by re-enrolling, mirroring callReducer", async () => {
    fetchMock.mockImplementation((url: unknown) => {
      if (isEnrollRequest(url)) return Promise.resolve(makeJsonResponse({}, 200));
      if (isSqlRequest(url)) {
        if (fetchMock.mock.calls.filter((c) => isSqlRequest(c[0])).length === 1) {
          return Promise.resolve(new Response("not enrolled", { status: 401 }));
        }
        return Promise.resolve(makeSqlSuccess());
      }
      return Promise.reject(new Error(`Unexpected URL: ${String(url)}`));
    });

    const { callSql } = await import("./spacetimedb-client");
    const rows = await callSql<{ question: string, answer: string }>("SELECT question, answer FROM published_qa");
    expect(rows).toEqual([{ question: "q1", answer: "a1" }]);

    const sqlCalls = fetchMock.mock.calls.filter((c) => isSqlRequest(c[0]));
    expect(sqlCalls.length).toBe(2);
    const enrollCalls = fetchMock.mock.calls.filter((c) => isEnrollRequest(c[0]));
    expect(enrollCalls.length).toBe(2);
  });

  it("returns rows on first-attempt success without re-enrolling", async () => {
    fetchMock.mockImplementation((url: unknown) => {
      if (isEnrollRequest(url)) return Promise.resolve(makeJsonResponse({}, 200));
      if (isSqlRequest(url)) return Promise.resolve(makeSqlSuccess());
      return Promise.reject(new Error(`Unexpected URL: ${String(url)}`));
    });

    const { callSql } = await import("./spacetimedb-client");
    const rows = await callSql<{ question: string, answer: string }>("SELECT question, answer FROM published_qa");
    expect(rows).toEqual([{ question: "q1", answer: "a1" }]);

    const sqlCalls = fetchMock.mock.calls.filter((c) => isSqlRequest(c[0]));
    expect(sqlCalls.length).toBe(1);
    const enrollCalls = fetchMock.mock.calls.filter((c) => isEnrollRequest(c[0]));
    expect(enrollCalls.length).toBe(1);
  });

  it("propagates non-401 SQL errors without retrying", async () => {
    fetchMock.mockImplementation((url: unknown) => {
      if (isEnrollRequest(url)) return Promise.resolve(makeJsonResponse({}, 200));
      if (isSqlRequest(url)) return Promise.resolve(new Response("syntax error", { status: 400 }));
      return Promise.reject(new Error(`Unexpected URL: ${String(url)}`));
    });

    const { callSql } = await import("./spacetimedb-client");
    await expect(callSql("SELECT BAD")).rejects.toThrow();

    const sqlCalls = fetchMock.mock.calls.filter((c) => isSqlRequest(c[0]));
    expect(sqlCalls.length).toBe(1);
  });
});
