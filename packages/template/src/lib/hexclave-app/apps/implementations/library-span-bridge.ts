import { CUSTOM_TELEMETRY_NAME_RE, formatTraceparent, generateW3cSpanId, generateW3cTraceId, isW3cSpanId, isW3cTraceId, parseTraceparent, truncateUtf8Bytes } from "@hexclave/shared/dist/utils/analytics-wire";
import { loadAsyncLocalStorage, type AsyncLocalStorageLike } from "@hexclave/shared/dist/utils/async-local-storage";
import { context as contextApi, createContextKey, propagation as propagationApi, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace as traceApi, type Context, type ContextManager, type Exception, type Span as OtelSpan, type SpanAttributes, type SpanAttributeValue, type SpanContext, type SpanOptions, type SpanStatus, type TextMapGetter, type TextMapPropagator, type TextMapSetter, type TimeInput, type Tracer, type TracerOptions, type TracerProvider } from "@hexclave/shared/dist/utils/otel-api";

/**
 * The hidden OpenTelemetry bridge: a minimal, hand-rolled implementation of
 * the `@opentelemetry/api` interfaces (TracerProvider/Tracer/Span + an
 * AsyncLocalStorage ContextManager) that turns spans any third-party library
 * emits through the OTel API GLOBAL — Prisma via `@prisma/instrumentation`,
 * Drizzle's OTel support, the Vercel AI SDK's `experimental_telemetry` — into
 * native Hexclave spans named after each library operation, with the tracer
 * recorded as its instrumentation scope and the span nested under the ambient
 * Hexclave request span. Users never configure exporters, endpoints, or
 * collectors; the SDK IS
 * the in-process OTel implementation (the same pattern Sentry v8 uses).
 *
 * Deliberately NOT built on `@opentelemetry/sdk-trace-*`: the API surface the
 * libraries above actually exercise is tiny, and the SDK packages would drag
 * in processors/exporters/resources we would immediately have to neutralize.
 *
 * Parenting contract (see also the seam in server-app-impl._beginLibrarySpan):
 *  (a) the explicit/active OTel context carries a span we REGISTERED, or a
 *      remote W3C parent extracted from `traceparent` → we join that entry's
 *      trace and parent under its `recordedSpanId` (arbitrary OTel nesting depth,
 *      e.g. browser fetch → Next.js → route → Prisma → PostgreSQL);
 *  (b) no registered OTel parent → the ambient Hexclave contexts AT CALL TIME
 *      (enclosing withSpan frames + the request's incoming traceparent);
 *  (c) neither → a new trace rooted at this span, still recorded.
 * Both lookups are AsyncLocalStorage-scoped, so this is concurrency-safe.
 *
 * NON-RECORDING SPANS AND THE ORPHAN TRAP. Spans rejected by the capture policy, and
 * every span minted while the seam returns null, are API-complete but write NO
 * row — while their children happily do. A child must therefore never name such a
 * span as its parent, or it would reference a row that does not exist (which under
 * a scalar `parent_span_id` silently detaches the whole subtree, and hides it from
 * the trace inbox too, since an orphan's parent is non-null). The registry
 * therefore stores the nearest RECORDED ancestor rather than the immediate one: a
 * non-recording span with a registered parent re-registers that parent's
 * `recordedSpanId` under its own span id, so lookups transparently skip the
 * phantom. A non-recording span with NO registered parent is deliberately left
 * OUT of the registry entirely, so its children fall through to ambient
 * resolution (case (b)) — that is what keeps a Prisma span under a Next.js render
 * span attached to the Hexclave request context.
 *
 * Known limits (accepted for v1):
 * - A second bundled copy of `@opentelemetry/api` with an incompatible
 *   global-registration version cannot reach this provider; such libraries
 *   degrade to the fetch-level `$http-client` spans.
 * - Spans created before registration runs are lost — mitigated by claiming
 *   the global from `instrumentation.ts` (Next runs it before app code).
 * - OTel span events and links are dropped (events are counted).
 */

// ---------------------------------------------------------------------------
// Seam types (implemented by server-app-impl, injected at registration)
// ---------------------------------------------------------------------------

/**
 * A registry entry for an OTel span this bridge minted: which trace it belongs to,
 * and the nearest ancestor that actually WROTE A ROW (null when no ancestor in
 * this trace was recorded, i.e. a child should become a root of the trace).
 */
export type LibrarySpanOtelParent = {
  traceId: string,
  recordedSpanId: string | null,
  /** The shared trace-level sampling decision inherited by OTel children. */
  sampled: boolean,
  /** The innermost SDK withSpan frame this OTel lineage already entered. */
  ambientSpanId: string | null,
};

export type BeginLibrarySpanInfo = {
  name: string,
  tracerName: string,
  startedAtMs: number,
  /** Non-null when case (a) of the parenting contract applies; null defers to ambient resolution inside the seam. */
  otelParent: LibrarySpanOtelParent | null,
};

export type LibrarySpanHandle = {
  /** The trace the seam resolved for this span; children inherit it. */
  traceId: string,
  /** This span's own W3C span id — it WILL be written, so children may name it. */
  spanId: string,
  /** The same deterministic decision the SDK flusher applies to this trace. */
  sampled: boolean,
  /** Lets descendants detect when a newer SDK withSpan frame must win once. */
  ambientSpanId: string | null,
  end: (endedAtMs: number, data: Record<string, unknown>) => void,
};

export type LibrarySpanBridgeDeps = {
  projectId: string,
  /**
   * Called synchronously at OTel startSpan time: resolves the ambient batch
   * context + parent, mints the span's W3C identity, and returns the row
   * emitter. Returns null when server telemetry cannot record (disabled
   * project, browser-like environment) — the bridge span then becomes
   * non-recording but stays API-complete so library code never breaks.
   */
  beginLibrarySpan: (info: BeginLibrarySpanInfo) => LibrarySpanHandle | null,
};

export type LibrarySpanBridgeRegistration = {
  provider: TracerProvider,
};

// ---------------------------------------------------------------------------
// Caps and policy
// ---------------------------------------------------------------------------

const MAX_ATTRIBUTES_PER_SPAN = 64;
const MAX_ATTRIBUTE_VALUE_BYTES = 1024;
// 64 attributes × 1KB values (+ keys) would alone serialize past the shared
// 64KB row-data limit and get the whole span rejected at the buffer, so a
// running byte budget stops keeping NEW attributes well before that.
const MAX_TOTAL_ATTRIBUTE_BYTES = 32_768;
// SQL statement / query-text attributes are ALWAYS dropped, even though they
// are the most "interesting" ones: they routinely embed literal parameters
// (emails, tokens, PII) and OTel semconv explicitly warns they may be
// captured unsanitized. The query shape is recoverable from span names +
// db.operation/db.collection attributes, which we keep.
const DROPPED_ATTRIBUTE_KEY_RE = /db\.statement|db\.query\.text|sql/i;
// Bounded registry: OTel span id → nearest-recorded-ancestor mapping, FIFO-evicted.
// 2000 is far beyond any realistic set of spans whose CHILDREN are still
// being started; eviction only costs case-(a) parenting (the child falls back
// to ambient contexts), never data loss.
const SPAN_REGISTRY_CAP = 2000;
// Specific runtime-plumbing spans that must stay non-recording. Do NOT ignore
// the entire stack-tracer: it also owns the backend's request/validation/route
// spans, and dropping those flattens Prisma into a sibling of the request span.
// wait() is the exceptional feedback-loop operation: the telemetry sender's
// retry backoff uses it, so recording that timer would let each failed batch
// mint the row that fills the next batch forever.
// A child of an ignored span inherits that span's OWN nearest recorded ancestor
// when it has one, and otherwise falls through to ambient parenting (contract
// case (b)) — e.g. a Prisma span under a Next.js render span still parents under
// the Hexclave request context. Either way it never names the phantom itself.
const STACK_TRACER_IGNORED_SPAN_NAMES = new Set(["STACK: wait(...)"]);

export function shouldIgnoreLibrarySpan(tracerName: string, spanName: string): boolean {
  return tracerName === "stack-tracer" && STACK_TRACER_IGNORED_SPAN_NAMES.has(spanName.trim());
}

/**
 * Converts an arbitrary OTel operation name to the public span-type contract.
 * Most instrumentation names (including Prisma's) already pass unchanged.
 * Invalid punctuation is normalized instead of falling back to `$lib-span`,
 * while the exact original remains in data.name for diagnostics.
 */
export function librarySpanTypeFromName(name: string): string {
  if (CUSTOM_TELEMETRY_NAME_RE.test(name)) return name;
  const sanitized = name.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-");
  if (!/[a-zA-Z0-9]/.test(sanitized)) return "library.operation";
  const prefixed = /^[a-zA-Z]/.test(sanitized) ? sanitized : `library.${sanitized}`;
  const bounded = prefixed.slice(0, 64);
  return CUSTOM_TELEMETRY_NAME_RE.test(bounded) ? bounded : "library.operation";
}

// ---------------------------------------------------------------------------
// Process-global state (one bridge per process, across SDK copies)
// ---------------------------------------------------------------------------

// The OTel API global itself is process-wide (a Symbol.for slot on
// globalThis), so ALL bridge state must be too — mirroring the console
// capture in logs.ts: two bundled SDK copies with module-local state would
// disagree about who owns the global and lose the shared span registry.
type LibrarySpanBridgeGlobalState = {
  // Non-null once this process's OTel globals are ours.
  installed: { provider: HexclaveTracerProvider, contextManager: HexclaveContextManager } | null,
  // Mutable deps slot with REPLACE semantics (newest registration wins) —
  // dev-server HMR constructs a fresh app instance per module eval, and the
  // provider must forward to the live one, same rationale as the console
  // capture's sink swap.
  deps: LibrarySpanBridgeDeps | null,
  // w3c span id (16-hex) → nearest-recorded-ancestor mapping; see SPAN_REGISTRY_CAP.
  registry: Map<string, LibrarySpanOtelParent>,
  // The collector-recursion marker must live on the bridge's OWN context
  // manager. A Next.js server can evaluate @opentelemetry/api in multiple
  // chunks; setting suppression through another copy can otherwise reach a
  // different API delegate even though Prisma is wired to this provider.
  telemetrySuppressionKey: ReturnType<typeof createContextKey>,
  // Sticky back-off so a foreign OTel setup produces exactly one debug note
  // per process, not one per register() call.
  backedOff: boolean,
};

const BRIDGE_STATE_KEY = Symbol.for("hexclave.analytics.library-span-bridge.v3");

function getBridgeState(): LibrarySpanBridgeGlobalState {
  const holder = globalThis as { [BRIDGE_STATE_KEY]?: LibrarySpanBridgeGlobalState };
  holder[BRIDGE_STATE_KEY] ??= {
    installed: null,
    deps: null,
    registry: new Map(),
    telemetrySuppressionKey: createContextKey("hexclave.analytics.telemetry-suppression"),
    backedOff: false,
  };
  return holder[BRIDGE_STATE_KEY];
}

export function isLibrarySpanBridgeTelemetrySuppressed(): boolean {
  const state = getBridgeState();
  const manager = state.installed?.contextManager;
  return manager?.active().getValue(state.telemetrySuppressionKey) === true;
}

/** The nearest OTel/library row active in this async flow, for SDK span nesting. */
export function getActiveLibrarySpanContext(): { traceId: string, spanId: string } | null {
  const state = getBridgeState();
  const activeSpan = traceApi.getSpan(state.installed?.contextManager.active() ?? ROOT_CONTEXT);
  if (activeSpan === undefined) return null;
  const mapped = state.registry.get(activeSpan.spanContext().spanId);
  if (mapped?.recordedSpanId == null) return null;
  return { traceId: mapped.traceId, spanId: mapped.recordedSpanId };
}

/**
 * Runs collector work inside the exact context manager owned by the hidden
 * OTel bridge. This is intentionally exposed only through framework
 * instrumentation glue: ordinary SDK consumers should never suppress their
 * own telemetry.
 */
export async function runWithLibrarySpanBridgeTelemetrySuppressed<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const state = getBridgeState();
  const manager = state.installed?.contextManager;
  if (manager === undefined) {
    throw new Error("Hexclave analytics: telemetry suppression requires the library-span bridge to be registered first");
  }
  return await manager.with(
    manager.active().setValue(state.telemetrySuppressionKey, true),
    fn,
  );
}

/**
 * Internal delivery variant: telemetry still works when a runtime's existing
 * OTel setup made the hidden bridge back off. When the bridge is installed,
 * the delivery runs inside its exact context manager so Next/undici spans from
 * the collector POST cannot inherit and inflate the request being exported.
 */
export async function runWithLibrarySpanBridgeTelemetrySuppressedIfRegistered<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const state = getBridgeState();
  const manager = state.installed?.contextManager;
  if (manager === undefined) return await fn();
  // Delivery is not a child operation of the request whose telemetry it is
  // exporting. Keeping that span active lets framework fetch instrumentation
  // propagate sampled=1 to /analytics/events/batch; the receiver then honors
  // the upstream decision, traces its own collector work, and sends another
  // batch indefinitely. Preserve the rest of the ambient context while
  // explicitly detaching its span, then mark the whole delivery suppressed.
  const detachedContext = traceApi.deleteSpan(manager.active());
  return await manager.with(
    detachedContext.setValue(state.telemetrySuppressionKey, true),
    fn,
  );
}

function registerSpanMapping(registry: Map<string, LibrarySpanOtelParent>, w3cSpanId: string, entry: LibrarySpanOtelParent): void {
  if (registry.size >= SPAN_REGISTRY_CAP) {
    // FIFO eviction: Maps iterate in insertion order, so the first key is the
    // oldest mapping.
    const oldest = registry.keys().next();
    if (!oldest.done) registry.delete(oldest.value);
  }
  registry.set(w3cSpanId, entry);
}

/**
 * Makes an SDK-native span the active parent seen by the process-global OTel
 * bridge for exactly `fn`'s async extent. This is separate from the SDK's own
 * withSpan ALS on purpose: Next.js can evaluate route code and
 * instrumentation.ts from different server chunks, while the OTel provider
 * and this Symbol.for-backed registry are process-global. Without this carrier,
 * a library span opened inside an SDK withSpan can see the surrounding Next.js
 * span but miss the SDK boundary and become its sibling.
 *
 * If the bridge backed off because the host owns OTel, leave the host context
 * untouched. The SDK span still works; only the hidden bridge integration is
 * unavailable in that configuration.
 */
export async function runWithLibrarySpanBridgeParentIfRegistered<T>(
  parent: { traceId: string, spanId: string },
  sampled: boolean,
  fn: () => T,
): Promise<Awaited<T>> {
  if (!isW3cTraceId(parent.traceId) || !isW3cSpanId(parent.spanId)) {
    throw new Error("Hexclave analytics: library-span bridge parent must be a valid W3C span context");
  }
  const state = getBridgeState();
  const manager = state.installed?.contextManager;
  if (manager === undefined) return await fn();

  const previous = state.registry.get(parent.spanId);
  const mapping: LibrarySpanOtelParent = {
    traceId: parent.traceId,
    recordedSpanId: parent.spanId,
    sampled,
    // Descendants have already entered this SDK frame. The seam uses this to
    // avoid re-inserting the same frame ahead of every nested OTel child.
    ambientSpanId: parent.spanId,
  };
  registerSpanMapping(state.registry, parent.spanId, mapping);
  const carrier = traceApi.wrapSpanContext({
    traceId: parent.traceId,
    spanId: parent.spanId,
    traceFlags: sampled ? 1 : 0,
  });
  try {
    return await manager.with(traceApi.setSpan(manager.active(), carrier), fn);
  } finally {
    // Preserve an older mapping in the astronomically unlikely event that a
    // caller deliberately re-enters the same span id; otherwise release the
    // temporary SDK carrier immediately instead of consuming registry capacity.
    if (state.registry.get(parent.spanId) === mapping) {
      if (previous === undefined) state.registry.delete(parent.spanId);
      else state.registry.set(parent.spanId, previous);
    }
  }
}

// ---------------------------------------------------------------------------
// Time conversion
// ---------------------------------------------------------------------------

// Below this, a numeric TimeInput cannot be an epoch-milliseconds value from
// any plausible clock (1e12 ms ≈ Sep 2001) and is treated as a
// performance.now()-style offset relative to timeOrigin — the same heuristic
// OTel's sdk-trace-base applies to numeric TimeInputs.
const EPOCH_MS_THRESHOLD = 1e12;

function timeInputToMs(input: TimeInput | undefined): number | null {
  if (input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    if (input < EPOCH_MS_THRESHOLD) {
      const origin = typeof performance !== "undefined" ? performance.timeOrigin : null;
      if (origin === null) return null;
      return Math.round(origin + input);
    }
    return Math.round(input);
  }
  if (input instanceof Date) return input.getTime();
  if (Array.isArray(input)) {
    // HrTime: [seconds, nanoseconds] since epoch.
    return Math.round(input[0] * 1000 + input[1] / 1e6);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Attribute normalization + category classification
// ---------------------------------------------------------------------------

type StoredAttribute = { value: string | number | boolean, bytes: number };

/**
 * Allowlist-by-shape: primitives pass (strings byte-bounded), primitive
 * arrays are JSON-stringified and bounded, everything else is dropped —
 * library attributes are arbitrary third-party input, so only shapes that
 * serialize predictably are kept.
 */
function normalizeAttributeValue(value: SpanAttributeValue): StoredAttribute | null {
  if (typeof value === "string") {
    const bounded = truncateUtf8Bytes(value, MAX_ATTRIBUTE_VALUE_BYTES);
    return { value: bounded, bytes: bounded.length };
  }
  if (typeof value === "number") {
    // NaN/Infinity JSON-serialize to null and would corrupt the row shape.
    return Number.isFinite(value) ? { value, bytes: 8 } : null;
  }
  if (typeof value === "boolean") {
    return { value, bytes: 4 };
  }
  if (Array.isArray(value)) {
    // JSON.stringify of an array root always yields a string (primitives/null
    // per the OTel attribute type; even exotic members serialize to null).
    const bounded = truncateUtf8Bytes(JSON.stringify(value), MAX_ATTRIBUTE_VALUE_BYTES);
    return { value: bounded, bytes: bounded.length };
  }
  return null;
}

/**
 * Best-effort span categorization for the dashboard ('db' / 'ai' / 'lib').
 * db is checked FIRST because the 'ai' tracer test is substring-fuzzy and
 * must never steal a database span. The tracer-name lists follow the plan's
 * examples plus the common OTel instrumentation names; `db.`-prefixed
 * attribute keys (semconv) are the authoritative db signal, `gen_ai.`/`ai.`
 * prefixes (semconv / Vercel AI SDK) the ai signal.
 */
export function classifyLibrarySpanCategory(tracerName: string, attributeKeys: Iterable<string>): "db" | "ai" | "lib" {
  let hasDbAttr = false;
  let hasAiAttr = false;
  for (const key of attributeKeys) {
    if (key === "db.system" || key.startsWith("db.")) hasDbAttr = true;
    if (key.startsWith("gen_ai.") || key.startsWith("ai.")) hasAiAttr = true;
  }
  if (hasDbAttr || /prisma|drizzle|pg|postgres|mysql|sqlite|mariadb|mssql|mongo|redis/i.test(tracerName)) return "db";
  // Word-ish boundary instead of a bare substring: the Vercel AI SDK's tracer
  // is literally named "ai", but a bare includes("ai") would misfile tracers
  // like "email" or "langchain-utils"' "chain".
  if (hasAiAttr || /(^|[^a-z])ai([^a-z]|$)|openai|anthropic|gen[-_]?ai/i.test(tracerName)) return "ai";
  return "lib";
}

const SPAN_KIND_NAMES = new Map<SpanKind, string>([
  [SpanKind.INTERNAL, "internal"],
  [SpanKind.SERVER, "server"],
  [SpanKind.CLIENT, "client"],
  [SpanKind.PRODUCER, "producer"],
  [SpanKind.CONSUMER, "consumer"],
]);

// ---------------------------------------------------------------------------
// Span
// ---------------------------------------------------------------------------

type BridgeSpanInit = {
  name: string,
  tracerName: string,
  spanContext: SpanContext,
  handle: LibrarySpanHandle | null,
  startedAtMs: number,
  kind: SpanKind | undefined,
};

export class HexclaveBridgeSpan implements OtelSpan {
  private _name: string;
  private readonly _tracerName: string;
  private readonly _spanContext: SpanContext;
  private readonly _handle: LibrarySpanHandle | null;
  private readonly _startedAtMs: number;
  private readonly _kind: SpanKind | undefined;
  private readonly _attributes = new Map<string, StoredAttribute>();
  private _attributeBytes = 0;
  private _droppedEventCount = 0;
  private _status: SpanStatus | null = null;
  private _ended = false;

  constructor(init: BridgeSpanInit) {
    this._name = init.name;
    this._tracerName = init.tracerName;
    this._spanContext = init.spanContext;
    this._handle = init.handle;
    this._startedAtMs = init.startedAtMs;
    this._kind = init.kind;
  }

  spanContext(): SpanContext {
    return this._spanContext;
  }

  setAttribute(key: string, value: SpanAttributeValue): this {
    this._storeAttribute(key, value);
    return this;
  }

  setAttributes(attributes: SpanAttributes): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) this._storeAttribute(key, value);
    }
    return this;
  }

  private _storeAttribute(key: string, value: SpanAttributeValue): void {
    if (this._ended) return;
    if (DROPPED_ATTRIBUTE_KEY_RE.test(key)) return;
    const normalized = normalizeAttributeValue(value);
    if (normalized === null) return;
    const previous = this._attributes.get(key);
    if (previous === undefined) {
      if (this._attributes.size >= MAX_ATTRIBUTES_PER_SPAN) return;
      if (this._attributeBytes + key.length + normalized.bytes > MAX_TOTAL_ATTRIBUTE_BYTES) return;
      this._attributeBytes += key.length + normalized.bytes;
    } else {
      this._attributeBytes += normalized.bytes - previous.bytes;
    }
    this._attributes.set(key, normalized);
  }

  addEvent(_name: string, _attributesOrStartTime?: SpanAttributes | TimeInput, _startTime?: TimeInput): this {
    // Span events are dropped in v1 (the native model has real child events,
    // and no target library depends on OTel events); count them so the row
    // records that something was elided.
    this._droppedEventCount++;
    return this;
  }

  addLink(): this {
    return this;
  }

  addLinks(): this {
    return this;
  }

  setStatus(status: SpanStatus): this {
    if (!this._ended) this._status = status;
    return this;
  }

  updateName(name: string): this {
    if (!this._ended) this._name = name;
    return this;
  }

  isRecording(): boolean {
    return !this._ended && this._handle !== null;
  }

  recordException(exception: Exception, _time?: TimeInput): void {
    // OTel records exceptions as span EVENTS; since events are dropped, the
    // exception folds into attributes instead (in practice libraries record
    // at most one exception per span, right before setStatus(ERROR) + end).
    const info: { name?: unknown, message?: unknown, stack?: unknown, code?: unknown } =
      typeof exception === "string" ? { message: exception } : exception;
    if (typeof info.name === "string") this._storeAttribute("exception.type", info.name);
    else if (typeof info.code === "string" || typeof info.code === "number") this._storeAttribute("exception.type", String(info.code));
    if (typeof info.message === "string") this._storeAttribute("exception.message", info.message);
    if (typeof info.stack === "string") this._storeAttribute("exception.stacktrace", info.stack);
  }

  end(endTime?: TimeInput): void {
    // OTel contract: ending twice is a no-op (first end wins).
    if (this._ended) return;
    this._ended = true;
    if (this._handle === null) return;
    // Clamp instead of throwing: a library handing us a nonsensical end time
    // must never turn span.end() into a crash inside ITS code path.
    const endedAtMs = Math.max(this._startedAtMs, timeInputToMs(endTime) ?? Date.now());
    this._handle.end(endedAtMs, this._buildData());
  }

  private _buildData(): Record<string, unknown> {
    const attributes: Record<string, unknown> = {};
    for (const [key, stored] of this._attributes) {
      attributes[key] = stored.value;
    }
    const statusCode = this._status?.code;
    const statusMessage = this._status?.message;
    const kindName = this._kind !== undefined ? SPAN_KIND_NAMES.get(this._kind) : undefined;
    return {
      // Attributes first so the reserved keys below always win a collision
      // (a library attribute literally named "name" must not clobber ours).
      ...attributes,
      name: this._name,
      tracer_name: this._tracerName,
      ...kindName !== undefined && this._kind !== SpanKind.INTERNAL ? { kind: kindName } : {},
      ...statusCode === SpanStatusCode.OK ? { status_code: "ok" } : {},
      ...statusCode === SpanStatusCode.ERROR ? { status_code: "error" } : {},
      ...typeof statusMessage === "string" && statusMessage.length > 0
        ? { status_message: truncateUtf8Bytes(statusMessage, MAX_ATTRIBUTE_VALUE_BYTES) }
        : {},
      ...this._droppedEventCount > 0 ? { dropped_event_count: this._droppedEventCount } : {},
      category: classifyLibrarySpanCategory(this._tracerName, this._attributes.keys()),
    };
  }
}

// ---------------------------------------------------------------------------
// Tracer + provider
// ---------------------------------------------------------------------------

export class HexclaveTracer implements Tracer {
  constructor(
    private readonly _name: string,
    private readonly _state: LibrarySpanBridgeGlobalState,
  ) {}

  startSpan(name: string, options?: SpanOptions, ctx?: Context): OtelSpan {
    const activeContext = ctx ?? contextApi.active();
    // Parenting case (a): the context carries a span we minted, or a remote
    // W3C parent the global propagator extracted from traceparent.
    let otelParent: LibrarySpanOtelParent | null = null;
    if (options?.root !== true) {
      const parentSpan = traceApi.getSpan(activeContext);
      if (parentSpan !== undefined) {
        const parentSpanContext = parentSpan.spanContext();
        const mapped = this._state.registry.get(parentSpanContext.spanId);
        if (mapped !== undefined) {
          otelParent = mapped;
        } else if (
          parentSpanContext.isRemote === true
          && isW3cTraceId(parentSpanContext.traceId)
          && isW3cSpanId(parentSpanContext.spanId)
        ) {
          // A remote span is allowed to name a row written by another tier — in
          // this product that is normally the browser's `$http-client`. Unlike
          // an arbitrary local foreign span, treating it as a parent is exactly
          // the W3C propagation contract and cannot fabricate a local row.
          otelParent = {
            traceId: parentSpanContext.traceId,
            recordedSpanId: parentSpanContext.spanId,
            sampled: (parentSpanContext.traceFlags & 1) === 1,
            ambientSpanId: null,
          };
        }
      }
    }
    const startedAtMs = timeInputToMs(options?.startTime) ?? Date.now();
    const handle = shouldIgnoreLibrarySpan(this._name, name)
      || isLibrarySpanBridgeTelemetrySuppressed()
      ? null
      : this._state.deps?.beginLibrarySpan({
        name,
        tracerName: this._name,
        startedAtMs,
        otelParent,
      }) ?? null;
    // A recording span uses the identity the seam resolved, so the OTel-visible
    // context and the stored row can never disagree. A non-recording span still
    // needs a valid W3C identity for the library's own use: it keeps its parent's
    // trace when it has one, so the trace stays coherent across the gap.
    const spanContext: SpanContext = {
      traceId: handle?.traceId ?? otelParent?.traceId ?? generateW3cTraceId(),
      spanId: handle?.spanId ?? generateW3cSpanId(),
      // A parentless span declined by the seam (for example, collector work in
      // a suppression scope) is non-recording and must never advertise a
      // sampling decision that no stored row can satisfy.
      traceFlags: (handle?.sampled ?? otelParent?.sampled ?? false) ? 1 : 0,
    };
    if (handle !== null) {
      // This span WILL be written, so it is its own nearest recorded ancestor.
      registerSpanMapping(this._state.registry, spanContext.spanId, {
        traceId: handle.traceId,
        recordedSpanId: handle.spanId,
        sampled: handle.sampled,
        ambientSpanId: handle.ambientSpanId,
      });
    } else if (otelParent !== null) {
      // Non-recording but inside a known trace: forward our PARENT's recorded
      // ancestor so children skip this phantom instead of naming it. Leaving a
      // parentless non-recording span unregistered is deliberate — see the
      // orphan-trap note in the module doc.
      registerSpanMapping(this._state.registry, spanContext.spanId, otelParent);
    }
    const span = new HexclaveBridgeSpan({
      name,
      tracerName: this._name,
      spanContext,
      handle,
      startedAtMs,
      kind: options?.kind,
    });
    if (options?.attributes !== undefined) {
      span.setAttributes(options.attributes);
    }
    return span;
  }

  startActiveSpan<F extends (span: OtelSpan) => unknown>(name: string, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: OtelSpan) => unknown>(name: string, options: SpanOptions, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: OtelSpan) => unknown>(name: string, options: SpanOptions, context: Context, fn: F): ReturnType<F>;
  // The implementation constraint is self-referential ((span) => ReturnType<F>)
  // instead of the interface's (span) => unknown so `contextApi.with(ctx, fn,
  // undefined, span)` typechecks — the exact shape the upstream NoopTracer
  // uses for the same reason.
  startActiveSpan<F extends (span: OtelSpan) => ReturnType<F>>(
    name: string,
    arg2: SpanOptions | F,
    arg3?: Context | F,
    arg4?: F,
  ): ReturnType<F> {
    let options: SpanOptions | undefined;
    let ctx: Context | undefined;
    let fn: F;
    if (typeof arg2 === "function") {
      fn = arg2;
    } else if (typeof arg3 === "function") {
      options = arg2;
      fn = arg3;
    } else {
      options = arg2;
      ctx = arg3;
      if (arg4 === undefined) {
        throw new Error("Hexclave analytics: startActiveSpan(name, options, context, fn) requires a callback");
      }
      fn = arg4;
    }
    const span = this.startSpan(name, options, ctx);
    const parentContext = ctx ?? contextApi.active();
    // Matches the upstream SDK: run fn inside a context carrying the new span
    // (context.with = our ALS-backed manager), and do NOT auto-end — the API
    // contract makes the callback responsible for span.end().
    return contextApi.with(traceApi.setSpan(parentContext, span), fn, undefined, span);
  }
}

export class HexclaveTracerProvider implements TracerProvider {
  // One tracer per name is all the API requires (versions/options do not
  // change our behavior); libraries call getTracer repeatedly on hot paths.
  private readonly _tracers = new Map<string, HexclaveTracer>();

  constructor(private readonly _state: LibrarySpanBridgeGlobalState) {}

  getTracer(name: string, _version?: string, _options?: TracerOptions): Tracer {
    let tracer = this._tracers.get(name);
    if (tracer === undefined) {
      tracer = new HexclaveTracer(name, this._state);
      this._tracers.set(name, tracer);
    }
    return tracer;
  }
}

// ---------------------------------------------------------------------------
// Context manager (AsyncLocalStorage-backed)
// ---------------------------------------------------------------------------

type ContextAls = AsyncLocalStorageLike<Context>;

export class HexclaveContextManager implements ContextManager {
  constructor(private readonly _als: ContextAls) {}

  active(): Context {
    return this._als.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this._als.run(context, () => fn.call(thisArg, ...args));
  }

  bind<T>(context: Context, target: T): T {
    // Functions are the only binding v1 supports — what promise callbacks and
    // queued work need. OTel's node manager additionally binds EventEmitters,
    // which no target library of this bridge requires; an unbound emitter
    // degrades to ambient-parent resolution, never an error.
    if (typeof target === "function") {
      const manager = this;
      const bound = function (this: unknown, ...args: unknown[]): unknown {
        return manager.with(context, () => target.apply(this, args));
      };
      // The ContextManager signature is generic over T, and TypeScript cannot
      // express "when T is a function, return a same-shaped function" — every
      // upstream ContextManager implementation carries this exact cast.
      return bound as T;
    }
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    return this;
  }
}

/** Minimal W3C propagator so framework/library instrumentation joins browser traces. */
class HexclaveTraceContextPropagator implements TextMapPropagator {
  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    const spanContext = traceApi.getSpanContext(context);
    if (
      spanContext === undefined
      || !isW3cTraceId(spanContext.traceId)
      || !isW3cSpanId(spanContext.spanId)
    ) return;
    setter.set(carrier, "traceparent", formatTraceparent({
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      sampled: (spanContext.traceFlags & 1) === 1,
    }));
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const rawValue = getter.get(carrier, "traceparent");
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const parsed = parseTraceparent(typeof value === "string" ? value : null);
    if (parsed === null) return context;
    return traceApi.setSpanContext(context, {
      traceId: parsed.traceId,
      spanId: parsed.spanId,
      traceFlags: parsed.sampled ? 1 : 0,
      isRemote: true,
    });
  }

  fields(): string[] {
    return ["traceparent"];
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function loadContextAls(): Promise<ContextAls | null> {
  return loadAsyncLocalStorage<Context>("library-span-bridge-context");
}

function debugNote(message: string): void {
  // Debug level on purpose: backing off is a NORMAL state for users running
  // their own OTel stack, not a problem to warn about.
  console.debug(`Hexclave analytics: ${message}`);
}

/**
 * Claims the process-global OTel API for the bridge — but ONLY if it is free:
 * a user-registered tracer provider or context manager must never be
 * clobbered (their spans keep flowing to their own tooling; ours degrade to
 * the fetch-level `$http-client` spans). Back-off is all-or-nothing: the
 * bridge without its own context manager could cross-parent concurrent
 * requests, which is worse than no bridge.
 *
 * Idempotent per process (Symbol.for-keyed globalThis state shared across SDK
 * copies); repeated registration swaps the deps to the newest app instance
 * (HMR replace semantics). Server-only: browser-like environments and
 * runtimes without AsyncLocalStorage never register.
 */
export async function registerLibrarySpanBridge(deps: LibrarySpanBridgeDeps): Promise<LibrarySpanBridgeRegistration | null> {
  const state = getBridgeState();
  if (state.installed !== null) {
    state.deps = deps;
    return { provider: state.installed.provider };
  }
  if (state.backedOff) return null;
  // Browser-like environment: the client SDK owns browser telemetry, and an
  // exact async-context primitive does not exist there anyway.
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    state.backedOff = true;
    return null;
  }
  const als = await loadContextAls();
  if (als === null) {
    state.backedOff = true;
    debugNote("this runtime has no AsyncLocalStorage; the library-span bridge is disabled (library spans would cross-parent concurrent requests without it)");
    return null;
  }
  const provider = new HexclaveTracerProvider(state);
  if (!traceApi.setGlobalTracerProvider(provider)) {
    state.backedOff = true;
    debugNote("another OpenTelemetry tracer provider is already registered; leaving it in charge (library spans will not flow into Hexclave)");
    return null;
  }
  const contextManager = new HexclaveContextManager(als);
  if (!contextApi.setGlobalContextManager(contextManager)) {
    // Roll the provider claim back: with a foreign context manager active-span
    // propagation is not ours, so partial ownership would mis-parent spans.
    traceApi.disable();
    state.backedOff = true;
    debugNote("another OpenTelemetry context manager is already registered; the library-span bridge is backing off completely");
    return null;
  }
  if (!propagationApi.setGlobalPropagator(new HexclaveTraceContextPropagator())) {
    traceApi.disable();
    contextApi.disable();
    state.backedOff = true;
    debugNote("another OpenTelemetry propagator is already registered; the library-span bridge is backing off completely");
    return null;
  }
  state.deps = deps;
  state.installed = { provider, contextManager };
  return { provider };
}

/**
 * Test-only: releases the OTel globals if the bridge holds them and wipes the
 * process-global bridge state, so each test starts from a clean slate.
 */
export function resetLibrarySpanBridgeForTesting(): void {
  const holder = globalThis as { [BRIDGE_STATE_KEY]?: LibrarySpanBridgeGlobalState };
  const state = holder[BRIDGE_STATE_KEY];
  if (state?.installed) {
    propagationApi.disable();
    traceApi.disable();
    contextApi.disable();
  }
  delete holder[BRIDGE_STATE_KEY];
}
