import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBulldozerServerJson, isRetriableBulldozerFetchError } from "./bulldozer-server-client";

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.stubEnv("HEXCLAVE_BULLDOZER_SERVER_SECRET", "test-secret");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isRetriableBulldozerFetchError", () => {
  it("accepts nested connect-phase errors", () => {
    expect(isRetriableBulldozerFetchError(new TypeError("fetch failed", {
      cause: errorWithCode("ECONNREFUSED"),
    }))).toBe(true);
  });

  it("accepts aggregates when every address failed safely", () => {
    expect(isRetriableBulldozerFetchError(new TypeError("fetch failed", {
      cause: new AggregateError([
        errorWithCode("ECONNREFUSED"),
        errorWithCode("ENOTFOUND"),
      ]),
    }))).toBe(true);
  });

  it("rejects aggregates containing an ambiguous or unsafe failure", () => {
    expect(isRetriableBulldozerFetchError(new TypeError("fetch failed", {
      cause: new AggregateError([
        errorWithCode("ECONNREFUSED"),
        errorWithCode("ECONNRESET"),
      ]),
    }))).toBe(false);
    expect(isRetriableBulldozerFetchError(errorWithCode("ETIMEDOUT"))).toBe(false);
  });
});

describe("fetchBulldozerServerJson", () => {
  it("retries a refused connection and returns the later response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause: errorWithCode("ECONNREFUSED") }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchBulldozerServerJson<{ success: true }>({ method: "POST", path: "/update-quantity", body: { quantity: 1 } });
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson({ method: "POST", path: "/update-quantity" })).rejects.toThrow("Bulldozer server request failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an ambiguous socket failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(errorWithCode("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson({ method: "POST", path: "/update-quantity" })).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
