import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import {
  DELETED_COLUMN,
  EXTRACTED_AT_COLUMN,
  VERSION_COLUMN,
  mapPostgresTypeToClickhouse,
  normalizeValueForClickhouse,
} from "./clickhouse-destination";
import type { DataSourceColumn } from "./probe";

/**
 * Rows reach us two ways — as native `pg` values from a SELECT, and as text from
 * the WAL — and both have to land in the same typed ClickHouse columns. These
 * helpers are the single place that reconciles them.
 */

/** Converts a WAL text value to the JS type its destination column expects. */
export function coerceTextValue(text: string | null, postgresType: string): unknown {
  if (text === null) return null;
  const clickhouseType = mapPostgresTypeToClickhouse(postgresType);
  if (/^Int|^Float|^Decimal/.test(clickhouseType)) {
    const value = Number(text);
    // Int64 beyond 2^53 loses precision as a JS number; ClickHouse accepts the
    // decimal string for those, so keep it as text rather than round it.
    if (!Number.isSafeInteger(value) && /^Int64|^Decimal/.test(clickhouseType)) return text;
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (clickhouseType === "Bool") return text === "t" || text === "true" || text === "1";
  return text;
}

export function buildDestinationRow(options: {
  values: Record<string, unknown>,
  columns: DataSourceColumn[],
  version: bigint,
  deleted: boolean,
  extractedAt: Date,
}): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of options.columns) {
    // `undefined` means the WAL withheld an unchanged TOAST value. Writing null
    // would erase it, so those columns are simply omitted and ClickHouse's
    // default applies — the previous version of the row stays queryable.
    if (!(column.name in options.values)) continue;
    const value = options.values[column.name];
    if (value === undefined) continue;
    row[column.name] = normalizeValueForClickhouse(value);
  }
  row[EXTRACTED_AT_COLUMN] = options.extractedAt.toISOString();
  row[VERSION_COLUMN] = options.version.toString();
  row[DELETED_COLUMN] = options.deleted ? 1 : 0;
  return row;
}

/**
 * A monotonic UInt64 for ReplacingMergeTree to resolve duplicates with. Whatever
 * the mode, a later version of a row must produce a larger number than an
 * earlier one, or the wrong row wins.
 */
export function versionFromCursorValue(value: unknown): bigint {
  if (value instanceof Date) return BigInt(value.getTime()) * 1000n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new HexclaveAssertionError("Cursor value is not finite");
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return BigInt(asDate.getTime()) * 1000n;
  }
  throw new HexclaveAssertionError(`Cannot derive a sync version from cursor value ${JSON.stringify(value)}`);
}
