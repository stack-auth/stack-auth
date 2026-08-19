// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IndependentTvPageClient, { getTvDisplayRequestHeaders } from "./page-client";

const fetchMock = vi.hoisted(() => vi.fn());
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

vi.mock("@/lib/env", () => ({
  getPublicEnvVar: () => "http://localhost:8102",
}));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("independent TV display requests", () => {
  it("does not advertise JSON for a bodyless pairing or refresh request", () => {
    const headers = getTvDisplayRequestHeaders({ method: "POST" });
    expect(headers.has("content-type")).toBe(false);
  });

  it("advertises JSON when a request has a JSON body", () => {
    const headers = getTvDisplayRequestHeaders({
      method: "POST",
      body: JSON.stringify({ deviceSecret: "secret" }),
    });
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("keeps scheduling pairing restoration after consecutive refresh failures", async () => {
    fetchMock.mockRejectedValue(new Error("backend unavailable"));
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(createElement(IndependentTvPageClient));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => root.unmount());
  });
});
