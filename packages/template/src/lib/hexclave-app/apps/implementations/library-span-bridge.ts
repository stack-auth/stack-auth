import { truncateUtf8Bytes, uuidToW3cSpanId, uuidToW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { context as contextApi, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace as traceApi, type Context, type ContextManager, type Exception, type Span as OtelSpan, type SpanAttributes, type SpanAttributeValue, type SpanContext, type SpanOptions, type SpanStatus, type TimeInput, type Tracer, type TracerOptions, type TracerProvider } from "@hexclave/shared/dist/utils/otel-api";

/**
 * The hidden OpenTelemetry bridge: a minimal, hand-rolled implementation of
 * the `@opentelemetry/api` interfaces (TracerProvider/Tracer/Span + an
 * AsyncLocalStorage ContextManager) that turns spans any third-party library
 * emits through the OTel API GLOBAL — Prisma via `@prisma/instrumentation`,
 * Drizzle's OTel support, the Vercel AI SDK's `experimental_telemetry` — into
 * native Hexclave `$lib-span` rows, nested under the ambient Hexclave request
 * span. Users never configure exporters, endpoints, or collectors; the SDK IS
 * the in-process OTel implementation (the same pattern Sentry v8 uses).
 *
 * Deliberately NOT built on `@opentelemetry/sdk-trace-*`: the API surface the
 * libraries above actually exercise is tiny, and the SDK packages would drag
 * in processors/exporters/resources we would immediately have to neutralize.
 *
 * Parenting contract (see also the seam in server-app-impl._beginLibrarySpan):
 *  (a) the explicit/active OTel context carries a span WE minted → the native
 *      parent is that span's registry entry; parent_span_ids = its stored
 *      root-first path + its own native id (arbitrary OTel nesting depth,
 *      e.g. Prisma client:operation → engine:query → engine:db_query);
 *  (b) no OTel parent → the ambient Hexclave refs AT CALL TIME (enclosing
 *      withSpan frames + the request context's propagated client chain);
 *  (c) neither → project-level root (empty parents), still recorded.
 * Both lookups are AsyncLocalStorage-scoped, so this is concurrency-safe.
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

/** A native parent minted by this bridge: its uuid plus its own root-first parent chain. */
export type LibrarySpanOtelParent = {
  nativeId: string,
  parentPath: string[],
};

export type BeginLibrarySpanInfo = {
  name: string,
  tracerName: string,
  startedAtMs: number,
  /** Non-null when case (a) of the parenting contract applies; null defers to ambient resolution inside the seam. */
  otelParent: LibrarySpanOtelParent | null,
};

export type LibrarySpanHandle = {
  nativeId: string,
  /** The resolved root-first parent chain of THIS span (what children extend). */
  parentPath: string[],
  end: (endedAtMs: number, data: Record<string, unknown>) => void,
};

export type LibrarySpanBridgeDeps = {
  projectId: string,
  /**
   * Called synchronously at OTel startSpan time: resolves the ambient batch
   * context + parents, mints the native span uuid, and returns the row
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
// Bounded native-id registry: OTel span id → native mapping, FIFO-evicted.
// 2000 is far beyond any realistic set of spans whose CHILDREN are still
// being started; eviction only costs case-(a) parenting (the child falls back
// to ambient refs), never data loss.
const SPAN_REGISTRY_CAP = 2000;
// Tracer names whose spans are runtime plumbing rather than customer library
// work — never recorded (their spans stay API-complete but non-recording, so
// the emitting code path never breaks):
// - "stack-tracer": Hexclave's own internal instrumentation (@hexclave/shared's
//   traceSpan, wrapping utilities like wait()). Capturing it is not just noise
//   but a feedback loop: the telemetry sender's retry backoff calls wait(), so
//   every failed batch send would mint the $lib-span that fills the NEXT
//   batch, and the buffer never drains. This is the bridge's counterpart of
//   the self-capture guards the other capture layers already have (the fetch
//   wrapper's own-API-url exclusion, the console mirror's "Hexclave" prefix
//   skip).
// - "next.js": the framework's runtime spans (middleware, RSC render
//   pipeline, segment/module resolution). The bridge exists for LIBRARY work
//   the customer's code invokes (Prisma, Drizzle, AI SDKs); the request layer
//   is already modeled by the SDK's own system spans, and dev servers emit
//   these for every request/HMR round-trip at flood volume.
// Children of an ignored span miss the registry and fall through to ambient
// parenting (contract case (b)) — e.g. a Prisma span under a Next.js render
// span still parents under the Hexclave request context.
const IGNORED_TRACER_NAMES = new Set(["stack-tracer", "next.js"]);

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
  // w3c span id (16-hex) → native mapping; see SPAN_REGISTRY_CAP.
  registry: Map<string, LibrarySpanOtelParent>,
  // Sticky back-off so a foreign OTel setup produces exactly one debug note
  // per process, not one per register() call.
  backedOff: boolean,
};

const BRIDGE_STATE_KEY = Symbol.for("hexclave.analytics.library-span-bridge.v1");

function getBridgeState(): LibrarySpanBridgeGlobalState {
  const holder = globalThis as { [BRIDGE_STATE_KEY]?: LibrarySpanBridgeGlobalState };
  holder[BRIDGE_STATE_KEY] ??= {
    installed: null,
    deps: null,
    registry: new Map(),
    backedOff: false,
  };
  return holder[BRIDGE_STATE_KEY];
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
    // Parenting case (a): the context carries a span we minted. Foreign spans
    // (a remote SpanContext wrapped via trace.wrapSpanContext, or a span from
    // a second bundled api copy) miss the registry and fall through to (b)/(c)
    // inside the seam.
    let otelParent: LibrarySpanOtelParent | null = null;
    let parentTraceId: string | null = null;
    if (options?.root !== true) {
      const parentSpan = traceApi.getSpan(activeContext);
      if (parentSpan !== undefined) {
        const parentSpanContext = parentSpan.spanContext();
        const mapped = this._state.registry.get(parentSpanContext.spanId);
        if (mapped !== undefined) {
          otelParent = mapped;
          parentTraceId = parentSpanContext.traceId;
        }
      }
    }
    const startedAtMs = timeInputToMs(options?.startTime) ?? Date.now();
    const handle = IGNORED_TRACER_NAMES.has(this._name)
      ? null
      : this._state.deps?.beginLibrarySpan({
        name,
        tracerName: this._name,
        startedAtMs,
        otelParent,
      }) ?? null;
    // A non-recording span (no seam / telemetry disabled) still needs a valid
    // W3C identity, so mint a local uuid purely for id derivation.
    const nativeId = handle?.nativeId ?? crypto.randomUUID();
    const spanContext: SpanContext = {
      // Children share the OTel parent's trace id (W3C trace coherence, and
      // it matches how the backend derives trace ids from the root native
      // uuid); roots derive a fresh trace id from their own native uuid.
      traceId: parentTraceId ?? uuidToW3cTraceId(nativeId),
      spanId: uuidToW3cSpanId(nativeId),
      traceFlags: 1, // sampled
    };
    if (handle !== null) {
      registerSpanMapping(this._state.registry, spanContext.spanId, {
        nativeId: handle.nativeId,
        parentPath: handle.parentPath,
      });
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

type ContextAls = {
  run: <T>(store: Context, fn: () => T) => T,
  getStore: () => Context | undefined,
};

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

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

type AsyncHooksModuleLike = {
  AsyncLocalStorage?: new () => ContextAls,
};

let contextAlsPromise: Promise<ContextAls | null> | null = null;

async function loadContextAls(): Promise<ContextAls | null> {
  contextAlsPromise ??= (async () => {
    try {
      // Opaque specifier so bundlers leave this as a runtime dynamic import —
      // it rejects in browsers and resolves to the built-in everywhere
      // node-like. Mirrors span-context-state.ts.
      const specifier = "node:async_hooks";
      const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier) as AsyncHooksModuleLike;
      return typeof mod.AsyncLocalStorage === "function" ? new mod.AsyncLocalStorage() : null;
    } catch {
      return null;
    }
  })();
  return await contextAlsPromise;
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
    traceApi.disable();
    contextApi.disable();
  }
  delete holder[BRIDGE_STATE_KEY];
}
