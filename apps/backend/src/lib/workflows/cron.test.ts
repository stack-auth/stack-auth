import { describe, expect, test } from "vitest";
import { cronMatchesAt, isValidTimezone, listCronOccurrences, parseCronExpression } from "./cron";

const parse = (cron: string) => {
  const result = parseCronExpression(cron);
  if (result.status === "error") throw new Error(result.error);
  return result.data;
};

describe("parseCronExpression", () => {
  test("parses stars, numbers, lists, ranges, steps", () => {
    expect(parse("* * * * *")).toEqual({
      minute: { values: null },
      hour: { values: null },
      dayOfMonth: { values: null },
      month: { values: null },
      dayOfWeek: { values: null },
    });
    expect(parse("0 11 * * 1").minute.values).toEqual([0]);
    expect(parse("0 11 * * 1").hour.values).toEqual([11]);
    expect(parse("0 11 * * 1").dayOfWeek.values).toEqual([1]);
    expect(parse("*/15 * * * *").minute.values).toEqual([0, 15, 30, 45]);
    expect(parse("1,3,5 * * * *").minute.values).toEqual([1, 3, 5]);
    expect(parse("10-14 * * * *").minute.values).toEqual([10, 11, 12, 13, 14]);
    expect(parse("10-20/5 * * * *").minute.values).toEqual([10, 15, 20]);
  });

  test("normalizes day-of-week 7 to 0 (both mean Sunday)", () => {
    expect(parse("* * * * 7").dayOfWeek.values).toEqual([0]);
    expect(parse("* * * * 0,7").dayOfWeek.values).toEqual([0]);
  });

  test("rejects malformed expressions", () => {
    expect(parseCronExpression("* * * *").status).toBe("error");
    expect(parseCronExpression("60 * * * *").status).toBe("error");
    expect(parseCronExpression("* 24 * * *").status).toBe("error");
    expect(parseCronExpression("* * 0 * *").status).toBe("error");
    expect(parseCronExpression("* * * 13 *").status).toBe("error");
    expect(parseCronExpression("* * * * 8").status).toBe("error");
    expect(parseCronExpression("MON * * * *").status).toBe("error");
    expect(parseCronExpression("5-1 * * * *").status).toBe("error");
    expect(parseCronExpression("5/2 * * * *").status).toBe("error");
  });
});

describe("isValidTimezone", () => {
  test("accepts IANA timezones, rejects garbage", () => {
    expect(isValidTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("cronMatchesAt", () => {
  test("matches wall-clock time in the target timezone", () => {
    // 2026-07-20T18:00:00Z = 11:00 in Los Angeles (PDT, UTC-7), a Monday.
    const instant = new Date("2026-07-20T18:00:00Z");
    expect(cronMatchesAt(parse("0 11 * * 1"), instant, "America/Los_Angeles")).toBe(true);
    expect(cronMatchesAt(parse("0 11 * * 2"), instant, "America/Los_Angeles")).toBe(false);
    expect(cronMatchesAt(parse("0 18 * * 1"), instant, "UTC")).toBe(true);
    expect(cronMatchesAt(parse("0 11 * * 1"), instant, "UTC")).toBe(false);
  });

  test("vixie day semantics: dom OR dow when both are restricted", () => {
    // 2026-07-20 is a Monday, the 20th.
    const instant = new Date("2026-07-20T00:30:00Z");
    // dom matches (20), dow doesn't (Friday) — restricted both => OR => match
    expect(cronMatchesAt(parse("30 0 20 * 5"), instant, "UTC")).toBe(true);
    // Neither matches.
    expect(cronMatchesAt(parse("30 0 21 * 5"), instant, "UTC")).toBe(false);
    // Only dow restricted and doesn't match.
    expect(cronMatchesAt(parse("30 0 * * 5"), instant, "UTC")).toBe(false);
  });
});

describe("listCronOccurrences", () => {
  test("returns every matching minute in (from, to], ascending", () => {
    const from = new Date("2026-07-20T10:00:30Z");
    const to = new Date("2026-07-20T10:45:00Z");
    const occurrences = listCronOccurrences(parse("*/15 * * * *"), "UTC", from, to);
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      "2026-07-20T10:15:00.000Z",
      "2026-07-20T10:30:00.000Z",
      "2026-07-20T10:45:00.000Z",
    ]);
  });

  test("catch-up: a daily schedule down for 3 days yields all 3 occurrences (delayed, never skipped)", () => {
    const from = new Date("2026-07-17T12:30:00Z");
    const to = new Date("2026-07-20T12:00:00Z");
    const occurrences = listCronOccurrences(parse("0 11 * * *"), "UTC", from, to);
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      "2026-07-18T11:00:00.000Z",
      "2026-07-19T11:00:00.000Z",
      "2026-07-20T11:00:00.000Z",
    ]);
  });

  test("DST spring-forward: skipped wall times never match", () => {
    // In America/Los_Angeles, 2026-03-08 02:30 local does not exist
    // (clocks jump 02:00 -> 03:00).
    const from = new Date("2026-03-08T00:00:00-08:00");
    const to = new Date("2026-03-08T23:00:00-07:00");
    const occurrences = listCronOccurrences(parse("30 2 * * *"), "America/Los_Angeles", from, to);
    expect(occurrences).toEqual([]);
  });
});
