import { Attributes, AttributeValue, Span, trace } from "@opentelemetry/api";
import { getEnvVariable } from "./env";
import { HexclaveAssertionError } from "./errors";

const tracer = trace.getTracer('stack-tracer');

// Custom (user-defined) event/span type names: must not start with `$` (reserved
// for system types), start with a letter, and stay within 64 chars. Shared by
// the SDK and analytics batch route so local validation cannot drift from the
// server's batch-level rejection rules.
export const CUSTOM_TELEMETRY_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/;
// The released browser tracker flushes at roughly 64 KB per batch. Using that
// same ceiling for every event/span preserves its generated payloads while
// giving current custom telemetry one bounded validation contract.
export const CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES = 64_000;
export const CUSTOM_TELEMETRY_MAX_PARENT_CHAIN = 10;

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
