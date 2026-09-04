import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadCrons, matches, parseField, parseSchedule } from "./cron-schedule.mjs";

const VERCEL_CRON_MANIFEST = fileURLToPath(new URL("../apps/backend/vercel.json", import.meta.url));

/** Builds a UTC date, so tests behave identically whatever TZ the runner has. */
function utc(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

function fires(expression, date) {
  return matches(parseSchedule(expression), date);
}

describe("parseField", () => {
  test("expands a wildcard across the whole range", () => {
    expect([...parseField("*", 0, 5, "test")]).toMatchInlineSnapshot(`
      [
        0,
        1,
        2,
        3,
        4,
        5,
      ]
    `);
  });

  test("a bare value matches only itself", () => {
    expect([...parseField("3", 0, 59, "minute")]).toMatchInlineSnapshot(`
      [
        3,
      ]
    `);
  });

  test("expands a step over the full range", () => {
    expect([...parseField("*/15", 0, 59, "minute")]).toMatchInlineSnapshot(`
      [
        0,
        15,
        30,
        45,
      ]
    `);
  });

  test("expands an explicit range", () => {
    expect([...parseField("2-5", 0, 59, "minute")]).toMatchInlineSnapshot(`
      [
        2,
        3,
        4,
        5,
      ]
    `);
  });

  test("expands a stepped range", () => {
    expect([...parseField("0-20/10", 0, 59, "minute")]).toMatchInlineSnapshot(`
      [
        0,
        10,
        20,
      ]
    `);
  });

  test("a step on a bare value runs from that value to the end of the range", () => {
    // `5/15` is crontab shorthand for "from 5 onwards, every 15" — distinct from
    // a bare `5`, which is a single value. Getting this wrong silently drops firings.
    expect([...parseField("5/15", 0, 59, "minute")]).toMatchInlineSnapshot(`
      [
        5,
        20,
        35,
        50,
      ]
    `);
  });

  test("merges comma-separated parts", () => {
    expect([...parseField("1,5,9", 0, 59, "minute")]).toMatchInlineSnapshot(`
      [
        1,
        5,
        9,
      ]
    `);
  });

  test("rejects a value outside the field's range", () => {
    expect(() => parseField("60", 0, 59, "minute")).toThrowErrorMatchingInlineSnapshot(
      `[Error: railway/cron: invalid range "60" in minute field "60"]`,
    );
  });

  test("rejects an inverted range", () => {
    expect(() => parseField("10-2", 0, 59, "minute")).toThrowErrorMatchingInlineSnapshot(
      `[Error: railway/cron: invalid range "10-2" in minute field "10-2"]`,
    );
  });

  test("rejects a non-positive step", () => {
    expect(() => parseField("*/0", 0, 59, "minute")).toThrowErrorMatchingInlineSnapshot(
      `[Error: railway/cron: invalid step "0" in minute field "*/0"]`,
    );
  });
});

describe("parseSchedule", () => {
  test("rejects an expression that is not five fields", () => {
    expect(() => parseSchedule("* * * *")).toThrowErrorMatchingInlineSnapshot(
      `[Error: railway/cron: expected a 5-field crontab expression, got "* * * *"]`,
    );
  });
});

describe("matches", () => {
  test("`* * * * *` fires on every minute", () => {
    expect(fires("* * * * *", utc(2026, 8, 25, 13, 0))).toBe(true);
    expect(fires("* * * * *", utc(2026, 8, 25, 13, 37))).toBe(true);
  });

  test("`*/5 * * * *` fires only on multiples of five", () => {
    const firing = [];
    for (let minute = 0; minute < 20; minute++) {
      if (fires("*/5 * * * *", utc(2026, 8, 25, 13, minute))) firing.push(minute);
    }
    expect(firing).toMatchInlineSnapshot(`
      [
        0,
        5,
        10,
        15,
      ]
    `);
  });

  test("is evaluated in UTC, not the runner's local time", () => {
    // Vercel Cron schedules are UTC. If matching ever used local getters, this
    // date would match at a different wall-clock minute under a non-UTC TZ.
    const midnightUtc = new Date(Date.UTC(2026, 7, 25, 0, 30));
    expect(fires("30 0 * * *", midnightUtc)).toBe(true);
    expect(fires("30 23 * * *", midnightUtc)).toBe(false);
  });

  test("honours the hour field", () => {
    expect(fires("0 9 * * *", utc(2026, 8, 25, 9, 0))).toBe(true);
    expect(fires("0 9 * * *", utc(2026, 8, 25, 10, 0))).toBe(false);
  });

  test("honours the month field", () => {
    expect(fires("0 0 1 3 *", utc(2026, 3, 1, 0, 0))).toBe(true);
    expect(fires("0 0 1 3 *", utc(2026, 4, 1, 0, 0))).toBe(false);
  });

  test("when only day-of-month is restricted, day-of-week is ignored", () => {
    // 2026-08-25 is a Tuesday.
    expect(fires("0 0 25 * *", utc(2026, 8, 25, 0, 0))).toBe(true);
    expect(fires("0 0 25 * *", utc(2026, 8, 26, 0, 0))).toBe(false);
  });

  test("when only day-of-week is restricted, day-of-month is ignored", () => {
    expect(fires("0 0 * * 2", utc(2026, 8, 25, 0, 0))).toBe(true);
    expect(fires("0 0 * * 3", utc(2026, 8, 25, 0, 0))).toBe(false);
  });

  test("when both day fields are restricted, either one firing is enough", () => {
    // Standard crontab ORs the two day fields rather than ANDing them. 2026-08-25
    // is a Tuesday (day 2), so each of these matches on exactly one of the fields.
    expect(fires("0 0 25 * 5", utc(2026, 8, 25, 0, 0))).toBe(true);
    expect(fires("0 0 1 * 2", utc(2026, 8, 25, 0, 0))).toBe(true);
    expect(fires("0 0 1 * 5", utc(2026, 8, 25, 0, 0))).toBe(false);
  });
});

describe("loadCrons", () => {
  // The runner reads the backend's own Vercel cron manifest so the self-hosted
  // schedule cannot drift from it. This asserts the real file parses and pins the
  // current set: if upstream adds or renames a cron, this snapshot changes and
  // whoever merges gets to confirm the new job is expected to run on Railway too.
  test("parses the backend's Vercel cron manifest", () => {
    const crons = loadCrons(VERCEL_CRON_MANIFEST);
    expect(crons.map((cron) => `${cron.expression}  ${cron.path}`)).toMatchInlineSnapshot(`
      [
        "* * * * *  /api/latest/internal/email-queue-step",
        "* * * * *  /api/latest/internal/external-db-sync/poller",
        "* * * * *  /api/latest/internal/external-db-sync/sequencer",
        "* * * * *  /api/latest/internal/workflow-engine-step",
        "*/5 * * * *  /api/latest/internal/growth-watchdog-step",
      ]
    `);
  });

  test("every manifest entry fires at least once an hour", () => {
    // A guard against a schedule that parses but never matches: each of these jobs
    // is expected to be frequent, and a typo'd expression that quietly stops firing
    // is otherwise invisible until a queue backs up.
    const crons = loadCrons(VERCEL_CRON_MANIFEST);
    for (const cron of crons) {
      const firingMinutes = [];
      for (let minute = 0; minute < 60; minute++) {
        if (matches(cron.schedule, utc(2026, 8, 25, 12, minute))) firingMinutes.push(minute);
      }
      expect(firingMinutes.length, `${cron.path} (${cron.expression})`).toBeGreaterThan(0);
    }
  });
});
