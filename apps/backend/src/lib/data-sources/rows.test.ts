import { describe, expect, it } from "vitest";
import { versionFromCursorValue } from "./rows";

describe("sync versions", () => {
  it("keeps pre-1970 timestamps positive for a UInt64 column", () => {
    // ClickHouse rejects a leading '-' outright, and ORDER BY cursor ASC puts the
    // oldest rows in the very first batch — so this used to fail every sync.
    const old = versionFromCursorValue(new Date("1900-01-01T00:00:00Z"));
    expect(old > 0n).toBe(true);
    expect(old < versionFromCursorValue(new Date("2026-01-01T00:00:00Z"))).toBe(true);
  });

  it("orders timestamps regardless of representation", () => {
    expect(versionFromCursorValue(new Date("2026-01-01T00:00:00Z")))
      .toBe(versionFromCursorValue("2026-01-01T00:00:00.000Z"));
  });

  it("clamps negative integer cursors instead of failing the batch", () => {
    expect(versionFromCursorValue(-5)).toBe(0n);
    expect(versionFromCursorValue("42")).toBe(42n);
  });

  it("refuses a value it cannot order", () => {
    expect(() => versionFromCursorValue({})).toThrow("Cannot derive a sync version");
  });
});
