import { Attributes, AttributeValue, Span, trace } from "@opentelemetry/api";
import { getEnvVariable } from "./env";
import { HexclaveAssertionError } from "./errors";

const tracer = trace.getTracer('stack-tracer');

// The analytics wire-contract constants used to live here, but this module
// eagerly initializes @opentelemetry/api (the tracer above), and the client
// SDK's event tracker imports the constants — which dragged OTel into every
// customer's browser bundle. They now live in the dependency-free
// ./analytics-wire module; re-exported here so backend imports keep working.
export {
  CLIENT_SYSTEM_SPAN_TYPES,
  CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES,
  CUSTOM_TELEMETRY_MAX_PARENT_CHAIN,
  CUSTOM_TELEMETRY_NAME_RE,
  HTTP_CLIENT_SPAN_TYPE,
  PAGE_VIEW_SPAN_TYPE,
  SYSTEM_EVENT_TYPES,
  TELEMETRY_UUID_RE,
  buildTraceparent,
  uuidToW3cSpanId,
  uuidToW3cTraceId,
  type ClientSystemSpanType,
  type SystemEventType,
} from "./analytics-wire";

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
