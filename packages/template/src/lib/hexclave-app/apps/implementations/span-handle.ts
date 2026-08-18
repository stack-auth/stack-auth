import { generateOtelSpanId } from "./otel-context";
import { assertValidSpanStartInput, getCustomTelemetryDataError, rejectedPreCaught, resolveEndedAtMs, withSpanImpl, type Span, type SpanContext, type StartSpanOptions } from "./telemetry-core";

/**
 * Creates the isomorphic no-op span used when a client app executes outside a
 * browser. It preserves validation and handle composition without implementing
 * a second tracing runtime or fabricating export acknowledgements.
 */
export function createInertSpanHandle(options: {
  traceId: string,
  spanId: string,
  spanType: string,
  startedAtMs: number,
  parentSpanId: string | null,
  initialData: Record<string, unknown>,
  /** The resolved parent's flags/state, when known. See SpanContext for the omitted-flags contract. */
  traceFlags?: number,
  traceState?: string,
}): Span {
  let accumulatedData = { ...options.initialData };
  let ended = false;
  // The inert handle must not DOWNGRADE the trace decision it inherited: a
  // hardcoded TraceFlags.NONE here would make every later real span that uses
  // spanContext() as its parent unsampled (parent-based samplers drop it) even
  // when the upstream context was sampled. Pass the resolved flags through
  // when known, and otherwise omit them — omitted flags mean "sampled" per the
  // SpanContext contract.
  const context: SpanContext = {
    traceId: options.traceId,
    spanId: options.spanId,
    ...options.traceFlags === undefined ? {} : { traceFlags: options.traceFlags },
    ...options.traceState === undefined ? {} : { traceState: options.traceState },
  };

  let span!: Span;
  span = {
    traceId: options.traceId,
    spanId: options.spanId,
    spanType: options.spanType,
    get isEnded() {
      return ended;
    },
    setData: async (data) => {
      if (ended) return await rejectedPreCaught(`setData() called on already-ended span "${options.spanType}"`);
      const merged = { ...accumulatedData, ...data };
      const error = getCustomTelemetryDataError(merged);
      if (error !== null) return await rejectedPreCaught(error);
      accumulatedData = merged;
    },
    end: async (endOptions) => {
      if (ended) return;
      resolveEndedAtMs(options.startedAtMs, endOptions?.endedAtMs);
      ended = true;
    },
    trackEvent: async () => {},
    startSpan: (spanType, startOptions) => {
      assertValidSpanStartInput(spanType, startOptions);
      return createInertSpanHandle({
        traceId: options.traceId,
        spanId: generateOtelSpanId(),
        spanType,
        startedAtMs: startOptions?.startedAtMs ?? Date.now(),
        parentSpanId: options.spanId,
        initialData: { ...startOptions?.data ?? {} },
        // Children stay in the same trace, so they inherit its sampling state.
        ...options.traceFlags === undefined ? {} : { traceFlags: options.traceFlags },
        ...options.traceState === undefined ? {} : { traceState: options.traceState },
      });
    },
    withSpan: <T,>(spanType: string, optionsOrFn: StartSpanOptions | ((child: Span) => Promise<T> | T), maybeFn?: (child: Span) => Promise<T> | T) =>
      withSpanImpl((childType, childOptions) => span.startSpan(childType, childOptions), spanType, optionsOrFn, maybeFn),
    // This handle is inert because no OTel provider exists in this runtime, so
    // it must not invent an ambient context that real instrumentations cannot see.
    run: async <T,>(fn: () => T): Promise<Awaited<T>> => await fn(),
    getSpanPropagationHeaders: () => ({}),
    fetch: async (input, init) => await fetch(input, init),
    spanContext: () => context,
  };
  return span;
}
