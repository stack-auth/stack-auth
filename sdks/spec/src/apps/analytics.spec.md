# Analytics & Telemetry

The custom-telemetry surface shared by HexclaveClientApp and HexclaveServerApp:
events, spans, logs, error capture, network capture, and cross-tier trace
propagation. Client-side autocapture ($page-view, $click, session replay, web
vitals) is browser-only; the APIs below exist on both app classes unless marked
otherwise.

All telemetry ships through the analytics batch route:

  POST /api/v1/analytics/events/batch
  (client access with the client app's credentials; server access with
  secretServerKey for the server-side buffer)

Telemetry must NEVER throw into or otherwise affect user code, except where a
method's contract explicitly says it throws/rejects on invalid input.


## Shared validation rules

These are enforced identically by the SDK (locally, before buffering) and the
batch route (an invalid item 400s the whole batch, so local validation must not
drift):

- Custom event/span type names: regex ^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$.
  "$"-prefixed names are reserved for system telemetry and rejected for custom
  items.
- data payloads: plain JSON-serializable object, at most 64,000 bytes when
  JSON.stringify'd. For spans the cap applies to the accumulated merged data.
- All span/parent/batch ids: RFC 4122-shaped uuids, regex
  ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$
  (case-insensitive). Generate with crypto.randomUUID().
- Parent chains: at most 10 entries; on overflow keep the 10 NEAREST ancestors
  (the tail of the root-first list) and print a console warning.
- $log messages: at most 8,192 UTF-8 bytes. $error messages/stacks: same cap.
  Truncation must never split a UTF-8 code point.


## Constructor options

Both app constructors accept three independent option objects. Analytics and
Observability default to enabled and share one delivery core.

  TelemetryResource = {
    service: {
      name: string
      namespace?: string
      version?: string
      instanceId?: string
    }
    deploymentEnvironmentName?: string
    attributes?: Record<string, unknown>
  }

  analytics: {
    enabled?: bool
    replays?: { enabled?, maskAllInputs?, blockClass?, blockSelector? }
    integritySignals?: bool
  }

`analytics.enabled` controls custom/product events, autocapture, replays, and
integrity signals. It does not disable code instrumentation.

  observability: {
    enabled?: bool
    release?: string
    environment?: string
    errorCapture?: { enabled?: bool, ignoreErrors?: string[] }
    logs?: { captureConsole?: ("log" | "warn" | "error" | "info" | "debug")[] }
    spanPropagation?: {
      enabled?: bool
      allowedOrigins?: string[]
      useTrustedDomains?: bool
    }
    network?: {
      enabled?: bool
      capture?: "all" | "errors-only"
      sampleRate?: number
      allowOrigins?: string[]
      denyOrigins?: string[]
      ignoreUrls?: string[]
    }
  }

`observability.enabled` controls errors, logs, spans, propagation, and network
or library instrumentation. Console capture defaults to warn+error; error,
network, and propagation capture default to enabled. Release and environment
use the platform defaults described in the error-capture section.

  telemetry: {
    resource?: TelemetryResource
    waitUntil?: (promise) => void
  }

`telemetry.resource` is the immutable identity of the process, deployment, or
browser application producing the telemetry. It is REQUIRED whenever either
Analytics or Observability is effectively enabled. Because both default to
enabled, omitting it is valid only when both `analytics.enabled` and
`observability.enabled` are explicitly false (or when the app has no telemetry
delivery path, such as an owner-session admin app). Validate and throw
synchronously at app construction; NEVER infer a service from the SDK class,
framework, hostname, request URL, project, or runtime, and NEVER substitute a
generic fallback such as "Hexclave".

Every event, span, log, error, replay batch, and derived library/network signal
emitted by one app instance carries the same frozen resource. There is no
per-item or per-span resource override. Validate and defensively snapshot the
complete resource at construction, so later mutation of the caller's input
object cannot change service identity. An app created with `inheritsFrom`
inherits the parent's entire `telemetry` object when `telemetry` is omitted. If
the child supplies `telemetry`, top-level constructor replacement semantics
apply; in particular an explicit `telemetry.resource` replaces the parent's
resource ATOMICALLY — do not deep-merge `service` or `attributes`. Serialization
across runtime boundaries preserves `resource` but omits the function-valued
`waitUntil`.

The logical service identity tuple is:

  (service.namespace ?? "", service.name)

`service.version`, `service.instanceId`, and
`deploymentEnvironmentName` describe a version, replica/browser instance, and
deployment environment of that logical service; they MUST NOT split one service
into unrelated names. Distinct clients that send to one Hexclave project MUST
choose distinct logical service identities (normally distinct service.name
values, optionally grouped by a shared namespace), for example
`stack-dashboard` for the browser/dashboard and `stack-backend` for its API.
Changing the user, session, host, route, or request does not change the app
resource.

`telemetry.waitUntil` owns the shared serverless delivery lifecycle. Every
Analytics or Observability send is passed to it. It is function-valued and
therefore omitted from serialized app JSON. Server sends otherwise use the
per-request platform hook when one is available.

Validation at app construction (throw synchronously):
- telemetry.resource is required under the enablement rule above.
- resource.service must be an object and resource.service.name must be a
  non-empty string.
- service.name, service.namespace, service.version, service.instanceId, and
  deploymentEnvironmentName are non-empty strings when present, each at most
  255 characters.
- resource.attributes, when present, is a plain JSON-serializable object whose
  serialized UTF-8 form is at most 16 KiB.
- network.allowOrigins and network.denyOrigins are mutually exclusive.
- network.sampleRate must be a number in [0, 1].


## Batch wire format

One batch per flush. Body (JSON):

  {
    schema_version: 2,          // versions the envelope+row shapes
    resource: TelemetryResource,// required, copied from the app constructor
    batch_id: uuid,             // fresh per send
    sent_at_ms: number,
    // Browser batches:
    session_replay_segment_id: uuid,   // the tab's segment identity
    // Server-key batches (fields present only when known):
    user_id?: uuid,
    refresh_token_id?: uuid,           // resolved from the request session
    session_replay_id?: uuid,          // from the propagation header
    session_replay_segment_id?: uuid,  // from the propagation header
    events?: [EventItem, ...],
    spans?: [SpanRow, ...],
  }

The replay uploader uses its existing dedicated route, but the same resource
contract applies. Every session replay batch body begins with:

  {
    schema_version: 2,
    resource: TelemetryResource,
    browser_session_id: uuid,
    session_replay_segment_id: uuid,
    batch_id: uuid,
    started_at_ms: number,
    sent_at_ms: number,
    events: [...]
  }

On ingestion, copy the structured resource fields to the corresponding
service_namespace, service_name, service_version, service_instance_id, and
deployment_environment_name columns, and store only the remaining custom
attributes in resource_attributes. Missing/invalid resource or an empty
service.name rejects the entire v2 batch. Never infer a value during ingestion
and never place such rows into an "unknown" or generic service bucket.

EventItem:
  {
    event_type: string,               // custom name or system "$..." type
    event_at_ms: number,
    data: object,
    parent_span_ids?: [uuid, ...],    // farthest-known → nearest-known custom ancestry
    page_view_span_id?: uuid,         // the $page-view span this item happened on
    http_client_span_id?: uuid,       // server items only — see the
                                      // nearest-ancestor rule below
    // $log items only (route-enforced: required on $log, forbidden elsewhere):
    message?: string,
    level?: "trace" | "debug" | "info" | "warn" | "error",
  }

SpanRow (versioned upsert; the row with the highest updated_at_ms per span_id
wins server-side):
  {
    span_id: uuid,
    span_type: string,
    started_at_ms: number,
    ended_at_ms: number | null,       // null = still-open interval
    parent_span_ids: [uuid, ...],
    data: object,                     // the FULL accumulated data, re-sent every row
    updated_at_ms: number,            // per-span monotonic: max(Date.now(), last+1)
    page_view_span_id?: uuid,         // frozen at span creation; never on $page-view rows
    http_client_span_id?: uuid,       // server rows only; never on $http-client rows
  }

All ids on the wire are RAW uuids — the system prefixes readers see (rti-, sri-,
srsi-, pv-, hc-, cs-) are applied by the ingestion route, never by the SDK.

Buffering/flush:
- Browser: buffer and flush every ~10 seconds, or sooner when the buffer fills;
  keepalive flush on tab hide/unload. Span updates within one flush window
  coalesce to one row per span id (latest wins; superseded rows' promise
  settlers ride along and settle with the shipped batch). Non-keepalive
  analytics and replay bodies use gzip only when the JSON is at least 1 KiB and
  compression makes it smaller; keepalive bodies stay plain JSON so dispatch
  is not delayed by asynchronous compression during page teardown.
- Server: coalesce per (userId + request-context) batch key and flush on the
  next microtask, or immediately when a batch reaches 500 items. No timer:
  awaiting the returned promises or calling flush() is the delivery guarantee.
  Every send promise is also passed to telemetry.waitUntil (explicit, else the
  auto-detected Vercel hook — see the option above).
- Server sticky disable: when a batch send fails with the backend's
  ANALYTICS_NOT_ENABLED rejection (matched on the KnownErrors code in the
  failure text), server telemetry disables for the REST OF THE PROCESS: warn
  once, clear the buffers, reject subsequent telemetry promises locally
  ("analytics is not enabled for this project"), and stop opening
  $http-client spans. Required by the eager instrumentation install — a
  project without the analytics app must not send a doomed batch per outgoing
  fetch forever. Mirrors the browser tracker's AnalyticsNotEnabled _disable().


## trackEvent(eventType, data?, options?)

Buffers one EventItem. Returns a promise that resolves when the batch carrying
the event is acknowledged and rejects (pre-caught, so fire-and-forget is safe)
on invalid input, disabled/unavailable analytics, or definitive send failure.

TrackOptions:
  parentIds: ParentRef[]?      - explicit parents (see "Parent resolution")
  root: bool?                  - drop ALL ambient parents; only parentIds apply
  excludeParentIds: ParentRef[]? - drop specific ids from the FINAL merged list

Server-side additionally:
  userId: uuid?    - explicit attribution (validated as uuid)
  request: RequestLike? - resolve attribution + client-session ancestry from an
    incoming request (see "Server request linking")


## logger (both app classes)

`app.logger` is an eagerly-available object with five methods, one per log
level (the wire's single level vocabulary — there is no numeric severity):

  logger.trace(message, data?)   level "trace"
  logger.debug(message, data?)   level "debug"
  logger.info(message, data?)    level "info"
  logger.warn(message, data?)    level "warn"
  logger.error(message, data?)   level "error"

Each call emits one `$log` EventItem with message/level set. Contract:

- Fire-and-forget; NEVER throws into user code.
- Non-string messages are coerced to a bounded string representation (depth-
  limited, circular-safe) rather than dropped.
- message is truncated to 8,192 UTF-8 bytes BEFORE buffering.
- `data` follows the normal event-data validation; invalid data drops the log
  with a console warning.
- Environments with no delivery path (analytics disabled; non-browser client
  app) warn ONCE per app instance and silently drop further logs.
- Logs carry the same ambient context as events: current $page-view span,
  global spans, enclosing withSpan frames. Server logs inside a
  withSpan({ request }) scope inherit the caller's client-session ancestry
  (including http_client_span_id per the nearest-ancestor rule).
- Every emitted item carries a client-side-only origin marker ("logger" for
  explicit calls, "console" for the automatic mirror) that never leaves the
  process — it routes pre-load buffering (below), nothing else.

### Console capture (observability.logs.captureConsole)

DEFAULT ON with levels ["warn", "error"] — automatic log capture is a
zero-setup product guarantee. Users widen with the full level list or opt out
with []. Capture only INSTALLS where the app has a real delivery path:

- Browser: an active client analytics facade (analytics enabled + browser +
  a refreshable client session). Owner-session admin apps never install.
- Server: a non-browser server app with a secret server key (the same
  exclusions as the eager fetch/error instrumentation).

Patch those console methods GLOBALLY. ALL patch state (active sink, patched
methods, re-entrancy flag, rate buckets) lives in ONE globalThis slot keyed by
Symbol.for("hexclave.analytics.console-capture.v1"), shared across duplicate
SDK copies — two module-local copies would wrap each other's wrappers and an
uninstall could sever the chain into infinite recursion. Last installer wins
(replace, don't stack, so HMR cannot duplicate lines); replacing a sink whose
projectId differs logs ONE console warning naming both projects.

1. The original console method always runs FIRST, unconditionally — and is
   never rate limited, redacted, or otherwise altered.
2. Mirror the call through an origin:"console" logger at the mapped level
   (console.log maps to level info) with the args serialized to one string:
   string args verbatim; other values first pass a key-redaction walk (keys
   matching /authorization|cookie|passw|secret|token|api[-_]?key|
   session[-_]?id|private[-_]?key/i become "[redacted]", bounded depth 4,
   plain objects/arrays only) and then the bounded serializer. data is
   { console_level: <level> }.
3. If any arg is an actual Error, additionally set data.error_name and
   data.error_fingerprint — computed EXACTLY like the $error pipeline
   (truncate message/stack to the 8,192-byte cap, then fingerprint), so a
   thrown-and-logged error is collapsible to one line in the dashboard.
4. Skip messages whose first arg is a string starting with "Hexclave" (the
   SDK's own warnings must never report themselves). Additionally expose
   runWithoutConsoleCapture(fn) — sets the shared suppression flag around fn —
   as the SDK-internal diagnostics escape hatch.
5. Re-entrancy guard: the logger's own console use must not loop (same shared
   suppression flag).
6. Per-LEVEL token bucket (burst 100, refill 10/s) so a runaway info/log loop
   can never starve error capture. When a bucket first runs dry, emit exactly
   one $log (level warn, data { console_level, rate_limited: true }) saying
   mirrors are being dropped; stay silent until the bucket refills. Explicit
   app.logger.* calls are NEVER rate limited. Refill elapsed time uses a
   monotonic clock, never wall-clock time.
7. Uninstall restores a method only when it is still the SDK's patch.

Pre-load buffering (browser): origin:"console" items arriving before the
lazily-loaded tracker module NEVER trigger the load (a chatty hydration must
not pull the analytics runtime onto the critical path). They queue — with
parents and timestamp captured at call time — in a 100-item ring buffer
(overflow drops the OLDEST), drained through the normal adoption path
(generation-checked, so a sign-out in between drops them) when the
idle-scheduled load completes. origin:"logger" items keep the load-triggering
fast path of custom events.


## startSpan(spanType, options?) / the Span handle

StartSpanOptions: { data?, parentIds?, startedAtMs?, root?, excludeParentIds? }
(server-side additionally userId?).

Behavior:
- Validate spanType/data/startedAtMs; invalid input THROWS synchronously with
  the same messages in every environment.
- The span's open interval row (ended_at_ms: null) is enqueued immediately, so
  a span that is never ended still shows up as an open interval.
- setData(data): shallow-merge and re-write (validation applies to the merged
  result). end(options?): idempotent; endedAtMs must be an integer >= start.
- Handle members: spanId, spanType, isEnded, setData, end, trackEvent,
  startSpan, withSpan, run, ref(), getSpanPropagationHeaders(), fetch().
  ref() returns the serializable { spanId, parentSpanIds } identity.

Inert spans (environment unavailability, NOT invalid input): when a CLIENT app
is used where telemetry cannot exist at all — e.g. server-side rendering /
non-browser — startSpan returns an INERT span instead of throwing, so
isomorphic code needs no environment branches:
- Input validation still throws exactly like the real path (malformed data,
  endedAtMs before start, setData after end, invalid child input).
- Lifecycle methods resolve immediately and never emit a row; trackEvent on
  the inert handle RESOLVES (knowingly dropped); ref() returns the id the span
  would have had; getSpanPropagationHeaders() returns {}; fetch() passes
  through to global fetch.
(Note: app.trackEvent in the same environment REJECTS instead — an event has
no handle to be inert through.)

## withSpan(spanType, optionsOrFn, fn?)

Starts the span, runs fn with the span as an ambient parent for everything
created inside (AsyncLocalStorage-exact on servers; synchronous-window-only in
browsers), ends it when fn settles. On throw: setData({ error: message }) then
end, then rethrow. Telemetry acks never block fn's result.

## setGlobalSpan(span) / clearGlobalSpan(span)

Registers/unregisters a span as an ambient parent for all subsequently tracked
items. Ending a span auto-unregisters it. All ambient + explicit parents must
merge into ONE ancestry path (see below).

## Parent resolution

A ParentRef is a raw span uuid string, a { spanId, parentSpanIds } ref, or a
live Span handle. Handles/refs contribute their FULL frozen path
([...parentSpanIds, spanId]); raw strings contribute only themselves, in array
order (each declares the next-nearer parent). Merge all parts into one
farthest-known → nearest-known path:
- A part that extends (or is a prefix of) the path so far merges in.
- Partial head/tail overlaps merge as long as no duplicate ids result.
- Unrelated/sibling paths are REJECTED (error), never flattened.
Apply excludeParentIds to the final merged list, then cap to the 10 nearest.


## Cross-tier propagation (x-hexclave-span-context + traceparent)

### Header codec

Header name: x-hexclave-span-context
Value: "v1." + base64url(JSON.stringify(payload)) where payload is:

  {
    projectId: string,             // required
    sessionReplayId?: uuid,
    sessionReplaySegmentId?: uuid,
    pageViewSpanId?: uuid,         // the sender's current $page-view span
    httpClientSpanId?: uuid,       // the $http-client span opened for THIS request
    customParentSpanIds?: [uuid],  // capped to the 10 NEAREST ancestors
  }

Decode rules (receiver): null for missing/oversized (> 4096 chars)/wrong
version/undecodable/structurally invalid values — a bad header must never
throw into the request path. Individually invalid uuid fields are dropped, not
fatal. All ids in the header are CLIENT-CONTROLLED labels: fine for telemetry,
never for authz/billing/security.

### When the header rides (browser)

The SDK wraps global fetch AND patches XMLHttpRequest
(open/send/setRequestHeader on the prototype), idempotently via globalThis
markers with a provider registry (HMR / multiple apps share one wrapper).
On uninstall, restore each XHR prototype method only when that slot is still
the SDK's wrapper; never overwrite instrumentation installed later.
Attach the header when ALL of:
- spanPropagation.enabled !== false and there is an ambient context;
- target is http(s) and same-origin OR in the propagation origin policy: the
  union of spanPropagation.allowedOrigins and (unless useTrustedDomains is
  false) the trusted-domain-derived origins, all exact origin matches — plus
  localhost/loopback targets (any port) when the project allows localhost;
- the request is not mode: "no-cors" (fetch);
- the caller did NOT set the header themselves (caller intent always wins);
- across ALL registered providers there is exactly ONE candidate header value
  (ambiguous multi-project same-origin requests fail closed).

### httpClientSpanId + traceparent (the W3C bridge)

When the fetch/XHR instrumentation opened a $http-client span for the request
AND that span is GUARANTEED to be stored (see sampling below):
- include httpClientSpanId: <span uuid> in the header payload, and
- also set a `traceparent` header (unless the caller already set one),
  derived deterministically from the span's uuid U:
    trace id = lowercase hex of U without dashes (32 chars)
    span id  = the last 16 of those chars (U's lower 8 bytes)
    value    = "00-<traceid>-<spanid>-01"   // always flagged sampled
  This makes backend OpenTelemetry spans of the request share a trace id that
  is a pure function of the client span's id — joinable at read time with no
  correlation state.
When no span was stored (capture disabled / filtered / sampled out), the
context header still rides WITHOUT httpClientSpanId and NO traceparent is
emitted — a traceparent must always point at a stored span.

### Manual propagation

app.getSpanPropagationHeaders(options?: { parentIds?, root? }) [client]
  Returns { "x-hexclave-span-context": <value> } carrying the same ambient
  context an event tracked right now would get, or {} when there is nothing to
  propagate. For transports the SDK cannot instrument (sendBeacon, WebSocket
  handshakes, manually-built requests).

span.getSpanPropagationHeaders()
  Same, but pinned to exactly this span and its frozen chain.

span.fetch(input, init?)
  fetch with the header pinned to this span. Browser: follows the same
  same-origin/allowedOrigins policy as the automatic wrapper and never
  overwrites an explicitly-set header. SERVER: fails closed — there is no
  self-origin, so no header is attached; use getSpanPropagationHeaders()
  explicitly for trusted targets.


## $http-client spans (network capture)

One span per outgoing http(s) request observed by the instrumentation, on both
tiers (browser fetch + XHR; server outbound fetch once the server fetch
instrumentation is installed). Span creation is independent of the header
origin policy (it is a local write) but respects observability.network filters.

Span data:
  { method, url, transport: "fetch" | "xhr",
    // set at end:
    status?, error?: 1, aborted?: 1, propagated?: 1 }

- url is SANITIZED to origin + pathname only (query/hash/userinfo stripped —
  they routinely carry tokens). Non-http(s)/unparseable targets: no span.
- propagated: 1 means this span's uuid actually rode the outgoing header (+
  traceparent) — the bridge exists for this request.
- End the span when response HEADERS arrive (never the body stream) or the
  request settles with an error. XHR: end on loadend; status 0 = errored.
- Aborted requests are NOT failures (SPA data layers cancel routinely).

Sampling / keep-drop state machine (decided at BEGIN time, because propagation
eligibility must be known before the request leaves):
- sampledIn = sampleRate >= 1 || Math.random() < sampleRate.
- guaranteed-keep iff capture == "all" AND sampledIn: the open row is written
  immediately, and ONLY these spans are propagation-eligible
  (httpClientSpanId/traceparent).
- Everything else is maybe-keep: NO row is written until end time; keep only
  if the outcome is in the ALWAYS-KEEP class:
    status >= 400, OR network error (errored && !aborted), OR duration >= 3s.
  Always-keep outcomes are kept regardless of sampleRate and under
  "errors-only" capture. Dropped maybe-keep spans are never written at all.
- Browser: hard cap of 500 $http-client spans per $page-view. Server: no cap,
  but requests to the SDK's own API base URL are never recorded.


## $error events (global error capture)

Errors are instants → EVENTS (a failure inside a span interval is recorded on
the span's own data.error instead). Event data (shared by all capture paths):

  {
    message,                    // truncated to 8,192 UTF-8 bytes
    name,
    stack?,                     // raw stack string, truncated to 8,192 bytes;
                                // no client-side frame parsing/sourcemapping
    mechanism_type,             // "global.onerror" | "global.unhandledrejection"
                                //  | "node.uncaughtexception" | "next.onRequestError"
    handled: false,
    synthetic?: 1,              // non-Error throw / synthesized message
    fingerprint,                // hex of djb2-xor over
                                // `${name}\n${message}\n${firstStackLine}`
                                // computed from the TRUNCATED values
    release?, environment?,     // from ObservabilityOptions
    sdk_version,
    // client extras: url (origin + pathname only; query/hash stripped), path,
    //   filename?, lineno?, colno?
    // next.onRequestError extras: path?, method?, router_kind?, route_path?,
    //   route_type?, digest?
  }

Client capture (browser; errorCapture.enabled):
- Patch the window.onerror and window.onunhandledrejection PROPERTY slots
  (never addEventListener): chain to any previous handler and forward its
  return value; restore on uninstall only if the slot is still ours.
- Rejection reason extraction: primitive event IS the reason, else .reason,
  else .detail.reason. Primitive reasons become a synthetic Error
  ("Non-Error promise rejection captured with value: ...").
- Non-Error objects: message "Object captured as exception with keys: ...",
  synthetic, capture-site stack. Primitives stay stackless.
- Raise Error.stackTraceLimit to 50 if lower (restore on uninstall).
- Drop when message CONTAINS any ignoreErrors substring (defaults included).
- Dedupe: a non-enumerable captured-marker on the error object, plus a
  single-slot last-captured signature check.
- Flood control per $page-view: max 10 per fingerprint, 100 total; warn once
  when capping. Reset the caps when the current $page-view span id changes.
- Capture failures must never recurse through the patched handlers (ignore-
  next counter + re-entrancy flag).

Server capture:
- process.on("uncaughtExceptionMonitor") ONLY — observation-only; never a
  plain uncaughtException listener (that would change Node's crash semantics).
  Replace-keyed per project on globalThis (HMR). Delivery is best-effort (the
  process may exit before the flush lands).
- Installed EAGERLY at server-app construction (plus redundantly on the first
  { request }-scoped telemetry call and by hexclaveInstrumentation().register()
  — all idempotent). Construction happens in customer module scope, after
  frameworks have applied their own fetch patches at runtime startup.


## Server request linking (withSpan({ request }) etc.)

Passing `request` (anything whose .headers has a get(name) method or is a
plain string-valued record) to server trackEvent/withSpan:

1. Resolve the caller's session from the request's auth tokens (TRUSTED):
   refresh_token_id + user_id. userId is derived from the session unless
   explicitly overridden.
2. Decode the x-hexclave-span-context header (UNTRUSTED labels): session
   replay/segment ids, pageViewSpanId, httpClientSpanId, customParentSpanIds.
   A header naming a different projectId is ignored wholesale.
3. Run the callback inside an AsyncLocalStorage scope carrying this context;
   everything created inside (spans, events, logs, outbound-fetch spans)
   inherits it. The client-propagated custom chain is the OUTERMOST ambient
   parent (before server global spans and enclosing server withSpan frames).

Per-item http_client_span_id (nearest-ancestor rule): a server item may name
the caller's $http-client fetch span ONLY when that fetch is its NEAREST known
ancestor — i.e. the item's ENTIRE custom parent chain came from the
propagation header. The root withSpan({ request }) span and request-level
events qualify; anything nested under a server-opened span does not (it chains
through its root span instead). Never set on $http-client or $page-view rows.

Server outbound fetch instrumentation: wraps global fetch (idempotent,
replace-keyed per project); opens $http-client spans for outgoing requests
(same keep/drop semantics; parents from the ambient request context) and
attaches the header + traceparent ONLY to the propagation origin policy —
spanPropagation.allowedOrigins plus the trusted-domain-derived defaults
(there is no self-origin server-side). The incoming request's own
httpClientSpanId is NOT forwarded on server→server hops — the new hop's span
id rides instead. Installed EAGERLY at server-app construction (register()
and first { request } use remain as idempotent redundancy). Server span.fetch
follows the same origin policy.

### Ambient request provider (zero-threading attribution)

A framework integration may register ONE ambient request provider per app
(replace semantics) via the internal instrumentation seam:
setAmbientRequestProvider(async () => RequestLike | null). Returning null
means "not inside a request scope" — a normal state, never an error.

With a provider registered, server trackEvent / withSpan / logger calls made
WITHOUT an explicit `request`, and OUTSIDE any existing { request } ALS scope,
resolve the ambient request and behave exactly as if `{ request }` had been
passed (session resolution, header decode, ALS scope). Rules:
- An existing ambient ALS scope always wins — nested calls never re-resolve.
- startSpan stays synchronous and never consults the provider.
- Failures degrade: a throwing provider or failing session resolution warns
  ONCE per app instance and falls back to context-free telemetry — a bare
  call must never fail harder than it did before ambient attribution existed.
- Next.js registers a next/headers-based provider in
  hexclaveInstrumentation().register(); the RequestLike wrapper is memoized
  per Headers instance so repeated bare calls in one request reuse the app's
  per-request-object session memoization (one token round-trip per request).


## Library span bridge (server)

The server SDK can become the process's OpenTelemetry API implementation, so
any library emitting spans through the `@opentelemetry/api` GLOBAL (Prisma via
@prisma/instrumentation, Drizzle's OTel support, Vercel AI SDK
experimental_telemetry) flows into native `$lib-span` rows — users never
configure exporters, endpoints, or collectors. Implemented as a minimal
hand-rolled TracerProvider/Tracer/Span + AsyncLocalStorage ContextManager
(NOT @opentelemetry/sdk-trace-*). `@opentelemetry/api` is imported only via
the shared package's re-export module (utils/otel-api) — the SDK package
itself takes no OTel dependency.

Registration (registerLibrarySpanBridge, exposed on the internal
instrumentation seam and called by framework register()):
- Server-only; no-op in browser-like environments and in runtimes without
  AsyncLocalStorage (node:async_hooks loaded via a bundler-opaque dynamic
  import) — without an exact async-context primitive the bridge would
  cross-parent concurrent requests.
- Claims the API globals ONLY if free: setGlobalTracerProvider first; if it
  reports failure, do NOT register the context manager either — back off
  completely with exactly ONE debug-level console message (prefix
  "Hexclave"), sticky per process. If the provider claim succeeds but the
  context-manager claim fails, ROLL BACK the provider claim (all-or-nothing —
  partial ownership mis-parents). Never clobber a user's own OTel setup.
- Idempotent per process via a Symbol.for-keyed globalThis state shared
  across bundled SDK copies; re-registration swaps the deps to the newest app
  instance (HMR replace semantics) and returns the existing provider.
- Returns { provider } (for instrumentation-class wiring) or null.

Span identity: each bridge span's native identity is a fresh uuid (minted by
the seam); its OTel SpanContext is derived from it — traceId =
uuidToW3cTraceId(uuid) (or inherited from the OTel parent for trace
coherence), spanId = uuidToW3cSpanId(uuid), traceFlags 1. A bounded registry
Map<w3cSpanId, { nativeId, parentPath }> (cap 2000, FIFO eviction) links the
two worlds; W3C ids never leave the process.

Parenting contract, resolved at startSpan time, in priority order:
(a) the explicit/active OTel context carries a span the bridge minted →
    native parent = registry entry; parent_span_ids = its stored root-first
    parentPath + [its nativeId] (arbitrary OTel nesting depth), clamped to
    the 10 NEAREST ancestors at the shared wire cap;
(b) no OTel parent → ambient Hexclave refs AT CALL TIME (enclosing withSpan
    ALS frames + the request context's client-propagated chain; synchronous
    lookups only — the async ambient request provider is never consulted);
(c) neither → project-level root (empty parents), still recorded.
options.root: true skips (a). Foreign spans (wrapped remote SpanContexts,
spans from an incompatible second api copy) miss the registry and fall
through to (b)/(c). Both lookups are AsyncLocalStorage-scoped, so resolution
is concurrency-safe; startActiveSpan runs its callback inside
context.with(setSpan(ctx, span), fn) so nesting survives awaits.

Ignored tracers: spans from tracer name "stack-tracer" (Hexclave's own
internal instrumentation — the shared traceSpan util, which wraps SDK
internals like the telemetry sender's retry wait(); recording it would let
every failed batch send mint the $lib-span that fills the NEXT batch, an
unbounded feedback loop — the bridge's counterpart of the fetch wrapper's
own-API-url exclusion and the console mirror's "Hexclave" prefix skip) and
"next.js" (framework runtime spans — middleware, RSC render pipeline,
segment/module resolution; the request layer is already modeled by the SDK's
own system spans, and dev servers emit these at flood volume) are NEVER
recorded: the bridge skips the seam entirely and returns a non-recording,
API-complete span. Children of an ignored span miss the registry and fall
through to ambient parenting (case (b)).

Row emission: the seam (beginLibrarySpan({ name, tracerName, startedAtMs,
otelParent }) → { nativeId, parentPath, end(endedAtMs, data) } | null) is
called synchronously at startSpan (freezing the batch context + parent
chain); exactly ONE complete row ships per span, at end() — never open
intervals. null (telemetry disabled / browser-like) makes the span
non-recording but API-complete. Row shape: span_type "$lib-span" (free,
$-prefixed; accepted by the batch route from server/admin auth only),
started/ended ms (end clamped >= start, integers), parent_span_ids as above,
page_view_span_id from the frozen batch context, data validated with the
same rules as custom telemetry, delivery fire-and-forget through the server
telemetry buffer.

$lib-span data shape: { ...allowlisted attributes, name, tracer_name,
kind? ("server"/"client"/"producer"/"consumer" — internal omitted),
status_code? ("ok"/"error" — unset omitted), status_message? (bounded 1KB),
dropped_event_count? (span events are dropped but counted; links dropped
silently), category }. Reserved keys always win attribute collisions.

Attribute policy (allowlist-by-shape): strings byte-bounded to 1KB
(truncateUtf8Bytes), finite numbers, booleans; primitive arrays JSON-
stringified then bounded to 1KB; everything else dropped. Keys matching
/db\.statement|db\.query\.text|sql/i are ALWAYS dropped (SQL text embeds
literal params/PII). Caps: 64 attributes per span, ~32KB total attribute
budget (keeps the row under the shared 64KB data limit). recordException
folds into exception.type/exception.message/exception.stacktrace attributes
(events are dropped, so there is no exception event). Attribute/status/name
mutations after end() are ignored; end() is idempotent (first call wins).

Category (dashboard grouping, best-effort, db checked BEFORE ai): "db" when
any `db.`-prefixed attribute key exists or the tracer name matches
/prisma|drizzle|pg|postgres|mysql|sqlite|mariadb|mssql|mongo|redis/i; "ai"
when any `gen_ai.`/`ai.`-prefixed attribute key exists or the tracer name
contains the word "ai" (word-boundary-ish — "email" must not match) or
openai/anthropic/gen_ai; else "lib".

Instrumentation-class wiring (Next.js): hexclaveInstrumentation(app,
{ instrumentations?: unknown[] }) — register() (now async; Next awaits it)
duck-type-calls .setTracerProvider(bridgeProvider) and .enable() on each
entry (exactly what @opentelemetry/instrumentation's registerInstrumentations
does; duck-typing keeps that package out of the dependency tree). Entries
missing either method are skipped with one console.warn naming the index.
When the bridge backed off, entries are still enable()d WITHOUT overriding
their provider (they resolve the user's own global).

Known limits (v1, documented in code): a second bundled @opentelemetry/api
copy with an incompatible global-registration version cannot reach the
provider (degrades to $http-client fetch spans); spans started before
register() runs are lost (mitigated by registering from instrumentation.ts).


## Framework integrations

All adapters share one factory shape: createHexclaveX(app, factoryOptions?) —
tRPC (createHexclaveTRPC), oRPC (createHexclaveORPC), Next.js
(createHexclaveNext), TanStack Start (createHexclaveTanStackStart), Elysia
(createHexclaveElysia), Convex (createHexclaveConvex). Common contracts:

- factoryOptions.unauthorized: default rejection factory for every wrapped
  surface; a per-handler/per-route `unauthorized` option always wins. HTTP
  response surfaces send a returned Response; throwing surfaces throw the
  returned Error.
- telemetry option everywhere spans are created:
  bool | { spanType?, data? }; false disables the span but still resolves the
  user and enforces `required`.
- Every wrapped handler receives BOTH `user` (the resolved caller or null) and
  `hexclave` (the per-request context: { request, getUser() } for HTTP
  adapters; { getUser() } for Convex). User resolution is lazy and memoized
  per request.
- HTTP adapters wrap handlers in withSpan(type, { request }, ...) with
  low-cardinality span types (next.route, next.server-action,
  tanstack-start.server-function, tanstack-start.route, trpc.procedure,
  orpc.procedure, elysia.route, convex.function); variable bits (path, method,
  name, kind) go in span data.

Next.js specifics (`@hexclave/next` only):
- createHexclaveNext(app, factoryOptions?) → { routeHandler, serverAction }.
- hexclaveInstrumentation(app, options?) → { register, onRequestError } for
  the customer's instrumentation.ts; options = { instrumentations?:
  unknown[] } (see "Library span bridge"). register() is ASYNC (Next awaits
  it); it installs the server outbound-fetch instrumentation + the
  uncaught-exception monitor (both idempotent/HMR-safe;
  both also self-install at app construction), registers the next/headers
  ambient request provider (see "Ambient request provider") — after register(),
  bare trackEvent/withSpan/logger calls in route handlers, server actions, and
  RSCs attribute to the caller's session with no { request } threading — AND
  registers the library span bridge (claiming the OTel API global only if
  free), then wires the instrumentations entries.
  onRequestError(error, request, context) reports a $error event
  (mechanism_type "next.onRequestError") linked to the caller's session via
  the request headers; it must never throw (warn instead). Throw at SETUP time
  if `app` is not a real HexclaveServerApp instance.
- register()/onRequestError do NOT create per-route spans — Next.js has no
  hook wrapping a route's async extent; per-route spans require the wrappers.

Elysia specifics:
- createHexclaveElysia(app, factoryOptions?) → { plugin, resolveUser,
  requireUser, requireUserWith, handler }.
- plugin: `.use()`-able; spans EVERY route (including 404s) via global
  lifecycle hooks (onRequest → onAfterResponse/onError; requires Elysia >= 1.0
  `{ as: "global" }`). The span is materialized retroactively at the terminal
  hook with startedAtMs backdated to request receipt, and records
  { path, method, status, error? }. Because hooks cannot wrap the handler's
  async extent, telemetry created inside the handler does not ambiently nest
  under a plugin span — handler() remains the full-fidelity path, and the
  plugin detects handler()-wrapped requests and skips its own span.
- factoryOptions: { unauthorized?, telemetry? } (telemetry applies to the
  plugin's spans).

Convex specifics:
- createHexclaveConvex(app, factoryOptions?) → { function: (handler,
  options?) => convexHandler }. Handler receives { ctx, args, user, hexclave }.
  Options: { required?, kind?, name?, telemetry?, unauthorized? }.
- Convex functions receive no Request (WebSockets), so spans are attributed by
  userId only ({ userId } span link) — no session-segment nesting.
