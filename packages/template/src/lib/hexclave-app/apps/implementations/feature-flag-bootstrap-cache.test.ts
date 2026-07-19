import type { FeatureFlagBootstrapResponse } from "@hexclave/shared/dist/interface/crud/feature-flags";
import { describe, expect, it, vi } from "vitest";
import { FeatureFlagBootstrapCache, FeatureFlagBootstrapUnavailableError, type FeatureFlagBootstrapFetchResult } from "./feature-flag-bootstrap-cache";

function bootstrap(version: string): FeatureFlagBootstrapResponse {
  return {
    config: {
      flags: {},
      segments: {},
      holdouts: {},
      mutualExclusionGroups: {},
      experiments: {},
    },
    flag_ids_by_key: {},
    config_version: version,
  };
}

describe("FeatureFlagBootstrapCache", () => {
  it("revalidates after thirty seconds with ETags", async () => {
    let now = 0;
    const fetch = vi.fn(async (etag?: string): Promise<FeatureFlagBootstrapFetchResult> => etag == null
      ? { status: "ok", data: bootstrap("v1"), etag: '"v1"' }
      : { status: "not-modified" });
    const cache = new FeatureFlagBootstrapCache(fetch, () => now);

    expect((await cache.get()).config_version).toBe("v1");
    now = 29_999;
    expect((await cache.get()).isStale).toBe(false);
    now = 30_000;
    expect((await cache.get()).config_version).toBe("v1");
    expect(fetch).toHaveBeenNthCalledWith(2, '"v1"');
  });

  it("serves a validated snapshot for five minutes during transient failure", async () => {
    let now = 0;
    let offline = false;
    const cache = new FeatureFlagBootstrapCache(async () => {
      if (offline) throw new Error("network diagnostics failed", { cause: new TypeError("offline") });
      return { status: "ok", data: bootstrap("v1"), etag: '"v1"' };
    }, () => now);

    await cache.get();
    offline = true;
    now = 30_000;
    expect((await cache.get()).isStale).toBe(true);
    now = 300_001;
    await expect(cache.get()).rejects.toBeInstanceOf(FeatureFlagBootstrapUnavailableError);
  });

  it("does not hide authorization failures behind stale definitions", async () => {
    const authorizationError = Object.assign(new Error("unauthorized"), { status: 401 });
    const cache = new FeatureFlagBootstrapCache(async () => {
      throw authorizationError;
    });
    await expect(cache.get()).rejects.toBe(authorizationError);
  });
});
