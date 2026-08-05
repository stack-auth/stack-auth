import { describe, expect, it, vi } from "vitest";
import { ExpiringPromiseCache } from "./expiring-promise-cache";

describe("ExpiringPromiseCache", () => {
  it("deduplicates loads until the entry expires", async () => {
    let now = 0;
    let loadCount = 0;
    const cache = new ExpiringPromiseCache<string>(60 * 60 * 1000, () => now);
    const load = vi.fn(async () => {
      loadCount++;
      return `result-${loadCount}`;
    });

    await expect(Promise.all([cache.get("changelog", load), cache.get("changelog", load)]))
      .resolves.toEqual(["result-1", "result-1"]);
    expect(load).toHaveBeenCalledTimes(1);

    now = 60 * 60 * 1000;
    await expect(cache.get("changelog", load)).resolves.toBe("result-2");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not retain failed loads", async () => {
    const cache = new ExpiringPromiseCache<string>(60 * 60 * 1000);
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.get("changelog", load)).rejects.toThrow("unavailable");
    await expect(cache.get("changelog", load)).resolves.toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
