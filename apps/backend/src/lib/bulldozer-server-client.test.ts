import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBulldozerServerJson } from "./bulldozer-server-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function socketResetError() {
  return Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
}

describe("fetchBulldozerServerJson", () => {
  it("retries a transient GET transport error", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(socketResetError())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson<{ ok: boolean }>({ method: "GET", path: "/v1/test" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws with the attempt count after exhausting transient GET retries", async () => {
    const fetchMock = vi.fn().mockRejectedValue(socketResetError());
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson({ method: "GET", path: "/v1/test" })).rejects.toMatchObject({
      name: "HexclaveAssertionError",
      extraData: {
        attempts: 3,
        path: "/v1/test",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry POST transport errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(socketResetError());
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson({ method: "POST", path: "/v1/test", body: {} })).rejects.toBeInstanceOf(HexclaveAssertionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP error responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson({ method: "GET", path: "/v1/test" })).rejects.toMatchObject({
      extraData: {
        status: 500,
        path: "/v1/test",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry JSON parse failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBulldozerServerJson({ method: "GET", path: "/v1/test" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
