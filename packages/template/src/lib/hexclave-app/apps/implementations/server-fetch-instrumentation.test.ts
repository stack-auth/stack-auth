import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installServerFetchInstrumentation } from "./server-fetch-instrumentation";

describe("installServerFetchInstrumentation", () => {
  let originalFetch: typeof fetch;
  let uninstalls: (() => void)[];

  beforeEach(() => {
    originalFetch = ((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve({ status: 200 } as Response)) as typeof fetch;
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    uninstalls = [];
  });

  afterEach(() => {
    for (const uninstall of uninstalls) uninstall();
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  function install(projectId: string, beginRequestSpan: ReturnType<typeof vi.fn>) {
    const uninstall = installServerFetchInstrumentation({
      projectId,
      provider: {
        getContext: () => null,
        getSelfOrigin: () => null,
        getAllowedOrigins: () => [],
        beginRequestSpan: (info) => {
          beginRequestSpan(info);
          return null;
        },
      },
    });
    if (uninstall !== null) uninstalls.push(uninstall);
    return uninstall;
  }

  it("installs the wrapper and routes requests through the provider", async () => {
    const begin = vi.fn();
    expect(install("project-a", begin)).toBeTypeOf("function");
    expect(globalThis.fetch).not.toBe(originalFetch);
    await globalThis.fetch("https://third-party.example/data");
    expect(begin).toHaveBeenCalledWith({ url: "https://third-party.example/data", method: "GET", transport: "fetch" });
  });

  it("REPLACES a previous install for the same project (HMR: no duplicate spans)", async () => {
    const firstBegin = vi.fn();
    const secondBegin = vi.fn();
    install("project-a", firstBegin);
    install("project-a", secondBegin);
    await globalThis.fetch("https://third-party.example/data");
    expect(firstBegin).not.toHaveBeenCalled();
    expect(secondBegin).toHaveBeenCalledTimes(1);
  });

  it("keeps providers for DIFFERENT projects side by side", async () => {
    const firstBegin = vi.fn();
    const secondBegin = vi.fn();
    install("project-a", firstBegin);
    install("project-b", secondBegin);
    await globalThis.fetch("https://third-party.example/data");
    expect(firstBegin).toHaveBeenCalledTimes(1);
    expect(secondBegin).toHaveBeenCalledTimes(1);
  });

  it("uninstalling the last provider restores the original fetch", () => {
    const uninstall = install("project-a", vi.fn());
    uninstall?.();
    uninstalls = [];
    expect(globalThis.fetch).toBe(originalFetch);
    // A stale uninstaller must not clobber a newer registration.
    install("project-a", vi.fn());
    uninstall?.();
    expect(globalThis.fetch).not.toBe(originalFetch);
  });
});
