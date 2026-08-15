export class OtlpJsonRequestError extends Error {}

export type OtlpAttributeValue =
  | { type: "string", value: string }
  | { type: "boolean", value: boolean }
  | { type: "int", value: string }
  | { type: "double", value: number }
  | { type: "bytes", value: string }
  | { type: "array", value: OtlpAttributeValue[] }
  | { type: "kvlist", value: OtlpAttributes }
  // The UNSET AnyValue: OTLP JSON encodes it as an empty object, and the
  // official JS serializers emit exactly that for `null`/`undefined` values
  // inside kvlists (e.g. `href: null` in autocapture event data). Shaped with
  // `value: null` so generic consumers reading `.value` project it to JSON
  // null without a dedicated branch.
  | { type: "null", value: null };
export type OtlpAttributes = Map<string, OtlpAttributeValue>;

function isOtlpRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function otlpRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isOtlpRecord(value)) throw new OtlpJsonRequestError(`${path} must be an object`);
  return value;
}

export function otlpArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new OtlpJsonRequestError(`${path} must be an array`);
  return value;
}

export function otlpString(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string") throw new OtlpJsonRequestError(`${path} must be a string`);
  return value;
}

export function otlpUint(value: unknown, path: string, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) throw new OtlpJsonRequestError(`${path} must be a non-negative integer`);
  return parsed;
}

export function otlpUint32(value: unknown, path: string, fallback = 0): number {
  const result = otlpUint(value, path, fallback);
  if (result > 0xffff_ffff) throw new OtlpJsonRequestError(`${path} must be a uint32`);
  return result;
}

export function otlpUnixNano(value: unknown, path: string): string {
  const result = otlpString(value, path);
  if (!/^\d+$/.test(result) || BigInt(result) <= 0n || BigInt(result) > 18446744073709551615n) throw new OtlpJsonRequestError(`${path} must be a positive uint64 string`);
  return result;
}

/**
 * Like otlpUnixNano, but admits "0". Only span END times use this: 0 is the
 * open-span marker (the SDK snapshots long-lived system spans at start so
 * their descendants are not parentless until the span ends), while a zero
 * START or event time would just be a missing timestamp and stays rejected.
 */
export function otlpUnixNanoOrOpen(value: unknown, path: string): string {
  const result = otlpString(value, path);
  if (!/^\d+$/.test(result) || BigInt(result) > 18446744073709551615n) throw new OtlpJsonRequestError(`${path} must be a uint64 string`);
  return result;
}

export function otlpAnyValue(value: unknown, path: string): OtlpAttributeValue {
  const item = otlpRecord(value, path);
  const present = ["stringValue", "boolValue", "intValue", "doubleValue", "arrayValue", "kvlistValue", "bytesValue"].filter((key) => item[key] !== undefined);
  if (present.length === 0) return { type: "null", value: null };
  if (present.length !== 1) throw new OtlpJsonRequestError(`${path} must contain exactly one AnyValue field`);
  const field = present[0];
  if (field === "stringValue") return { type: "string", value: otlpString(item.stringValue, `${path}.stringValue`) };
  if (field === "boolValue") {
    if (typeof item.boolValue !== "boolean") throw new OtlpJsonRequestError(`${path}.boolValue must be a boolean`);
    return { type: "boolean", value: item.boolValue };
  }
  if (field === "intValue") {
    const normalized = typeof item.intValue === "number" && Number.isSafeInteger(item.intValue) ? String(item.intValue) : item.intValue;
    if (typeof normalized !== "string" || !/^-?\d+$/.test(normalized)) throw new OtlpJsonRequestError(`${path}.intValue must be an int64 string or safe integer`);
    const parsed = BigInt(normalized);
    if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) throw new OtlpJsonRequestError(`${path}.intValue must fit int64`);
    return { type: "int", value: normalized };
  }
  if (field === "doubleValue") {
    if (typeof item.doubleValue !== "number" || !Number.isFinite(item.doubleValue)) throw new OtlpJsonRequestError(`${path}.doubleValue must be finite`);
    return { type: "double", value: item.doubleValue };
  }
  if (field === "bytesValue") return { type: "bytes", value: otlpString(item.bytesValue, `${path}.bytesValue`) };
  if (field === "arrayValue") {
    const arrayValue = otlpRecord(item.arrayValue, `${path}.arrayValue`);
    return { type: "array", value: otlpArray(arrayValue.values ?? [], `${path}.arrayValue.values`).map((entry, index) => otlpAnyValue(entry, `${path}.arrayValue.values[${index}]`)) };
  }
  const kvlistValue = otlpRecord(item.kvlistValue, `${path}.kvlistValue`);
  return { type: "kvlist", value: otlpAttributes(kvlistValue.values ?? [], `${path}.kvlistValue.values`) };
}

export function otlpAttributes(value: unknown, path: string): OtlpAttributes {
  const result = new Map<string, OtlpAttributeValue>();
  for (const [index, rawEntry] of otlpArray(value, path).entries()) {
    const entryPath = `${path}[${index}]`;
    const entry = otlpRecord(rawEntry, entryPath);
    const key = otlpString(entry.key, `${entryPath}.key`);
    if (key.length === 0) throw new OtlpJsonRequestError(`${entryPath}.key must not be empty`);
    if (result.has(key)) throw new OtlpJsonRequestError(`${path} contains duplicate key ${JSON.stringify(key)}`);
    result.set(key, otlpAnyValue(entry.value, `${entryPath}.value`));
  }
  return result;
}
