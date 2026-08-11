const ISO_8601_WITH_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidCalendarComponents(
  year: number,
  month: number,
  day: number | undefined,
  hour: number | undefined,
  minute: number | undefined,
  second: number | undefined,
) {
  if (month < 1 || month > 12) return false;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return (
    (day === undefined || (day >= 1 && day <= daysInMonth))
    && (hour === undefined || hour <= 23)
    && (minute === undefined || minute <= 59)
    && (second === undefined || second <= 59)
  );
}

function isAmbiguousCompactCalendarTimestamp(value: string) {
  if (!/^\d+$/.test(value) || ![4, 6, 8, 14].includes(value.length)) return false;

  const year = Number(value.slice(0, 4));
  const month = value.length >= 6 ? Number(value.slice(4, 6)) : 1;
  const day = value.length >= 8 ? Number(value.slice(6, 8)) : undefined;
  const hour = value.length === 14 ? Number(value.slice(8, 10)) : undefined;
  const minute = value.length === 14 ? Number(value.slice(10, 12)) : undefined;
  const second = value.length === 14 ? Number(value.slice(12, 14)) : undefined;
  return isValidCalendarComponents(year, month, day, hour, minute, second);
}

export function parsePiledriverGcTimestamp(value: string) {
  const isEpochMillis = /^\d+$/.test(value);
  // These basic-format date lengths are only epoch milliseconds near 1970 (or year ~2612 for 14 digits).
  if (isEpochMillis && isAmbiguousCompactCalendarTimestamp(value)) {
    throw new Error("GC cutoff is ambiguous; pass a full ISO-8601 timestamp with timezone instead of a compact calendar date");
  }
  const isoMatch = isEpochMillis ? null : ISO_8601_WITH_TIMEZONE.exec(value);
  if (!isEpochMillis && isoMatch === null) {
    throw new Error("GC cutoff must be YYYY-MM-DDTHH:mm:ss[.fraction]Z or ±HH:mm, or non-negative epoch milliseconds");
  }
  if (isoMatch !== null) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const hour = Number(isoMatch[4]);
    const minute = Number(isoMatch[5]);
    const second = Number(isoMatch[6]);
    if (!isValidCalendarComponents(year, month, day, hour, minute, second)) {
      throw new Error("GC cutoff must be a valid ISO-8601 calendar timestamp");
    }
  }
  const millis = isEpochMillis ? Number(value) : Date.parse(value);
  if (!Number.isSafeInteger(millis) || millis < 0 || Number.isNaN(new Date(millis).getTime())) {
    throw new Error("GC cutoff must be YYYY-MM-DDTHH:mm:ss[.fraction]Z or ±HH:mm, or non-negative epoch milliseconds representable by JavaScript Date");
  }
  return millis;
}

export function parsePiledriverGcMaxObjects(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("GC maxObjects must be a positive safe integer");
  return parsed;
}
