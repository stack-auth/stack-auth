import { runWithSpanFrame } from "./span-context";
import { generateW3cSpanId } from "@hexclave/shared/dist/utils/analytics-wire";
import { assertValidSpanStartInput, getCustomTelemetryDataError, rejectedPreCaught, resolveEndedAtMs, resolveSpanParent, withSpanImpl, type Span, type SpanContext, type SpanUpdateRow, type StartSpanOptions, type TrackOptions } from "./telemetry-core";

/**
 * The shared span lifecycle state machine. Every span handle in the SDK —
 * client custom spans, client-minted system spans ($page-view, $away, …),
 * server-key spans, and the pre-load/inert handles — is one of these under the
 * hood: a monotonic per-span version counter, started/ended timestamps,
 * accumulated data with a validation hook, versioned-upsert row emission, and
 * an inert switch (sign-out privacy: a span started under user A must never be
 * re-written under user B).
 *
 * What deliberately does NOT live here: the capabilities that differ per
 * environment (how an event is tracked, how child spans are started, how
 * propagation headers are built, how span.fetch attaches them). Those are
 * injected by the caller — see createSpanHandle — because unifying them would
 * couple this module to every environment's buffering and policy details.
 */
export type SpanCoreOptions = {
  traceId: string,
  spanId: string,
  spanType: string,
  startedAtMs: number,
  /** null = this span IS the trace root (frozen at creation, like the trace id). */
  parentSpanId: string | null,
  /** Non-hierarchical references, frozen at creation. */
  links?: readonly SpanContext[],
  /** null = the row carries no page correlation (frozen at creation). */
  pageViewSpanId: string | null,
  initialData: Record<string, unknown>,
  /**
   * Validates the MERGED data on every setData; a non-null return rejects the
   * update. null skips validation entirely — system spans trust their internal
   * callers, and validating them could silently drop e.g. a large web-vitals
   * merge that the wire format actually accepts.
   */
  validateData: ((merged: Record<string, unknown>) => string | null) | null,
  /**
   * Delivers one versioned row; the returned promise settles with the batch
   * ack. Must be pre-caught by the sink (all sinks in this SDK are) — the core
   * only `.catch(() => {})`es the initial open-interval write.
   */
  enqueueRow: (row: SpanUpdateRow) => Promise<void>,
  /**
   * Extra suppression predicate beyond the inert switch (e.g. the tracker's
   * disabled flag). Suppressed updates still mutate local state and resolve —
   * exactly like inert ones.
   */
  isSuppressed?: () => boolean,
  /** Registry cleanup when the span ends (global-span / live-control removal). */
  onEnded?: () => void,
};

export type SpanCore = {
  readonly traceId: string,
  readonly spanId: string,
  readonly spanType: string,
  isEnded: () => boolean,
  /** Flips the inert switch: local state keeps mutating, rows stop being emitted. */
  markInert: () => void,
  setData: (data: Record<string, unknown>) => Promise<void>,
  end: (endedAtMs: number | undefined) => Promise<void>,
  spanContext: () => SpanContext,
};

export function createSpanCore(opts: SpanCoreOptions): SpanCore {
  let accumulatedData: Record<string, unknown> = { ...opts.initialData };
  let lastVersion = 0;
  let ended = false;
  let inert = false;
  let endPromise: Promise<void> | null = null;

  // Per-span monotonic version: the row carrying the latest update always wins
  // in the ReplacingMergeTree, even when batches arrive out of order (keepalive
  // sends are single-attempt and can race a normal flush).
  const nextVersion = () => (lastVersion = Math.max(Date.now(), lastVersion + 1));
  const enqueue = (endedAtMs: number | null): Promise<void> => {
    if (inert || opts.isSuppressed?.() === true) return Promise.resolve();
    return opts.enqueueRow({
      trace_id: opts.traceId,
      span_id: opts.spanId,
      parent_span_id: opts.parentSpanId,
      span_type: opts.spanType,
      started_at_ms: opts.startedAtMs,
      ended_at_ms: endedAtMs,
      data: { ...accumulatedData },
      updated_at_ms: nextVersion(),
      ...opts.pageViewSpanId !== null ? { page_view_span_id: opts.pageViewSpanId } : {},
      ...opts.links !== undefined && opts.links.length > 0 ? { links: opts.links.map((link) => ({ trace_id: link.traceId, span_id: link.spanId })) } : {},
    });
  };

  // Write the open interval right away: a span the user never ends (e.g. the
  // tab closes) still shows up, as an open interval, from its first flush on.
  enqueue(null).catch(() => {});

  return {
    traceId: opts.traceId,
    spanId: opts.spanId,
    spanType: opts.spanType,
    isEnded: () => ended,
    markInert: () => {
      inert = true;
    },
    setData: (data: Record<string, unknown>) => {
      if (ended) return rejectedPreCaught(`setData() called on already-ended span "${opts.spanType}"`);
      const merged = { ...accumulatedData, ...data };
      const mergedError = opts.validateData?.(merged) ?? null;
      if (mergedError) return rejectedPreCaught(mergedError);
      accumulatedData = merged;
      return enqueue(null);
    },
    end: (endedAtMs: number | undefined) => {
      if (endPromise) return endPromise;
      // Resolve (and possibly throw on invalid input) BEFORE flipping `ended`,
      // so a rejected end leaves the span usable.
      const resolvedEndedAtMs = resolveEndedAtMs(opts.startedAtMs, endedAtMs);
      ended = true;
      opts.onEnded?.();
      endPromise = enqueue(resolvedEndedAtMs);
      return endPromise;
    },
    spanContext: () => ({ traceId: opts.traceId, spanId: opts.spanId }),
  };
}

/**
 * The environment-specific capabilities of a public Span handle. Everything
 * else about the handle (versioning, data accumulation, ended semantics,
 * withSpan/run/spanContext) is identical across environments and owned by
 * createSpanHandle; these four differ per site:
 *
 * - `trackEvent` / `startChildSpan` receive options whose `parent` is ALREADY
 *   pinned to this span; they only need to route to the environment's tracker
 *   (browser buffer, server-key buffer, pre-load queue).
 * - `getSpanPropagationHeaders` / `fetch` build the cross-tier header from
 *   environment state (segment identity, origin policy).
 */
export type SpanHandleCapabilities = {
  trackEvent: (eventType: string, data: Record<string, unknown> | undefined, options: TrackOptions) => Promise<void>,
  startChildSpan: (spanType: string, options: StartSpanOptions) => Span,
  getSpanPropagationHeaders: (span: Span) => Record<string, string>,
  fetch: (span: Span, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
};

export type SpanHandleOptions = SpanCoreOptions & {
  capabilities: SpanHandleCapabilities,
};

export type SpanHandle = {
  span: Span,
  /** See SpanCore.markInert — exposed for live-span registries. */
  markInert: () => void,
};

/**
 * Builds a public Span handle on top of the shared state machine. The handle
 * pins ITSELF as the parent for trackEvent/startSpan/withSpan — handle-based
 * nesting is exact in every environment and under any concurrency, unlike
 * ambient context — and implements run() via the ambient span-frame primitive.
 *
 * Pinning OVERRIDES a caller-supplied `parent`: `span.startSpan(...)` means "a
 * child of THIS span" by construction, so honouring a different parent would
 * make the method name lie. Callers who want another parent use the app-level
 * `startSpan({ parent })` instead.
 */
export function createSpanHandle(opts: SpanHandleOptions): SpanHandle {
  const { capabilities, ...coreOptions } = opts;
  const core = createSpanCore(coreOptions);

  const span: Span = {
    traceId: core.traceId,
    spanId: core.spanId,
    spanType: core.spanType,
    get isEnded() {
      return core.isEnded();
    },
    setData: (data: Record<string, unknown>) => core.setData(data),
    end: (endOptions?: { endedAtMs?: number }) => core.end(endOptions?.endedAtMs),
    trackEvent: (eventType: string, data?: Record<string, unknown>, trackOptions?: TrackOptions) =>
      capabilities.trackEvent(eventType, data, { ...trackOptions, parent: span }),
    startSpan: (childType: string, childOptions?: StartSpanOptions) =>
      capabilities.startChildSpan(childType, { ...childOptions, parent: span }),
    withSpan: <T,>(childType: string, optionsOrFn: StartSpanOptions | ((child: Span) => Promise<T> | T), maybeFn?: (child: Span) => Promise<T> | T) =>
      withSpanImpl((type, options) => span.startSpan(type, options), childType, optionsOrFn, maybeFn),
    run: <T,>(fn: () => T) => runWithSpanFrame(span.spanContext(), fn),
    getSpanPropagationHeaders: () => capabilities.getSpanPropagationHeaders(span),
    fetch: (input: RequestInfo | URL, init?: RequestInit) => capabilities.fetch(span, input, init),
    spanContext: () => core.spanContext(),
  };

  return { span, markInert: core.markInert };
}

/**
 * An inert Span for environments where telemetry cannot exist at all (client
 * startSpan outside the browser). Isomorphic code — a hook or utility that
 * runs on both server render and hydration — should not have to branch on the
 * environment around every span call, so instead of throwing we hand back a
 * handle with the full state machine (invalid USAGE still fails loudly:
 * malformed data, endedAtMs before start, setData after end) whose lifecycle
 * operations resolve immediately and never emit a row. spanContext() returns the
 * identity the span would have had, so serialized contexts stay structurally
 * valid (and a real span in a later environment can still link to them).
 */
export function createInertSpanHandle(opts: {
  traceId: string,
  spanId: string,
  spanType: string,
  startedAtMs: number,
  parentSpanId: string | null,
  initialData: Record<string, unknown>,
}): Span {
  const { span } = createSpanHandle({
    ...opts,
    pageViewSpanId: null,
    validateData: getCustomTelemetryDataError,
    isSuppressed: () => true,
    enqueueRow: () => Promise.resolve(),
    capabilities: {
      // Resolving (instead of rejecting like app.trackEvent does outside the
      // browser) keeps `await span.trackEvent(...)` safe in isomorphic code —
      // the whole point of the inert handle. The event is knowingly dropped;
      // there is no tracker it could ever reach.
      trackEvent: () => Promise.resolve(),
      startChildSpan: (childType, childOptions) => {
        // Children still validate like real spans — inertness covers only
        // environment unavailability, never invalid input.
        assertValidSpanStartInput(childType, childOptions);
        const resolved = resolveSpanParent({ explicit: childOptions.parent, ambient: [], links: childOptions.links, root: childOptions.root });
        if ("error" in resolved) {
          throw new Error(`Hexclave analytics: ${resolved.error}`);
        }
        return createInertSpanHandle({
          traceId: resolved.traceId,
          spanId: generateW3cSpanId(),
          spanType: childType,
          startedAtMs: childOptions.startedAtMs ?? Date.now(),
          parentSpanId: resolved.parentSpanId,
          initialData: { ...childOptions.data ?? {} },
        });
      },
      getSpanPropagationHeaders: () => ({}),
      fetch: (_span, input, init) => globalThis.fetch(input, init),
    },
  });
  return span;
}
