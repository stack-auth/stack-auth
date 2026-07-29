import { runWithSpanFrame } from "./span-context";
import { assertValidSpanStartInput, getCustomTelemetryDataError, rejectedPreCaught, resolveEndedAtMs, resolveParentIds, withSpanImpl, type Span, type SpanRef, type SpanUpdateRow, type StartSpanOptions, type TrackOptions } from "./telemetry-core";
import { generateUuid } from "./telemetry-transport";

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
  spanId: string,
  spanType: string,
  startedAtMs: number,
  parentSpanIds: readonly string[],
  /** null = the row carries no page ancestry (frozen at creation, like the chain). */
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
  readonly spanId: string,
  readonly spanType: string,
  isEnded: () => boolean,
  /** Flips the inert switch: local state keeps mutating, rows stop being emitted. */
  markInert: () => void,
  setData: (data: Record<string, unknown>) => Promise<void>,
  end: (endedAtMs: number | undefined) => Promise<void>,
  ref: () => SpanRef,
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
      span_id: opts.spanId,
      span_type: opts.spanType,
      started_at_ms: opts.startedAtMs,
      ended_at_ms: endedAtMs,
      parent_span_ids: [...opts.parentSpanIds],
      data: { ...accumulatedData },
      updated_at_ms: nextVersion(),
      ...opts.pageViewSpanId !== null ? { page_view_span_id: opts.pageViewSpanId } : {},
    });
  };

  // Write the open interval right away: a span the user never ends (e.g. the
  // tab closes) still shows up, as an open interval, from its first flush on.
  enqueue(null).catch(() => {});

  return {
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
    ref: () => ({ spanId: opts.spanId, parentSpanIds: [...opts.parentSpanIds] }),
  };
}

/**
 * The environment-specific capabilities of a public Span handle. Everything
 * else about the handle (versioning, data accumulation, ended semantics,
 * withSpan/run/ref) is identical across environments and owned by
 * createSpanHandle; these four differ per site:
 *
 * - `trackEvent` / `startChildSpan` receive options that ALREADY carry this
 *   span appended to parentIds; they only need to route to the environment's
 *   tracker (browser buffer, server-key buffer, pre-load queue).
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
 * appends itself to parentIds for trackEvent/startSpan/withSpan (the frozen
 * chain is identity, not state — see the startSpan call sites), and implements
 * run() via the ambient span-frame primitive.
 */
export function createSpanHandle(opts: SpanHandleOptions): SpanHandle {
  const { capabilities, ...coreOptions } = opts;
  const core = createSpanCore(coreOptions);

  const span: Span = {
    spanId: core.spanId,
    spanType: core.spanType,
    get isEnded() {
      return core.isEnded();
    },
    setData: (data: Record<string, unknown>) => core.setData(data),
    end: (endOptions?: { endedAtMs?: number }) => core.end(endOptions?.endedAtMs),
    trackEvent: (eventType: string, data?: Record<string, unknown>, trackOptions?: TrackOptions) =>
      capabilities.trackEvent(eventType, data, { ...trackOptions, parentIds: [...trackOptions?.parentIds ?? [], span] }),
    startSpan: (childType: string, childOptions?: StartSpanOptions) =>
      capabilities.startChildSpan(childType, { ...childOptions, parentIds: [...childOptions?.parentIds ?? [], span] }),
    withSpan: <T,>(childType: string, optionsOrFn: StartSpanOptions | ((child: Span) => Promise<T> | T), maybeFn?: (child: Span) => Promise<T> | T) =>
      withSpanImpl((type, options) => span.startSpan(type, options), childType, optionsOrFn, maybeFn),
    run: <T,>(fn: () => T) => runWithSpanFrame(span.ref(), fn),
    getSpanPropagationHeaders: () => capabilities.getSpanPropagationHeaders(span),
    fetch: (input: RequestInfo | URL, init?: RequestInit) => capabilities.fetch(span, input, init),
    ref: () => core.ref(),
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
 * operations resolve immediately and never emit a row. ref() returns the id
 * the span would have had, so serialized refs stay structurally valid.
 */
export function createInertSpanHandle(opts: {
  spanId: string,
  spanType: string,
  startedAtMs: number,
  parentSpanIds: readonly string[],
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
        const resolved = resolveParentIds({ explicit: childOptions.parentIds, ambient: [], root: childOptions.root, exclude: childOptions.excludeParentIds });
        if ("error" in resolved) {
          throw new Error(`Hexclave analytics: ${resolved.error}`);
        }
        return createInertSpanHandle({
          spanId: generateUuid(),
          spanType: childType,
          startedAtMs: childOptions.startedAtMs ?? Date.now(),
          parentSpanIds: resolved.ids,
          initialData: { ...childOptions.data ?? {} },
        });
      },
      getSpanPropagationHeaders: () => ({}),
      fetch: (_span, input, init) => globalThis.fetch(input, init),
    },
  });
  return span;
}
