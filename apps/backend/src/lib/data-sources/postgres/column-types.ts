/**
 * PostgreSQL's type vocabulary, translated for the destination.
 *
 * Lives with the Postgres driver rather than with the destination writer: it
 * matches against `format_type()` output, which is a Postgres spelling nothing
 * else produces.
 */

const NUMERIC_WITH_PRECISION = /^numeric\((\d+),\s*(\d+)\)$/i;

/**
 * Postgres type -> ClickHouse type. Anything we do not recognise lands as
 * String: an unqueryable column is recoverable, a wrong one silently corrupts.
 */
export function mapPostgresTypeToClickhouse(dataType: string): string {
  const type = dataType.trim().toLowerCase();
  if (type.endsWith("[]")) return "String"; // JSON-encoded; ClickHouse arrays would need per-element mapping
  const numeric = NUMERIC_WITH_PRECISION.exec(type);
  if (numeric) {
    const precision = Number.parseInt(numeric[1], 10);
    const scale = Number.parseInt(numeric[2], 10);
    // Decimal is only safe when the source declared bounds we can honour.
    if (precision <= 76 && scale <= precision) return `Decimal(${precision}, ${scale})`;
    return "String";
  }
  if (/^character varying|^varchar|^character|^char|^text|^citext|^name$/.test(type)) return "String";
  if (/^smallint$|^int2$/.test(type)) return "Int16";
  if (/^integer$|^int4$|^serial$/.test(type)) return "Int32";
  if (/^bigint$|^int8$|^bigserial$/.test(type)) return "Int64";
  if (/^real$|^float4$/.test(type)) return "Float32";
  if (/^double precision$|^float8$/.test(type)) return "Float64";
  if (/^boolean$|^bool$/.test(type)) return "Bool";
  if (/^uuid$/.test(type)) return "UUID";
  if (/^date$/.test(type)) return "Date32";
  if (/^timestamp/.test(type)) return "DateTime64(6)";
  // Bare `numeric`, json, jsonb, bytea, time, interval, enums, geometry, ...
  return "String";
}

/**
 * Converts a WAL text value to the JS type its destination column expects.
 *
 * Rows reach the Postgres driver two ways — as native `pg` values from a SELECT,
 * and as text from the WAL — and both have to land in the same typed columns.
 */
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
