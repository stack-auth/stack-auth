import { describe, expect, it } from "vitest";
import { DEFAULT_GROUPING_CONFIG_ID, GROUPING_CONFIGS, GROUPING_CONFIG_IDS, isGroupingConfigId } from "./grouping-config";

describe("grouping config registry", () => {
  it("lists exactly the configs it can describe", () => {
    // Divergence here is the failure mode the closed union exists to prevent:
    // an id in the union with no config behind it fails at runtime, in ingest.
    expect([...GROUPING_CONFIGS.keys()]).toEqual([...GROUPING_CONFIG_IDS]);
  });

  it("has a config whose `id` matches its key", () => {
    for (const [key, config] of GROUPING_CONFIGS) {
      expect(config.id).toBe(key);
    }
  });

  it("defaults to a config that exists", () => {
    expect(GROUPING_CONFIGS.has(DEFAULT_GROUPING_CONFIG_ID)).toBe(true);
  });

  it("snapshots the registry, so retiring a config is never silent", () => {
    // Removing an id from this list is what strands every issue hashed under it.
    // The plan requires a durable migration job to report zero remaining hashes
    // BEFORE that happens; a diff here is the reminder.
    expect([...GROUPING_CONFIG_IDS]).toMatchInlineSnapshot(`
      [
        "hexclave-js:2026-08-01",
      ]
    `);
  });
});

describe("isGroupingConfigId", () => {
  it.each([
    ["a known id", "hexclave-js:2026-08-01", true],
    ["a retired-looking id", "hexclave-js:1999-01-01", false],
    ["the empty string", "", false],
    ["a number", 42, false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["an object", { id: "hexclave-js:2026-08-01" }, false],
  ])("%s", (_name, value, expected) => {
    expect(isGroupingConfigId(value)).toBe(expected);
  });

  it("narrows to the union", () => {
    const fromDatabase: unknown = "hexclave-js:2026-08-01";
    if (!isGroupingConfigId(fromDatabase)) throw new Error("expected the id to narrow");
    // `fromDatabase` is a `GroupingConfigId` here; the lookup compiles without a cast.
    expect(GROUPING_CONFIGS.get(fromDatabase)?.introducedAt).toMatchInlineSnapshot(`"2026-08-01"`);
  });
});
