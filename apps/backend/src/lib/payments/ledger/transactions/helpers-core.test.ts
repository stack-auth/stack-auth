import { describe, expect, it } from "vitest";
import { addInterval } from "./helpers-core";

function utc(iso: string): number {
  return new Date(iso).getTime();
}

describe("addInterval", () => {
  describe("day arithmetic uses UTC (no DST drift)", () => {
    it("adds 1 day across US spring-forward DST boundary", () => {
      const base = utc("2025-03-09T07:30:00Z");
      const result = addInterval(base, [1, "day"]);
      expect(result).toBe(utc("2025-03-10T07:30:00Z"));
    });

    it("adds 1 day across US fall-back DST boundary", () => {
      const base = utc("2025-11-02T07:30:00Z");
      const result = addInterval(base, [1, "day"]);
      expect(result).toBe(utc("2025-11-03T07:30:00Z"));
    });

    it("adds 7 days (1 week) across DST boundary", () => {
      const base = utc("2025-03-08T12:00:00Z");
      const result = addInterval(base, [1, "week"]);
      expect(result).toBe(utc("2025-03-15T12:00:00Z"));
    });
  });

  describe("month arithmetic clamps to end of month", () => {
    it("Jan 31 + 1 month = Feb 28 (non-leap year)", () => {
      const result = addInterval(utc("2025-01-31T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2025-02-28T12:00:00Z"));
    });

    it("Jan 31 + 1 month = Feb 29 (leap year)", () => {
      const result = addInterval(utc("2024-01-31T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2024-02-29T12:00:00Z"));
    });

    it("Mar 31 + 1 month = Apr 30", () => {
      const result = addInterval(utc("2025-03-31T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2025-04-30T12:00:00Z"));
    });

    it("Aug 31 + 1 month = Sep 30", () => {
      const result = addInterval(utc("2025-08-31T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2025-09-30T12:00:00Z"));
    });

    it("Dec 31 + 1 month = Jan 31", () => {
      const result = addInterval(utc("2025-12-31T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2026-01-31T12:00:00Z"));
    });

    it("Dec 31 + 2 months = Feb 28 (not Mar 3)", () => {
      const result = addInterval(utc("2025-12-31T12:00:00Z"), [2, "month"]);
      expect(result).toBe(utc("2026-02-28T12:00:00Z"));
    });

    it("Jan 30 + 1 month = Feb 28 (not Mar 2)", () => {
      const result = addInterval(utc("2025-01-30T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2025-02-28T12:00:00Z"));
    });

    it("Jan 29 + 1 month = Feb 28 in non-leap year", () => {
      const result = addInterval(utc("2025-01-29T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2025-02-28T12:00:00Z"));
    });

    it("Jan 29 + 1 month = Feb 29 in leap year", () => {
      const result = addInterval(utc("2024-01-29T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2024-02-29T12:00:00Z"));
    });

    it("normal case: Jan 15 + 1 month = Feb 15", () => {
      const result = addInterval(utc("2025-01-15T12:00:00Z"), [1, "month"]);
      expect(result).toBe(utc("2025-02-15T12:00:00Z"));
    });
  });

  describe("year arithmetic clamps leap day", () => {
    it("Feb 29 + 1 year = Feb 28 (next year is not leap)", () => {
      const result = addInterval(utc("2024-02-29T12:00:00Z"), [1, "year"]);
      expect(result).toBe(utc("2025-02-28T12:00:00Z"));
    });

    it("Feb 29 + 4 years = Feb 29 (next leap year)", () => {
      const result = addInterval(utc("2024-02-29T12:00:00Z"), [4, "year"]);
      expect(result).toBe(utc("2028-02-29T12:00:00Z"));
    });

    it("normal case: Mar 15 + 1 year", () => {
      const result = addInterval(utc("2025-03-15T12:00:00Z"), [1, "year"]);
      expect(result).toBe(utc("2026-03-15T12:00:00Z"));
    });
  });

  describe("minute and hour use UTC", () => {
    it("adds 90 minutes", () => {
      const result = addInterval(utc("2025-03-09T06:30:00Z"), [90, "minute"]);
      expect(result).toBe(utc("2025-03-09T08:00:00Z"));
    });

    it("adds 2 hours", () => {
      const result = addInterval(utc("2025-03-09T06:00:00Z"), [2, "hour"]);
      expect(result).toBe(utc("2025-03-09T08:00:00Z"));
    });
  });
});
