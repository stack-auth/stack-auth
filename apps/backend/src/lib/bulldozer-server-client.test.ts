import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalVar } from "@hexclave/shared/dist/utils/globals";
import { bulldozerCustomerPath, fetchBulldozerServerJson, isRetriableBulldozerFetchError } from "./bulldozer-server-client";

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.stubEnv("HEXCLAVE_BULLDOZER_SERVER_SECRET", "test-secret");
  // The base URL is derived from the ambient environment, which differs between local runs and CI
  // (eg. a non-default port prefix), so pin both inputs to keep the expected URLs deterministic.
  vi.stubEnv("HEXCLAVE_BULLDOZER_SERVER_URL", "");
  vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
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
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(resultPromise).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:8146/update-quantity", expect.anything());
  });

  it("rethrows the original error after exhausting all safe connection retries", async () => {
    vi.useFakeTimers();
    const retryDelays = [250, 500, 1_000, 2_000];
    const failures = Array.from({ length: 5 }, (_, index) => new TypeError(`fetch failed ${index}`, {
      cause: errorWithCode("ECONNREFUSED"),
    }));
    const fetchMock = vi.fn().mockRejectedValueOnce(failures[0])
      .mockRejectedValueOnce(failures[1])
      .mockRejectedValueOnce(failures[2])
      .mockRejectedValueOnce(failures[3])
      .mockRejectedValueOnce(failures[4]);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    vi.stubGlobal("fetch", fetchMock);

    const request = expect(fetchBulldozerServerJson({ method: "POST", path: "/update-quantity" })).rejects.toBe(failures[4]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [index, delay] of retryDelays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetchMock).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(index + 2);
    }

    await request;
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(setTimeoutSpy.mock.calls.map(([, delay]) => delay)).toEqual(retryDelays);
  });

  it("emits one recovery diagnostic with the first failure and final attempt count", async () => {
    vi.useFakeTimers();
    const firstFailure = new TypeError("first fetch failed", {
      cause: errorWithCode("ECONNREFUSED"),
    });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(firstFailure)
      .mockRejectedValueOnce(new TypeError("second fetch failed", {
        cause: errorWithCode("ECONNREFUSED"),
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const capturedErrorsBefore = globalVar.hexclaveCapturedErrors?.length ?? 0;
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchBulldozerServerJson<{ success: true }>({ method: "POST", path: "/recovery-after-several" });
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({ success: true });
    const capturedErrors = (globalVar.hexclaveCapturedErrors ?? [])
      .slice(capturedErrorsBefore)
      .filter((entry: { location: string }) => entry.location === "bulldozer-server-connect-retry");
    expect(capturedErrors).toHaveLength(1);
    expect(capturedErrors[0].error).toMatchObject({
      cause: firstFailure,
      extraData: {
        attempts: 3,
      },
    });
  });

  it("does not emit a recovery diagnostic when the retried response is not ok", async () => {
    vi.useFakeTimers();
    const capturedErrorsBefore = globalVar.hexclaveCapturedErrors?.length ?? 0;
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed", {
        cause: errorWithCode("ECONNREFUSED"),
      }))
      .mockResolvedValueOnce(new Response("bad request", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = expect(fetchBulldozerServerJson({ method: "POST", path: "/recovery-http-error" }))
      .rejects.toThrow("Bulldozer server request failed");
    await vi.advanceTimersByTimeAsync(250);

    await request;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const capturedErrors = (globalVar.hexclaveCapturedErrors ?? [])
      .slice(capturedErrorsBefore)
      .filter((entry: { location: string }) => entry.location === "bulldozer-server-connect-retry");
    expect(capturedErrors).toHaveLength(0);
  });

  it("does not retry an HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson({ method: "POST", path: "/update-quantity" })).rejects.toThrow("Bulldozer server request failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encodes customer path segments without double-encoding", () => {
    expect(bulldozerCustomerPath({
      tenancyId: "tenancy/id",
      customerType: "user",
      customerId: "customer?id",
      suffix: "owned-products",
    })).toBe("/v1/tenancy%2Fid/customers/user/customer%3Fid/owned-products");
  });

  it("preserves a path prefix in the configured Bulldozer URL", async () => {
    vi.stubEnv("HEXCLAVE_BULLDOZER_SERVER_URL", "http://localhost:8146/bulldozer");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson<{ success: true }>({ method: "POST", path: "/update-quantity" }))
      .resolves.toEqual({ success: true });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8146/bulldozer/update-quantity", expect.anything());
  });

  it("does not retry an ambiguous socket failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(errorWithCode("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson({ method: "POST", path: "/update-quantity" })).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
