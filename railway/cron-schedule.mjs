/**
 * Crontab parsing and matching for the in-container Railway cron runner.
 *
 * Kept free of I/O and timers (apart from the explicit loadCrons reader) so the
 * matching rules can be tested directly — this is the piece where a subtle bug
 * means a scheduled job silently never runs.
 */

import { readFileSync } from "node:fs";

/**
 * Parses one crontab field into the set of values it matches. Supports the
 * standard forms: `*`, `n`, `a-b`, and any of those with a `/step` suffix.
 */
export function parseField(expression, min, max, fieldName) {
  const values = new Set();
  for (const part of expression.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`railway/cron: invalid step "${stepPart}" in ${fieldName} field "${expression}"`);
    }
    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [rangeStart, rangeEnd] = rangePart.split("-").map(Number);
      start = rangeStart;
      end = rangeEnd;
    } else {
      start = Number(rangePart);
      // `5/15` is shorthand for "from 5 to the end of the range, every 15",
      // whereas a bare `5` matches only 5.
      end = stepPart === undefined ? start : max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`railway/cron: invalid range "${rangePart}" in ${fieldName} field "${expression}"`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

export function parseSchedule(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`railway/cron: expected a 5-field crontab expression, got "${expression}"`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    minute: parseField(minute, 0, 59, "minute"),
    hour: parseField(hour, 0, 23, "hour"),
    dayOfMonth: parseField(dayOfMonth, 1, 31, "day-of-month"),
    month: parseField(month, 1, 12, "month"),
    dayOfWeek: parseField(dayOfWeek, 0, 6, "day-of-week"),
    // Retained for the day-of-month/day-of-week OR rule in matches().
    dayOfMonthRestricted: dayOfMonth !== "*",
    dayOfWeekRestricted: dayOfWeek !== "*",
  };
}

/**
 * Matched in UTC, because Vercel Cron evaluates schedules in UTC and these
 * expressions are copied verbatim from the Vercel config. Using local time would
 * silently shift every schedule if the container's TZ were ever set.
 */
export function matches(schedule, date) {
  if (!schedule.minute.has(date.getUTCMinutes())) return false;
  if (!schedule.hour.has(date.getUTCHours())) return false;
  if (!schedule.month.has(date.getUTCMonth() + 1)) return false;

  // Standard crontab semantics: when both day fields are restricted the job runs
  // if EITHER matches; when only one is restricted, only that one is consulted.
  const dayOfMonthMatches = schedule.dayOfMonth.has(date.getUTCDate());
  const dayOfWeekMatches = schedule.dayOfWeek.has(date.getUTCDay());
  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) {
    return dayOfMonthMatches || dayOfWeekMatches;
  }
  if (schedule.dayOfMonthRestricted) return dayOfMonthMatches;
  if (schedule.dayOfWeekRestricted) return dayOfWeekMatches;
  return true;
}

/**
 * Reads the Vercel cron manifest and parses every entry. Deliberately parses all
 * schedules eagerly so a malformed expression fails at startup rather than at the
 * minute it would first have fired.
 */
export function loadCrons(schedulePath) {
  const config = JSON.parse(readFileSync(schedulePath, "utf8"));
  if (!Array.isArray(config.crons)) {
    throw new Error(`railway/cron: ${schedulePath} has no "crons" array`);
  }
  return config.crons.map((cron) => {
    if (typeof cron.path !== "string" || typeof cron.schedule !== "string") {
      throw new Error(`railway/cron: malformed cron entry in ${schedulePath}: ${JSON.stringify(cron)}`);
    }
    return {
      path: cron.path,
      expression: cron.schedule,
      schedule: parseSchedule(cron.schedule),
    };
  });
}
