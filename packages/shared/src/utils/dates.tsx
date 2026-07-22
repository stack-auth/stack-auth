import { intervalSchema } from "../schema-fields";
import { HexclaveAssertionError } from "./errors";
import { remainder } from "./math";

export function isWeekend(date: Date): boolean {
  return date.getDay() === 0 || date.getDay() === 6;
}

import.meta.vitest?.test("isWeekend", ({ expect }) => {
  // Sunday (day 0)
  expect(isWeekend(new Date(2023, 0, 1))).toBe(true);
  // Saturday (day 6)
  expect(isWeekend(new Date(2023, 0, 7))).toBe(true);
  // Monday (day 1)
  expect(isWeekend(new Date(2023, 0, 2))).toBe(false);
  // Friday (day 5)
  expect(isWeekend(new Date(2023, 0, 6))).toBe(false);
});

const agoUnits = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [7, 'day'],
  [5, 'week'],
] as const;

export function fromNow(date: Date): string {
  return fromNowDetailed(date).result;
}

import.meta.vitest?.test("fromNow", ({ expect }) => {
  // Set a fixed date for testing
  const fixedDate = new Date("2023-01-15T12:00:00.000Z");

  // Use Vitest's fake timers
  import.meta.vitest?.vi.useFakeTimers();
  import.meta.vitest?.vi.setSystemTime(fixedDate);

  // Test past times
  expect(fromNow(new Date("2023-01-15T11:59:50.000Z"))).toBe("just now");
  expect(fromNow(new Date("2023-01-15T11:59:00.000Z"))).toBe("1 minute ago");
  expect(fromNow(new Date("2023-01-15T11:00:00.000Z"))).toBe("1 hour ago");
  expect(fromNow(new Date("2023-01-14T12:00:00.000Z"))).toBe("1 day ago");
  expect(fromNow(new Date("2023-01-08T12:00:00.000Z"))).toBe("1 week ago");

  // Test future times
  expect(fromNow(new Date("2023-01-15T12:00:10.000Z"))).toBe("just now");
  expect(fromNow(new Date("2023-01-15T12:01:00.000Z"))).toBe("in 1 minute");
  expect(fromNow(new Date("2023-01-15T13:00:00.000Z"))).toBe("in 1 hour");
  expect(fromNow(new Date("2023-01-16T12:00:00.000Z"))).toBe("in 1 day");
  expect(fromNow(new Date("2023-01-22T12:00:00.000Z"))).toBe("in 1 week");

  // Test very old dates (should use date format)
  expect(fromNow(new Date("2022-01-15T12:00:00.000Z"))).toMatch(/Jan 15, 2022/);

  // Restore real timers
  import.meta.vitest?.vi.useRealTimers();
});

export function fromNowDetailed(date: Date): {
  result: string,
  /**
   * May be Infinity if the result will never change.
   */
  secondsUntilChange: number,
} {
  if (!(date instanceof Date)) {
    throw new Error(`fromNow only accepts Date objects (received: ${date})`);
  }

  const now = new Date();
  const elapsed = now.getTime() - date.getTime();

  let remainingInUnit = Math.abs(elapsed) / 1000;
  if (remainingInUnit < 15) {
    return {
      result: 'just now',
      secondsUntilChange: 15 - remainingInUnit,
    };
  }
  let unitInSeconds = 1;
  for (const [nextUnitSize, unitName] of agoUnits) {
    const rounded = Math.round(remainingInUnit);
    if (rounded < nextUnitSize) {
      if (elapsed < 0) {
        return {
          result: `in ${rounded} ${unitName}${rounded === 1 ? '' : 's'}`,
          secondsUntilChange: remainder((remainingInUnit - rounded + 0.5) * unitInSeconds, unitInSeconds),
        };
      } else {
        return {
          result: `${rounded} ${unitName}${rounded === 1 ? '' : 's'} ago`,
          secondsUntilChange: remainder((rounded - remainingInUnit - 0.5) * unitInSeconds, unitInSeconds),
        };
      }
    }
    unitInSeconds *= nextUnitSize;
    remainingInUnit /= nextUnitSize;
  }

  return {
    result: date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    secondsUntilChange: Infinity,
  };
}

/**
 * Returns a string representation of the given date in the format expected by the `datetime-local` input type.
 */
export function getInputDatetimeLocalString(date: Date): string {
  date = new Date(date);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 19);
}

import.meta.vitest?.test("getInputDatetimeLocalString", ({ expect }) => {
  // Use Vitest's fake timers to ensure consistent timezone behavior
  import.meta.vitest?.vi.useFakeTimers();

  // Test with a specific date
  const mockDate = new Date("2023-01-15T12:30:45.000Z");
  const result = getInputDatetimeLocalString(mockDate);

  // The result should be in the format YYYY-MM-DDTHH:MM:SS
  expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

  // Test with different dates
  const dates = [
    new Date("2023-01-01T00:00:00.000Z"),
    new Date("2023-06-15T23:59:59.000Z"),
    new Date("2023-12-31T12:34:56.000Z"),
  ];

  for (const date of dates) {
    const result = getInputDatetimeLocalString(date);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  }

  // Restore real timers
  import.meta.vitest?.vi.useRealTimers();
});


export type Interval = [number, 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'];
export type DayInterval = [number, 'day' | 'week' | 'month' | 'year'];

function applyInterval(inputDate: Date, times: number, interval: Interval): Date {
  if (!intervalSchema.isValidSync(interval)) {
    throw new HexclaveAssertionError(`Invalid interval`, { interval });
  }
  // Operate on a copy: the Date setters below mutate in place, and callers routinely pass a date they
  // also keep a reference to (e.g. `{ currentPeriodStart: now, currentPeriodEnd: addInterval(now, ...) }`).
  // Mutating the input would alias both fields to the same advanced date, silently collapsing the period.
  const date = new Date(inputDate);
  const [amount, unit] = interval;
  switch (unit) {
    case 'millisecond': {
      date.setMilliseconds(date.getMilliseconds() + amount * times);
      break;
    }
    case 'second': {
      date.setSeconds(date.getSeconds() + amount * times);
      break;
    }
    case 'minute': {
      date.setMinutes(date.getMinutes() + amount * times);
      break;
    }
    case 'hour': {
      date.setHours(date.getHours() + amount * times);
      break;
    }
    case 'day': {
      date.setDate(date.getDate() + amount * times);
      break;
    }
    case 'week': {
      date.setDate(date.getDate() + amount * times * 7);
      break;
    }
    case 'month': {
      date.setMonth(date.getMonth() + amount * times);
      break;
    }
    case 'year': {
      date.setFullYear(date.getFullYear() + amount * times);
      break;
    }
    default: {
      throw new HexclaveAssertionError(`Invalid interval despite schema validation`, { interval });
    }
  }
  return date;
}

export function subtractInterval(date: Date, interval: Interval): Date {
  return applyInterval(date, -1, interval);
}

// One-shot local-time interval arithmetic that OVERFLOWS (Jan 31 + 1 month -> Mar 3, via
// Date#setMonth) rather than clamping. Use this for single-step period math where JS/Stripe overflow
// semantics are what we want (e.g. computing a subscription's currentPeriodEnd). For recurring
// grant/reset BOUNDARIES, use `nthDayIntervalMillis` / `getIntervalsElapsed` instead — they clamp to
// month-end and compute in UTC from a fixed anchor, and mixing the two would drift.
export function addInterval(date: Date, interval: Interval): Date {
  return applyInterval(date, 1, interval);
}

import.meta.vitest?.test("addInterval/subtractInterval do not mutate their input", ({ expect }) => {
  const original = new Date('2026-07-20T00:00:00.000Z');
  const originalMillis = original.getTime();

  const later = addInterval(original, [1, 'month']);
  const earlier = subtractInterval(original, [1, 'month']);

  // The input must be untouched, and the result must be a distinct object. This guards the aliasing
  // footgun in `{ currentPeriodStart: now, currentPeriodEnd: addInterval(now, ...) }`, where mutating
  // `now` would collapse both fields to the same advanced instant (a zero-width period).
  expect(original.getTime()).toBe(originalMillis);
  expect(later).not.toBe(original);
  expect(earlier).not.toBe(original);
  expect(later).toEqual(new Date('2026-08-20T00:00:00.000Z'));
  expect(earlier).toEqual(new Date('2026-06-20T00:00:00.000Z'));
});

export const FAR_FUTURE_DATE = new Date(8640000000000000); // 13 Sep 275760 00:00:00 UTC

function getMsPerDayIntervalUnit(unit: 'day' | 'week'): number {
  if (unit === 'day') {
    return 24 * 60 * 60 * 1000;
  }
  return 7 * 24 * 60 * 60 * 1000;
}


// The number of full `repeat` intervals elapsed from `anchor` up to (and including) `to`, i.e. the
// largest n >= 0 with the n-th boundary <= to. Boundaries are the SAME ones `nthDayIntervalMillis`
// computes (anchor-relative, UTC, month-end clamped), so counting and boundary-computation never
// disagree — a Jan 31 monthly anchor has elapsed one interval by Feb 28, matching the reset the
// bulldozer item-repeat fold actually emits. (This is why it must NOT be built on `addInterval`,
// which is local-time and overflows instead of clamping.)
export function getIntervalsElapsed(anchor: Date, to: Date, repeat: DayInterval): number {
  const [amount, unit] = repeat;
  const toMillis = to.getTime();
  if (toMillis <= anchor.getTime()) return 0;
  if (unit === 'day' || unit === 'week') {
    const msPerUnit = getMsPerDayIntervalUnit(unit);
    const diffMs = toMillis - anchor.getTime();
    return Math.floor(diffMs / (msPerUnit * amount));
  }
  // month/year: walk anchor-relative boundaries. The count is small in practice (bounded by the
  // number of billing periods since the anchor), so a linear walk is fine.
  let count = 0;
  while (nthDayIntervalMillis(anchor.getTime(), repeat, count + 1) <= toMillis) count += 1;
  return count;
}

import.meta.vitest?.test("getIntervalsElapsed", ({ expect }) => {
  const anchor = new Date('2025-01-01T00:00:00.000Z');
  const to = new Date('2025-01-15T00:00:00.000Z');
  expect(getIntervalsElapsed(anchor, to, [1, 'week'])).toBe(2);
  expect(getIntervalsElapsed(anchor, to, [3, 'day'])).toBe(4);

  // Jan 31 monthly anchor: the first boundary is clamped to Feb 28, which is <= Mar 1, so one
  // interval has elapsed (anchor-relative clamped math, consistent with nthDayIntervalMillis).
  const mAnchor = new Date('2023-01-31T00:00:00.000Z');
  const mTo = new Date('2023-03-01T00:00:00.000Z');
  expect(getIntervalsElapsed(mAnchor, mTo, [1, 'month'])).toBe(1);

  const yAnchor = new Date('2020-01-01T00:00:00.000Z');
  const yTo = new Date('2022-06-01T00:00:00.000Z');
  expect(getIntervalsElapsed(yAnchor, yTo, [1, 'year'])).toBe(2);
});

/**
 * The UTC millis of the `occurrence`-th (1-based) repeat of `interval` after `anchorMillis`.
 *
 * Each boundary is computed from the *original* anchor (never by stepping off the previous, possibly
 * clamped, boundary) so the anchor's day-of-month is preserved across resets: a Jan 31 anchor yields
 * Feb 28, Mar 31, Apr 30, ... (matching Stripe's billing-cycle behavior) rather than drifting to
 * Feb 28, Mar 28, ... . Month/year overflow (e.g. Jan 31 -> Feb) is clamped to the target month's
 * last day. Day/week are exact multiples (no calendar involved, so no drift possible).
 *
 * Everything is done in UTC (unlike `addInterval`, which uses local-time Date accessors) so the
 * result is deterministic regardless of the server's timezone — this is relied upon by bulldozer
 * folds, which must be reproducible across machines.
 *
 * `occurrence` 0 returns the anchor itself; `getIntervalsElapsed` counts these same boundaries, so
 * the two are always consistent for a given DayInterval.
 */
export function nthDayIntervalMillis(anchorMillis: number, interval: DayInterval, occurrence: number): number {
  const [count, unit] = interval;
  const totalUnits = count * occurrence;
  if (unit === 'day' || unit === 'week') {
    return anchorMillis + totalUnits * getMsPerDayIntervalUnit(unit);
  }
  const anchor = new Date(anchorMillis);
  const monthsToAdd = unit === 'year' ? totalUnits * 12 : totalUnits;
  const absoluteMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + monthsToAdd;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = absoluteMonth - targetYear * 12;
  // Day 0 of the following month is the last day of the target month, so this gives its length.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(anchor.getUTCDate(), daysInTargetMonth);
  return Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds(),
  );
}

import.meta.vitest?.test("nthDayIntervalMillis", ({ expect }) => {
  const at = (iso: string) => new Date(iso).getTime();
  const iso = (millis: number) => new Date(millis).toISOString();

  // day / week are exact multiples (no drift), and honor the count.
  const dayAnchor = at('2025-01-01T08:30:00.000Z');
  expect(iso(nthDayIntervalMillis(dayAnchor, [1, 'day'], 1))).toBe('2025-01-02T08:30:00.000Z');
  expect(iso(nthDayIntervalMillis(dayAnchor, [3, 'day'], 4))).toBe('2025-01-13T08:30:00.000Z');
  expect(iso(nthDayIntervalMillis(dayAnchor, [2, 'week'], 3))).toBe('2025-02-12T08:30:00.000Z'); // 6 weeks = 42 days after Jan 1

  // Jan 31 monthly: clamp in short months, restore to the anchor day in long ones.
  const jan31 = at('2025-01-31T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(jan31, [1, 'month'], 1))).toBe('2025-02-28T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(jan31, [1, 'month'], 2))).toBe('2025-03-31T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(jan31, [1, 'month'], 3))).toBe('2025-04-30T00:00:00.000Z');

  // Anchor-day preservation: a Feb 28 anchor stays on day 28 (never jumps to Mar 31), unlike the
  // Jan 31 anchor above which restores to Mar 31. This is the evidence we compute from the anchor.
  const feb28 = at('2025-02-28T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(feb28, [1, 'month'], 1))).toBe('2025-03-28T00:00:00.000Z');

  // Leap-year Feb: Feb 29 anchor clamps to Feb 28 in a non-leap year and restores in the next leap year.
  const feb29 = at('2024-02-29T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(feb29, [1, 'year'], 1))).toBe('2025-02-28T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(feb29, [1, 'year'], 4))).toBe('2028-02-29T00:00:00.000Z');
  // Jan 31 monthly landing in a leap February clamps to Feb 29, not Feb 28.
  const jan31Leap = at('2024-01-31T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(jan31Leap, [1, 'month'], 1))).toBe('2024-02-29T00:00:00.000Z');

  // End-of-December rollover: absolute-month math carries the year.
  const dec31 = at('2025-12-31T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(dec31, [1, 'month'], 1))).toBe('2026-01-31T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(dec31, [1, 'month'], 2))).toBe('2026-02-28T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(dec31, [1, 'month'], 3))).toBe('2026-03-31T00:00:00.000Z');
  expect(iso(nthDayIntervalMillis(dec31, [1, 'year'], 1))).toBe('2026-12-31T00:00:00.000Z');

  // Time-of-day is preserved through month clamping.
  const withTime = at('2025-01-31T13:45:59.123Z');
  expect(iso(nthDayIntervalMillis(withTime, [1, 'month'], 1))).toBe('2025-02-28T13:45:59.123Z');
});
