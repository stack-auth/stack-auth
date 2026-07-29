import { setGlobal } from "@hexclave/shared/dist/utils/globals";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveApiUrls } from "./common";

// Regression test for an infinite recursion between the backend-urls discovery
// fetch and the SDK's own fetch instrumentation: the instrumentation's
// should-this-span-be-ignored check calls getApiUrls(), which kicks off
// fetchBackendUrlsInBackground, whose fetch runs through the instrumentation
// again. Before the marker-first fix, the started-marker was only stored AFTER
// the discovery fetch had been issued (createGlobal semantics), so the
// re-entrant call re-ran the whole body → RangeError: Maximum call stack size
// exceeded on the first instrumented fetch of every server process.
describe("resolveApiUrls background discovery", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // The started/fetched markers live in the process-wide Hexclave globals
    // registry, so earlier tests (or an earlier iteration of this one) may
    // have set them; undefined reads as unset.
    setGlobal("__stack-fetch-backend-urls-started", undefined);
    setGlobal("__stack-fetched-backend-urls", undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not recurse when the discovery fetch itself resolves API URLs (instrumented-fetch shape)", () => {
    const getApiUrls = resolveApiUrls(undefined);
    let fetchCalls = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      // Same re-entrancy as the fetch instrumentation: resolve the API URL
      // list synchronously inside the fetch call to decide whether to record
      // a span for it.
      getApiUrls();
      return Promise.resolve(new Response("{}", { status: 500 }));
    }) as typeof fetch;

    // Before the fix this threw RangeError before the fake fetch ever ran.
    const urls = getApiUrls();
    expect(urls.length).toBeGreaterThan(0);
    // Exactly one discovery fetch: the re-entrant getApiUrls() must see the
    // started-marker and not start a second one.
    expect(fetchCalls).toBe(1);
  });

  it("only starts one discovery fetch across repeated calls", () => {
    const getApiUrls = resolveApiUrls(undefined);
    let fetchCalls = 0;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return Promise.resolve(new Response("{}", { status: 500 }));
    }) as typeof fetch;

    getApiUrls();
    getApiUrls();
    getApiUrls();
    expect(fetchCalls).toBe(1);
  });
});
