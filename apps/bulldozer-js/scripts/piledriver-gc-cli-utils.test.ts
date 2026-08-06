import { describe, expect, it } from "vitest";
import { parsePiledriverGcMaxObjects, parsePiledriverGcTimestamp } from "./piledriver-gc-cli-utils.js";

describe("Piledriver GC CLI parsing", () => {
  it("accepts epoch milliseconds and unambiguous ISO-8601 timestamps", () => {
    expect(parsePiledriverGcTimestamp("0")).toBe(0);
    expect(parsePiledriverGcTimestamp("2026-08-06T14:24:00Z")).toBe(Date.parse("2026-08-06T14:24:00Z"));
    expect(parsePiledriverGcTimestamp("2026-08-06T14:24:00.123-07:00")).toBe(Date.parse("2026-08-06T14:24:00.123-07:00"));
    expect(parsePiledriverGcTimestamp("2024-02-29T00:00:00Z")).toBe(Date.parse("2024-02-29T00:00:00Z"));
    expect(parsePiledriverGcTimestamp("8640000000000000")).toBe(8_640_000_000_000_000);
  });

  it("rejects ambiguous, timezone-free, invalid, and unrepresentable timestamps", () => {
    for (const value of [
      "August 6, 2026",
      "2026-08-06",
      "2026-08-06T14:24:00",
      "2026-02-29T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-13-06T14:24:00Z",
      "2026-08-06T24:00:00Z",
      "8640000000000001",
    ]) {
      expect(() => parsePiledriverGcTimestamp(value)).toThrow("GC cutoff");
    }
  });

  it("only accepts positive safe integer object limits", () => {
    expect(parsePiledriverGcMaxObjects(undefined)).toBeUndefined();
    expect(parsePiledriverGcMaxObjects("25")).toBe(25);
    for (const value of ["0", "-1", "1.5", "not-a-number"]) {
      expect(() => parsePiledriverGcMaxObjects(value)).toThrow("positive safe integer");
    }
  });
});
