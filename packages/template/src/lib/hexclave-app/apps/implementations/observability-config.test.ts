import { describe, expect, it } from "vitest";
import { normalizeTraceSampleRate } from "./observability-config";

describe("normalizeTraceSampleRate", () => {
  it("defaults to full trace capture", () => {
    expect(normalizeTraceSampleRate(undefined)).toBe(1);
  });

  it("accepts the top-level trace rate and the deprecated network alias", () => {
    expect(normalizeTraceSampleRate({ traceSampleRate: 0.1 })).toBe(0.1);
    expect(normalizeTraceSampleRate({ network: { sampleRate: 0.25 } })).toBe(0.25);
    expect(normalizeTraceSampleRate({ traceSampleRate: 0.1, network: { sampleRate: 0.1 } })).toBe(0.1);
  });

  it("rejects invalid or conflicting rates at app construction", () => {
    expect(() => normalizeTraceSampleRate({ traceSampleRate: -0.1 })).toThrow(/between 0 and 1/);
    expect(() => normalizeTraceSampleRate({ traceSampleRate: Number.NaN })).toThrow(/between 0 and 1/);
    expect(() => normalizeTraceSampleRate({ traceSampleRate: 0.1, network: { sampleRate: 0.2 } })).toThrow(/must match/);
  });
});
