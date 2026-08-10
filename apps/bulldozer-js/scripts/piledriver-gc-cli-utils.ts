const ISO_8601_WITH_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parsePiledriverGcTimestamp(value: string) {
  const isEpochMillis = /^\d+$/.test(value);
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
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    if (month < 1 || month > 12) throw new Error("GC cutoff must be a valid ISO-8601 calendar timestamp");
    const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (
      day < 1
      || day > daysInMonth
      || hour > 23
      || minute > 59
      || second > 59
    ) {
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
