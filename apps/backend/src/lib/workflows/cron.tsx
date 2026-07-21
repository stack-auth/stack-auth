import { Result } from "@hexclave/shared/dist/utils/results";

// Minimal 5-field cron evaluator for workflow schedules. Written in-house on
// purpose: we need timezone-aware evaluation with catch-up semantics, no
// cron dependency exists in the backend, and the required subset (numbers,
// "*", lists, ranges, steps) is small enough that an obviously-correct
// minute-matcher beats a new dependency.
//
// Evaluation model: instead of computing "next occurrence" with explicit DST
// math (the classic source of cron bugs), we iterate UTC minute boundaries
// over the window and ask "does this instant's wall clock in the target
// timezone match the expression". Windows are normally ~1 tick long;
// catch-up after downtime is capped (see MAX_CATCHUP_WINDOW_MS) and a 92-day
// scan is ~130k cheap checks. DST notes: during spring-forward, skipped wall
// times simply never match (standard cron behavior); during fall-back,
// repeated wall times match twice — runKey-less schedule runs are
// deduplicated per nominal occurrence by the schedule cursor, so the double
// match collapses to one occurrence per scanned minute anyway.

export type CronField = {
  // Sorted, deduplicated allowed values. null = unrestricted ("*").
  values: number[] | null,
};

export type CronExpression = {
  minute: CronField,
  hour: CronField,
  dayOfMonth: CronField,
  month: CronField,
  dayOfWeek: CronField,
};

const FIELD_RANGES = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 0 and 7 both mean Sunday; normalized to 0.
  { name: "day-of-week", min: 0, max: 7 },
] as const;

function parseCronField(raw: string, fieldIndex: number): Result<CronField, string> {
  const { name, min, max } = FIELD_RANGES[fieldIndex];
  if (raw === "*") return Result.ok({ values: null });

  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const stepMatch = /^(.+?)\/([0-9]+)$/.exec(part);
    const base = stepMatch != null ? stepMatch[1] : part;
    const step = stepMatch != null ? Number(stepMatch[2]) : 1;
    if (step < 1) return Result.error(`Invalid cron ${name} field "${raw}": step must be >= 1`);

    let start: number;
    let end: number;
    if (base === "*") {
      start = min;
      end = max;
    } else {
      const rangeMatch = /^([0-9]+)(?:-([0-9]+))?$/.exec(base);
      if (rangeMatch == null) return Result.error(`Invalid cron ${name} field "${raw}" (names like JAN/MON are not supported; use numbers)`);
      // .at(2) because the second capture group is optional and TS types
      // plain indexing as always-string here.
      const rangeEnd = rangeMatch.at(2);
      start = Number(rangeMatch[1]);
      end = rangeEnd != null ? Number(rangeEnd) : start;
      if (stepMatch != null && rangeEnd == null) return Result.error(`Invalid cron ${name} field "${raw}": a step requires a range or "*"`);
    }
    if (start < min || end > max || start > end) return Result.error(`Invalid cron ${name} field "${raw}": values must be in ${min}-${max}`);
    for (let value = start; value <= end; value += step) {
      // Normalize day-of-week 7 (Sunday) to 0.
      values.add(fieldIndex === 4 && value === 7 ? 0 : value);
    }
  }
  return Result.ok({ values: [...values].sort((a, b) => a - b) });
}

export function parseCronExpression(cron: string): Result<CronExpression, string> {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return Result.error(`Cron expressions must have exactly 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`);
  }
  const parsed: CronField[] = [];
  for (let i = 0; i < 5; i++) {
    const result = parseCronField(fields[i], i);
    if (result.status === "error") return Result.error(result.error);
    parsed.push(result.data);
  }
  return Result.ok({
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
  });
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch (e) {
    if (e instanceof RangeError) return false;
    throw e;
  }
}

const WEEKDAY_TO_NUMBER = new Map([["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6]]);

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function getFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (formatter == null) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      minute: "numeric",
      hour: "numeric",
      hourCycle: "h23",
      day: "numeric",
      month: "numeric",
      weekday: "short",
    });
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.values === null || field.values.includes(value);
}

export function cronMatchesAt(expression: CronExpression, instant: Date, timezone: string): boolean {
  const parts = getFormatter(timezone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const minute = Number(get("minute"));
  const hour = Number(get("hour"));
  const dayOfMonth = Number(get("day"));
  const month = Number(get("month"));
  const weekdayName = get("weekday");
  const dayOfWeek = WEEKDAY_TO_NUMBER.get(weekdayName ?? "");
  if (dayOfWeek === undefined || !Number.isFinite(minute) || !Number.isFinite(hour) || !Number.isFinite(dayOfMonth) || !Number.isFinite(month)) {
    throw new Error(`Failed to derive wall-clock parts for timezone ${timezone}`);
  }

  if (!fieldMatches(expression.minute, minute)) return false;
  if (!fieldMatches(expression.hour, hour)) return false;
  if (!fieldMatches(expression.month, month)) return false;

  // Vixie-cron day semantics: when BOTH day fields are restricted, the
  // entry runs when EITHER matches; otherwise both restrictions apply
  // (which is a no-op for the unrestricted one).
  const domRestricted = expression.dayOfMonth.values !== null;
  const dowRestricted = expression.dayOfWeek.values !== null;
  const domMatch = fieldMatches(expression.dayOfMonth, dayOfMonth);
  const dowMatch = fieldMatches(expression.dayOfWeek, dayOfWeek);
  if (domRestricted && dowRestricted) return domMatch || dowMatch;
  return domMatch && dowMatch;
}

const MINUTE_MS = 60_000;

/**
 * All occurrences in (fromExclusive, toInclusive], scanned at minute
 * granularity. Callers cap the window (see MAX_CATCHUP_WINDOW_MS) — this
 * function trusts its inputs.
 */
export function listCronOccurrences(expression: CronExpression, timezone: string, fromExclusive: Date, toInclusive: Date): Date[] {
  const occurrences: Date[] = [];
  let cursor = Math.floor(fromExclusive.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const endMs = toInclusive.getTime();
  while (cursor <= endMs) {
    const instant = new Date(cursor);
    if (cronMatchesAt(expression, instant, timezone)) occurrences.push(instant);
    cursor += MINUTE_MS;
  }
  return occurrences;
}

/**
 * Catch-up horizon: schedule occurrences are delayed, never skipped — but a
 * schedule that was down for months should not replay an unbounded backlog.
 * 92 days comfortably covers any realistic platform downtime while keeping
 * the worst-case scan cheap (~130k minute checks).
 */
export const MAX_CATCHUP_WINDOW_MS = 92 * 24 * 60 * 60 * 1000;
