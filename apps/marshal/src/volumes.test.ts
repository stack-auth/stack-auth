import { describe, expect, it } from "vitest";
import { computeRevision } from "./revision.js";
import { validateServiceSpec } from "./services.js";

const TEST_DATA_KEY = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");

function spec(config: Record<string, unknown>) {
  return {
    config: { min_instances: 0, max_instances: 1, port: 3000, ...config },
    source: { image: "example/image" },
    env: {},
  };
}

describe("volume spec validation", () => {
  it("accepts a volume on a single-instance service", () => {
    expect(validateServiceSpec(spec({ volume: { path: "/data", size_gb: 10 } })).config.volume)
      .toEqual({ path: "/data", size_gb: 10 });
    // 1/1 (serverful) is equally valid; so is a nested mount point.
    expect(validateServiceSpec(spec({ min_instances: 1, volume: { path: "/var/lib/app/data", size_gb: 1 } })).config.volume)
      .toEqual({ path: "/var/lib/app/data", size_gb: 1 });
  });

  it("omits the volume key entirely when there is no volume", () => {
    const validated = validateServiceSpec(spec({}));
    // Not `volume: undefined`: computeRevision hashes the serialized spec, so a
    // present-but-undefined key would change the revision of every volumeless
    // service the moment this field was introduced.
    expect("volume" in validated.config).toBe(false);
  });

  it("does not change the revision of a volumeless spec", () => {
    // Guards the above at the level that actually matters: adding the field
    // must not force a redeploy of every existing service.
    expect(computeRevision(validateServiceSpec(spec({})), TEST_DATA_KEY)).toBe(
      computeRevision({
        config: { visibility: "private", transport: "http", min_instances: 0, max_instances: 1, port: 3000 },
        source: { image: "example/image" },
        env: {},
      }, TEST_DATA_KEY),
    );
  });

  it("changes the revision when the volume is added, resized, removed, or moved", () => {
    // Without this, a volume-only change (same source) hashes to the previous
    // revision, so applyServiceSpec takes the `changed === false` path, keeps
    // the PREVIOUS stored spec, and silently drops the change while reporting
    // success. The source is identical across all of these on purpose — that is
    // the case a new upload would otherwise mask.
    const none = computeRevision(validateServiceSpec(spec({})), TEST_DATA_KEY);
    const tenGb = computeRevision(validateServiceSpec(spec({ volume: { path: "/data", size_gb: 10 } })), TEST_DATA_KEY);
    const fiftyGb = computeRevision(validateServiceSpec(spec({ volume: { path: "/data", size_gb: 50 } })), TEST_DATA_KEY);
    const otherPath = computeRevision(validateServiceSpec(spec({ volume: { path: "/other", size_gb: 10 } })), TEST_DATA_KEY);
    expect(new Set([none, tenGb, fiftyGb, otherPath]).size).toBe(4);
  });

  it("rejects a volume on a multi-instance service", () => {
    // A Fly volume attaches to one machine, so a fleet would give each instance
    // its own separate disk rather than shared storage.
    expect(() => validateServiceSpec(spec({ max_instances: 2, volume: { path: "/data", size_gb: 1 } })))
      .toThrow(/max_instances must be 1 when config.volume is set/);
    expect(() => validateServiceSpec(spec({ min_instances: 2, max_instances: 2, volume: { path: "/data", size_gb: 1 } })))
      .toThrow(/max_instances must be 1 when config.volume is set/);
  });

  it("rejects mount paths that are not normalized absolute paths", () => {
    for (const path of ["data", "", "/", "/data/", "/data/../etc", "/data/./x", "/da\\ta", "/da\u0000ta", "//data"]) {
      expect(() => validateServiceSpec(spec({ volume: { path, size_gb: 1 } })), `path ${JSON.stringify(path)}`)
        .toThrow(/config\.volume\.path/);
    }
  });

  it("rejects sizes outside the Fly volume bounds", () => {
    for (const sizeGb of [0, -1, 501, 1.5, "10", null]) {
      expect(() => validateServiceSpec(spec({ volume: { path: "/data", size_gb: sizeGb } })), `size ${JSON.stringify(sizeGb)}`)
        .toThrow(/config\.volume\.size_gb/);
    }
  });

  it("rejects a malformed volume object", () => {
    expect(() => validateServiceSpec(spec({ volume: "10gb" }))).toThrow(/config\.volume must be an object/);
    expect(() => validateServiceSpec(spec({ volume: { size_gb: 10 } }))).toThrow(/config\.volume\.path/);
    expect(() => validateServiceSpec(spec({ volume: { path: "/data" } }))).toThrow(/config\.volume\.size_gb/);
  });

  it("accepts a size at each end of the supported range", () => {
    expect(validateServiceSpec(spec({ volume: { path: "/data", size_gb: 1 } })).config.volume?.size_gb).toBe(1);
    expect(validateServiceSpec(spec({ volume: { path: "/data", size_gb: 500 } })).config.volume?.size_gb).toBe(500);
  });

  it("treats an explicitly null volume as no volume", () => {
    // The backend omits the key rather than sending null, but a hand-rolled
    // client shouldn't get a confusing type error for the obvious spelling.
    expect("volume" in validateServiceSpec(spec({ volume: null })).config).toBe(false);
  });
});

describe("visibility spec validation", () => {
  it("defaults to private, accepts public, and includes visibility in the revision", () => {
    const privateSpec = validateServiceSpec(spec({}));
    const publicSpec = validateServiceSpec(spec({ visibility: "public" }));
    expect(privateSpec.config.visibility).toBe("private");
    expect(publicSpec.config.visibility).toBe("public");
    expect(computeRevision(privateSpec, TEST_DATA_KEY)).not.toBe(computeRevision(publicSpec, TEST_DATA_KEY));
  });

  it("rejects unsupported visibility values", () => {
    expect(() => validateServiceSpec(spec({ visibility: "unlisted" }))).toThrow(/config\.visibility/);
  });
});
