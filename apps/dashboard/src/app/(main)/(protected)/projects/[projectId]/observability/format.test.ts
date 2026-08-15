import { describe, expect, it } from "vitest";
import {
  formatAbsoluteTimeFromMillis,
  formatDateFromMillis,
  formatDuration,
  formatRelativeTimeFromMillis,
  tryParseJson,
} from "./format";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");

describe("formatRelativeTimeFromMillis", () => {
  it("collapses the recent past into 'just now'", () => {
    expect(formatRelativeTimeFromMillis(NOW, NOW)).toBe("just now");
    expect(formatRelativeTimeFromMillis(NOW - 30_000, NOW)).toBe("just now");
  });

  it("reads a future timestamp as 'just now' rather than 'in 3 minutes'", () => {
    // Browser/server clock skew makes fresh rows look like they arrived in the
    // future; "just now" is truthful for both cases.
    expect(formatRelativeTimeFromMillis(NOW + 180_000, NOW)).toBe("just now");
  });

  it("steps up through the units", () => {
    expect(formatRelativeTimeFromMillis(NOW - 5 * 60_000, NOW)).toContain("5");
    expect(formatRelativeTimeFromMillis(NOW - 3 * 3_600_000, NOW)).toContain("3");
    expect(formatRelativeTimeFromMillis(NOW - 4 * 86_400_000, NOW)).toContain("4");
  });

  it("throws rather than rendering NaN", () => {
    expect(() => formatRelativeTimeFromMillis(Number.NaN, NOW)).toThrow();
  });
});

describe("formatAbsoluteTimeFromMillis / formatDateFromMillis", () => {
  it("renders something non-empty and deterministic for a valid instant", () => {
    expect(formatAbsoluteTimeFromMillis(NOW).length).toBeGreaterThan(0);
    expect(formatDateFromMillis(NOW).length).toBeGreaterThan(0);
    // The date form drops the clock; the absolute form keeps it.
    expect(formatDateFromMillis(NOW)).not.toBe(formatAbsoluteTimeFromMillis(NOW));
  });

  it("throws on a non-finite instant", () => {
    expect(() => formatAbsoluteTimeFromMillis(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatDateFromMillis(Number.NaN)).toThrow();
  });
});

describe("formatDuration", () => {
  it("still renders the magnitudes the Observability pages agreed on", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0.4)).toBe("400µs");
    expect(formatDuration(90_000)).toBe("1m 30s");
  });
});

describe("tryParseJson", () => {
  it("returns the original value when it isn't JSON", () => {
    expect(tryParseJson("{oops")).toBe("{oops");
    expect(tryParseJson({ already: "parsed" })).toEqual({ already: "parsed" });
  });
});
