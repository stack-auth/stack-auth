import { describe, expect, it } from "vitest";
import { resolveGroupingConfig } from "./grouping-config";
import { computeGrouping, computeGroupingWithReadableConfigs } from "./grouping";

const input = {
  type: "TypeError",
  message: "Cannot read property 'token' of undefined",
  stack: "TypeError: Cannot read property 'token' of undefined\n    at loadUser (https://app.example.test/_next/static/chunks/app-a1b2c3.js:10:20)",
  platform: "javascript" as const,
};

describe("grouping config transitions", () => {
  it("keeps the legacy hash stable while the transition algorithm produces a distinct primary", () => {
    const legacy = computeGrouping(input, "hexclave-js:2026-08-01");
    const next = computeGrouping(input, "hexclave-js:2026-08-06");

    expect(legacy.ownerHash).not.toBe(next.ownerHash);
    expect(legacy.configId).toBe("hexclave-js:2026-08-01");
    expect(next.configId).toBe("hexclave-js:2026-08-06");
  });

  it("writes the active primary and readable historical hash as secondary provenance", () => {
    const grouping = computeGroupingWithReadableConfigs(input, resolveGroupingConfig({
      activeConfigId: "hexclave-js:2026-08-06",
      readableConfigIds: { "hexclave-js:2026-08-01": { enabled: true } },
    }));

    expect(grouping.configId).toBe("hexclave-js:2026-08-06");
    expect(grouping.aliasHashes).toContain(computeGrouping(input, "hexclave-js:2026-08-01").ownerHash);
    expect(grouping.secondaryProvenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ configId: "hexclave-js:2026-08-01", role: "secondary" }),
    ]));
  });
});
