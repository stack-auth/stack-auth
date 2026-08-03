/**
 * Strip credentials/secrets from Brain payloads. Keep analytically useful
 * structure; drop obvious secret-shaped keys and truncate huge strings.
 */
const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|api[_-]?key|private[_-]?key|cookie|credential|refresh[_-]?token|access[_-]?token|client[_-]?secret)/i;
const MAX_STRING_CHARS = 4_000;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;

export function sanitizeBrainPayload(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return "[truncated]";
  }
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_CHARS
      ? `${value.slice(0, MAX_STRING_CHARS)}…[truncated ${value.length - MAX_STRING_CHARS} chars]`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeBrainPayload(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = sanitizeBrainPayload(child, depth + 1);
    }
    return out;
  }
  return String(value);
}
