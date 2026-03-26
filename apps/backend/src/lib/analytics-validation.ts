/**
 * Shared validation constants and helpers for analytics events and spans.
 *
 * Custom names (event_type, span_type) must:
 *   - Not start with `$` (reserved for Stack-internal types)
 *   - Only contain letters, numbers, `.`, `_`, `:`, `-`
 */

import { AUTO_CAPTURED_ANALYTICS_EVENT_TYPES } from "@stackframe/stack-shared/dist/interface/crud/analytics";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CUSTOM_ANALYTICS_NAME_RE = /^[A-Za-z0-9._:-]+$/;

/** $-prefixed event types that browser clients may send. */
const CLIENT_ANALYTICS_EVENT_TYPE_SET = new Set<string>(AUTO_CAPTURED_ANALYTICS_EVENT_TYPES);

/** $-prefixed event types that only server/admin auth may send. */
const SERVER_ONLY_ANALYTICS_EVENT_TYPES = ["$request"] as const;

const ALL_PUBLIC_ANALYTICS_EVENT_TYPES = [...AUTO_CAPTURED_ANALYTICS_EVENT_TYPES, ...SERVER_ONLY_ANALYTICS_EVENT_TYPES];
const ALL_PUBLIC_ANALYTICS_EVENT_TYPE_SET = new Set<string>(ALL_PUBLIC_ANALYTICS_EVENT_TYPES);

export const PUBLIC_STACK_ANALYTICS_EVENT_TYPE_LIST = ALL_PUBLIC_ANALYTICS_EVENT_TYPES
  .map((eventType) => `"${eventType}"`)
  .join(", ");

/**
 * Validates a custom analytics name (event_type or span_type) that may be sent by clients.
 *
 * @param allowedSystemNames - Set of `$`-prefixed names that are allowed (e.g., auto-captured event types).
 *                              For spans, this should be empty (no public $-prefixed span types).
 */
export function isValidCustomAnalyticsName(
  name: string | undefined,
  allowedSystemNames: Set<string> = new Set(),
): boolean {
  if (typeof name !== "string" || name.length === 0) {
    return false;
  }
  if (allowedSystemNames.has(name)) {
    return true;
  }
  return !name.startsWith("$") && CUSTOM_ANALYTICS_NAME_RE.test(name);
}

/**
 * Validates event_type for client auth (browser auto-captured + custom names).
 */
export function isValidClientAnalyticsEventType(eventType: string | undefined): boolean {
  return isValidCustomAnalyticsName(eventType, CLIENT_ANALYTICS_EVENT_TYPE_SET);
}

/**
 * Validates event_type for server/admin auth (all public types + custom names).
 */
export function isValidPublicAnalyticsEventType(eventType: string | undefined): boolean {
  return isValidCustomAnalyticsName(eventType, ALL_PUBLIC_ANALYTICS_EVENT_TYPE_SET);
}

/**
 * Pre-built validator for span_type.
 * No public $-prefixed span types exist, so all $-prefixed names are rejected.
 */
export function isValidPublicAnalyticsSpanType(spanType: string | undefined): boolean {
  return isValidCustomAnalyticsName(spanType);
}

// Lone surrogates are valid in JS strings but rejected by ClickHouse's JSON parser.
// Replace them with U+FFFD before inserting.
// eslint-disable-next-line no-control-regex
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function stripLoneSurrogates(value: unknown): unknown {
  if (typeof value === "string") return value.replace(LONE_SURROGATE_RE, "\uFFFD");
  if (Array.isArray(value)) return value.map(stripLoneSurrogates);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stripLoneSurrogates(v)])
    );
  }
  return value;
}
