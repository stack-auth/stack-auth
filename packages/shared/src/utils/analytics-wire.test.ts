import { describe, expect, it } from "vitest";
import { CLIENT_SYSTEM_SPAN_TYPES, SYSTEM_EVENT_TYPES, TELEMETRY_UUID_RE, buildTraceparent, getTelemetryResourceError, snapshotTelemetryResource, truncateUtf8Bytes, uuidToW3cSpanId, uuidToW3cTraceId } from "./analytics-wire";

describe("telemetry resource", () => {
  it("accepts the explicit service identity and bounded primitive attributes", () => {
    expect(getTelemetryResourceError({
      service: { name: "checkout", namespace: "store", version: "abc123", instanceId: "iad-1" },
      deploymentEnvironmentName: "production",
      attributes: { region: "iad1", replicas: 3, active: true, zones: ["iad1", "iad2"], optional: null },
    })).toBeNull();
  });

  it("rejects nested and non-finite attribute values", () => {
    expect(getTelemetryResourceError({
      service: { name: "checkout" },
      attributes: { nested: { secret: "value" } },
    })).toContain("must be a primitive");
    expect(getTelemetryResourceError({
      service: { name: "checkout" },
      attributes: { load: Number.NaN },
    })).toContain("must be a primitive");
  });

  it("rejects unknown resource and service fields instead of silently ignoring them", () => {
    expect(getTelemetryResourceError({
      service: { name: "checkout", guessedRuntime: "browser" },
    })).toContain("unknown field");
    expect(getTelemetryResourceError({
      service: { name: "checkout" },
      environment: "production",
    })).toContain("unknown field");
  });

  it("deeply snapshots identity and primitive-array attributes", () => {
    const zones = ["iad1", "iad2"];
    const input = {
      service: { name: "checkout", namespace: "store" },
      attributes: { zones },
    };
    const snapshot = snapshotTelemetryResource(input);

    input.service.name = "mutated";
    zones.push("sfo1");

    expect(snapshot).toEqual({
      service: { name: "checkout", namespace: "store" },
      attributes: { zones: ["iad1", "iad2"] },
    });
  });
});

describe("truncateUtf8Bytes", () => {
  it("returns short values unchanged", () => {
    expect(truncateUtf8Bytes("hello", 8)).toBe("hello");
    expect(truncateUtf8Bytes("", 0)).toBe("");
  });

  it("truncates by bytes, not characters", () => {
    // "€" is 3 UTF-8 bytes, so a 3000-char string is 9000 bytes. The result
    // is a prefix within budget; the 64-char chop step means the cut can land
    // up to 192 bytes below the budget, so only bounds are asserted.
    const truncated = truncateUtf8Bytes("\u{20AC}".repeat(3000), 6000);
    expect("\u{20AC}".repeat(3000).startsWith(truncated)).toBe(true);
    const byteLength = new TextEncoder().encode(truncated).length;
    expect(byteLength).toBeLessThanOrEqual(6000);
    expect(byteLength).toBeGreaterThan(6000 - 64 * 3);
  });

  it("never splits a code point at the boundary", () => {
    const value = "x".repeat(100) + "\u{1F600}".repeat(50); // 😀 is 4 bytes / 2 UTF-16 units
    for (const budget of [0, 1, 99, 100, 101, 102, 103, 150, 299, 300]) {
      const truncated = truncateUtf8Bytes(value, budget);
      expect(value.startsWith(truncated)).toBe(true);
      expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(budget);
      // Re-encoding must round-trip: a split surrogate pair would not.
      expect(new TextDecoder().decode(new TextEncoder().encode(truncated))).toBe(truncated);
    }
  });
});

describe("uuidToW3cTraceId", () => {
  it("strips dashes and lowercases", () => {
    expect(uuidToW3cTraceId("1B671A64-40D5-491E-99B0-DA01FF1F3341")).toBe("1b671a6440d5491e99b0da01ff1f3341");
  });

  it("round-trips every crypto.randomUUID shape", () => {
    for (let i = 0; i < 100; i++) {
      const uuid = crypto.randomUUID();
      const traceId = uuidToW3cTraceId(uuid);
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      // Reconstructing the uuid from the hex must yield the original.
      const rebuilt = `${traceId.slice(0, 8)}-${traceId.slice(8, 12)}-${traceId.slice(12, 16)}-${traceId.slice(16, 20)}-${traceId.slice(20)}`;
      expect(rebuilt).toBe(uuid.toLowerCase());
    }
  });

  it("throws on non-uuid input", () => {
    expect(() => uuidToW3cTraceId("not-a-uuid")).toThrow(`Expected a telemetry uuid, got: "not-a-uuid"`);
    expect(() => uuidToW3cTraceId("1b671a6440d5491e99b0da01ff1f3341")).toThrow();
    expect(() => uuidToW3cTraceId("")).toThrow();
  });
});

describe("uuidToW3cSpanId", () => {
  it("takes the lower 8 bytes", () => {
    expect(uuidToW3cSpanId("1B671A64-40D5-491E-99B0-DA01FF1F3341")).toBe("99b0da01ff1f3341");
  });

  it("is never all-zero for RFC 4122 uuids (variant bits make the first hex char 8-b)", () => {
    for (let i = 0; i < 100; i++) {
      const spanId = uuidToW3cSpanId(crypto.randomUUID());
      expect(spanId).toMatch(/^[89ab][0-9a-f]{15}$/);
    }
  });

  it("fails loud on the (regex-admitted but never generated) all-zero lower half", () => {
    const degenerate = "1b671a64-40d5-491e-0000-000000000000";
    expect(TELEMETRY_UUID_RE.test(degenerate)).toBe(true);
    expect(() => uuidToW3cSpanId(degenerate)).toThrow();
  });
});

describe("buildTraceparent", () => {
  it("emits a sampled v00 traceparent derived from the uuid", () => {
    expect(buildTraceparent("1B671A64-40D5-491E-99B0-DA01FF1F3341")).toBe("00-1b671a6440d5491e99b0da01ff1f3341-99b0da01ff1f3341-01");
  });

  it("always matches the W3C traceparent grammar", () => {
    for (let i = 0; i < 20; i++) {
      expect(buildTraceparent(crypto.randomUUID())).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    }
  });
});

describe("wire type lists", () => {
  it("keeps the system type lists $-prefixed and unique", () => {
    for (const list of [SYSTEM_EVENT_TYPES, CLIENT_SYSTEM_SPAN_TYPES]) {
      expect(new Set(list).size).toBe(list.length);
      for (const type of list) expect(type.startsWith("$")).toBe(true);
    }
  });

  it("includes the new wire types the ingestion route must accept", () => {
    expect(SYSTEM_EVENT_TYPES).toContain("$error");
    expect(SYSTEM_EVENT_TYPES).toContain("$log");
    expect(CLIENT_SYSTEM_SPAN_TYPES).toContain("$http-client");
  });
});
