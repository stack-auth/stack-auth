import { Attributes, AttributeValue, Span, trace } from "@opentelemetry/api";
import { getEnvVariable } from "./env";
import { HexclaveAssertionError } from "./errors";

const tracer = trace.getTracer('stack-tracer');

// Custom (user-defined) event/span type names: must not start with `$` (reserved
// for system types), start with a letter, and stay within 64 chars. Shared by
// the SDK and analytics batch route so local validation cannot drift from the
// server's batch-level rejection rules.
export const CUSTOM_TELEMETRY_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/;
export const CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES = 16_000;
export const CUSTOM_TELEMETRY_MAX_PARENT_CHAIN = 10;

// System (`$`-prefixed) EVENT types the analytics batch route accepts on the
// wire. `$page-view` is span-only in current SDKs (see CLIENT_SYSTEM_SPAN_TYPES)
// but remains accepted here so older trackers that still dual-emit a page-view
// EVENT are not 400'd. Shared so the SDK and the route can never disagree
// about which `$` names are valid — an unknown `$` type 400s the whole batch.
export const SYSTEM_EVENT_TYPES = [
  "$page-view",
  "$click",
  "$form-submit",
  "$window-resize",
  "$copy",
  "$cut",
  "$paste",
  "$context-menu",
  "$print",
  "$fullscreen-exit",
] as const;

// The two original system event types predate the per-item data size cap, so
// deployed trackers may send data the cap would reject; their data stays
// permissive on ingest. Every LATER system event type gets the same object/size
// validation as custom events — there is no deployed-tracker back-compat to
// preserve for them, and unbounded system data would be a regression.
export const PERMISSIVE_DATA_SYSTEM_EVENT_TYPES = ["$page-view", "$click"] as const;

// System (`$`-prefixed) SPAN types the browser SDK is allowed to WRITE through
// the analytics batch route (versioned upserts, same pipeline as custom spans).
// `$page-view` is the canonical page-view write path (interval + hierarchy
// parent). Metrics/dashboard SQL that need page views query spans directly —
// they are never projected into default.events. Server-derived system spans
// ($refresh-token, $session-replay, $session-replay-segment) are intentionally
// NOT here — they can never be written by a client.
export const CLIENT_SYSTEM_SPAN_TYPES = [
  "$page-view",
  "$away",
  "$offline",
] as const;

export const PAGE_VIEW_SPAN_TYPE = "$page-view";

export function withTraceSpan<P extends any[], T>(optionsOrDescription: string | { description: string, attributes?: Record<string, AttributeValue> }, fn: (...args: P) => Promise<T>): (...args: P) => Promise<T> {
  return async (...args: P) => {
    return await traceSpan(optionsOrDescription, (span) => fn(...args));
  };
}

export async function traceSpan<T>(optionsOrDescription: string | { description: string, attributes?: Record<string, AttributeValue> }, fn: (span: Span) => Promise<T>): Promise<T> {
  let options = typeof optionsOrDescription === 'string' ? { description: optionsOrDescription } : optionsOrDescription;
  return await tracer.startActiveSpan(`STACK: ${options.description}`, async (span) => {
    if (options.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) {
        span.setAttribute(key, value);
      }
    }
    try {
      return await fn(span);
    } finally {
      span.end();
    }
  });
}

export function log(message: string, attributes: Attributes) {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(message, attributes);
    // Telemetry is not initialized while seeding, so we don't want to throw an error
  } else if (getEnvVariable('STACK_SEED_MODE', 'false') !== 'true') {
    throw new HexclaveAssertionError('No active span found');
  }
}
