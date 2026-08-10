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
- Span identity is W3C trace context, not a bespoke scheme:
    trace id  = 32 lowercase hex chars, never all-zero
    span id   = 16 lowercase hex chars, never all-zero, unique within its trace
    parent    = a single span id, or NULL meaning "this span is the trace root"
  A span's parent_span_id must differ from its own span_id. Generate ordinary
  operation ids with fresh randomness (generateW3cTraceId / generateW3cSpanId
  in the shared analytics-wire helpers). Session lifecycle nodes are the one
  exception: their W3C ids are deterministically derived from their UUIDs so
  the browser, ingestion tier, and virtual refresh-token projection agree
  without shared state. There are NO id
  prefixes and NO ancestry arrays — a span's position in the tree is exactly
  (trace_id, span_id, parent_span_id).
  This is a deliberate interop decision: the ids Hexclave stores are byte-for-byte
  the ids a standard `traceparent` header carries, so a Hexclave trace can be
  read, joined, or continued by any OpenTelemetry-compatible tool with no
  translation layer that could disagree with ours.
- Batch ids, user ids, and the replay / segment / refresh-token correlation ids
  stay RFC 4122-shaped uuids, regex
  ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$
  (case-insensitive). Generate with crypto.randomUUID().
- A span has AT MOST ONE parent, so there is no ancestor chain and nothing to
  cap. Work that is causally related but is NOT this span's parent belongs in
  `links` (see "Parent resolution").
- $log messages: at most 8,192 UTF-8 bytes. $error messages/stacks: same cap.
  Truncation must never split a UTF-8 code point.


## Trace boundaries

An authenticated browser trace begins at the refresh-token session and keeps
the product's lifecycle hierarchy while using scalar W3C parents throughout:

    $refresh-token
      ├─ $page-view                     (before replay attribution resolves)
      └─ $session-replay                (when replay capture is enabled)
          └─ $session-replay-segment    (one per tab per replay)
              └─ later $page-view
                  ├─ $away / $offline
                  ├─ $click / $error / $log …  (events inside the page view)
                  ├─ custom withSpan / startSpan
                  └─ $http-client
                      └─ backend request span   (via `traceparent`)
                          └─ library spans (Prisma, Drizzle, AI SDK, …)

When replay capture is disabled, every `$page-view` is a direct child of
`$refresh-token`. When it is enabled, a deterministic segment id is NOT enough
to parent under: early pages remain refresh-direct until a successful replay
batch confirms that ingestion materialized the segment under the current
refresh-token trace. A stale acknowledgement for a pre-rotation segment is
ignored. The acknowledgement refreshes the session root and restarts the page
when that root changed, so a page can never combine one trace id with a segment
row materialized in another trace. Requests that do not belong to an
authenticated browser session still use the ordinary W3C boundary below.

Browser listener startup MUST NOT await refresh-token identity resolution.
Anonymous sign-up and token refresh are network operations and may be slow or
temporarily unavailable; `$click`, `$keystroke`, and `$page-view` capture must
start as soon as the analytics runtime loads. Until the authenticated root is
available, the page view uses a fresh local trace. Resolving the root (and later
materializing the replay segment) rotates the page-view span into the durable
session hierarchy without dropping capture during either transition.

A span whose `parent_span_id` is null is a root activity: a `$page-view`, a
backend request that arrived with no accepted incoming `traceparent`, or
anything started with no enclosing context at all (for example a custom span,
background job, or fetch before a browser page view exists).

Resolution order for anything else started in the browser: explicit `parent` →
nearest ambient span (global spans, enclosing `withSpan` frames) → current
`$page-view` → nothing. The page view is an ancestor of LAST RESORT
(`fallbackParent`), not a peer ambient context: when something nearer wins it is
NOT recorded as a link, because `page_view_span_id` already states that
relationship on every row.

`root: true` opts an individual call out of all of the above.

`refresh_token_id`, `session_replay_id`, `session_replay_segment_id` and
`page_view_span_id` remain scalar CORRELATION columns, so "which
session/tab/page was this?" stays a cheap equality filter even though the
corresponding lifecycle spans also form the browser trace's ancestor chain.

The root span of a trace is the span whose `parent_span_id` is null; that is the
only definition, and it is the same definition every OTel-compatible consumer
uses.


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
    replays?: { enabled?, captureKeystrokes?, maskAllInputs?, blockClass?, blockSelector? }
    integritySignals?: bool
  }

`analytics.replays.captureKeystrokes` defaults to false. When enabled alongside
session replay, the browser SDK groups `keydown` activity after 500ms of idle
time and emits a `$keystroke` event whose data contains only `count`,
`duration_ms`, `url`, and `path`. It MUST NEVER emit key values or typed text.
Targets inside the effective replay `blockClass` / `blockSelector`, the default
`rr-mask` class, password inputs, or any input masked by `maskAllInputs` are
excluded entirely so the count cannot reveal a masked value's length.

`analytics.enabled` controls custom/product events, autocapture, replays, and
integrity signals. It does not disable code instrumentation.

  observability: {
    enabled?: bool
    release?: string
    environment?: string
    traceSampleRate?: number
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
      sampleRate?: number // deprecated alias for observability.traceSampleRate
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
- observability.traceSampleRate (and the deprecated network.sampleRate alias)
  must be a number in [0, 1]. If both are present, they must be equal.


## Batch wire format

One batch per flush. Body (JSON):

  {
    schema_version: 3,          // versions the envelope+row shapes
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
    schema_version: 3,
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
service.name rejects the entire v3 batch. Never infer a value during ingestion
and never place such rows into an "unknown" or generic service bucket.

EventItem:
  {
    event_type: string,               // custom name or system "$..." type
    event_at_ms: number,
    data: object,
    trace_id?: 32hex,                 // the trace the enclosing span belongs to
    span_id?: 16hex,                  // the ENCLOSING span (an event is an instant
                                      // INSIDE a span, never a node in the tree)
    page_view_span_id?: 16hex,        // the $page-view span this item happened on
    // $log items only (route-enforced: required on $log, forbidden elsewhere):
    message?: string,
    level?: "trace" | "debug" | "info" | "warn" | "error",
  }

trace_id and span_id are set together or not at all: an event with no enclosing
span carries neither.

In a BROWSER the current `$page-view` span is the enclosing span of last resort
(see "Trace boundaries"), so a bare trackEvent, a console/logger line and every
auto-captured event ($click, $form-submit, $error, the integrity signals, …) all
carry the page view's (trace_id, span_id). This matters more for events than for
spans: an event is reachable ONLY through its trace_id, since `page_view_span_id`
is a correlation column, so without it a session's entire click/error/log stream
belonged to no trace and could not be reached from one.

Auto-captured events take the page view DIRECTLY rather than through ambient
resolution — they fire from DOM listeners, where whatever `withSpan` frame
happens to be open elsewhere on the page is not the operation the user's click
belongs to. Events recorded before the tab's first $page-view span (the pre-load
window) or under `root: true` still carry no trace.

SpanRow (versioned upsert; the row with the highest updated_at_ms per span_id
wins server-side):
  {
    trace_id: 32hex,                  // required
    span_id: 16hex,                   // required, unique within the trace
    parent_span_id: 16hex | null,     // null = this span IS the trace root
    span_type: string,
    started_at_ms: number,
    ended_at_ms: number | null,       // null = still-open interval
    data: object,                     // the FULL accumulated data, re-sent every row
    updated_at_ms: number,            // per-span monotonic: max(Date.now(), last+1)
    page_view_span_id?: 16hex,        // frozen at span creation; never on $page-view rows
    links?: [{ trace_id: 32hex, span_id: 16hex }, ...],  // non-hierarchical refs
  }

Route-side validation of every span/event item: the 32/16-hex shapes above,
all-zero ids rejected, parent_span_id !== span_id, and page_view_span_id !==
span_id (a span cannot be its own page view). There is no cross-item ancestry
check to run any more — a scalar parent is either well-shaped or it isn't.

Ids on the wire are the FINAL ids: what the SDK generates is what the dashboard
and any external OTel-compatible consumer sees. The ingestion route never
rewrites, prefixes, or namespaces them.

`page_view_span_id`, `session_replay_id`, `session_replay_segment_id` and
`refresh_token_id` remain correlation columns for direct filtering. The same
lifecycle is also represented structurally: `default.spans` projects the
synced refresh token as `$refresh-token`, and the replay batch route writes
`$session-replay` and `$session-replay-segment` rows. Their ids and immediate
parents must match the deterministic UUID-to-W3C mapping used by the browser's
page-view parent. The browser may use the segment as a scalar parent only after
that replay write has returned successfully for the same tab segment.

Buffering/flush:
- Browser: buffer and flush every ~10 seconds, or sooner when the buffer fills;
  keepalive flush on tab hide/unload. Span updates within one flush window
  coalesce to one row per span id (latest wins; superseded rows' promise
  settlers ride along and settle with the shipped batch). Non-keepalive
  analytics and replay bodies use gzip only when the JSON is at least 1 KiB and
  compression makes it smaller; keepalive bodies stay plain JSON so dispatch
  is not delayed by asynchronous compression during page teardown.
- Server: coalesce per (userId + request-context) batch key and flush after a
  short non-blocking window (100 ms at full capture; 1 second when
  traceSampleRate < 1, so a busy sampled producer cannot still issue ten mostly
  empty collector requests per second). At full capture, flush immediately at
  400 buffered items. With sampling enabled, buffer up to 4,000 raw items so
  the sampling window is not defeated by the wire-size threshold; after trace
  selection and promotion, split retained rows into batches of at most 400.
  Run the collector POST in a telemetry-suppressed context detached from the
  trace being exported. A framework-created non-recording delivery span MUST
  carry sampled=0: inheriting and propagating sampled=1 to the analytics batch
  endpoint makes that endpoint trace its own collector work and bypass the
  receiver's local trace sample rate recursively.
  The delivery queue permits at most 8 active requests and 256 queued batches /
  8 MiB. No request handler awaits telemetry delivery:
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

Trace sampling is a PRE-TRANSPORT flush policy, shared by browser and server:

- `observability.traceSampleRate` defaults to 1. The deprecated
  `network.sampleRate` field is only an alias for this trace-wide setting; it
  MUST NOT cause an independent network-span random draw.
- The head decision is deterministic from the trace id, so every row/upsert and
  every SDK process that uses the same rate reaches the same result.
- Apply that decision only after the environment buffer has coalesced its
  complete flush snapshot. Group events and spans by `trace_id`; keep or drop
  the group as one unit. Events without a trace are outside trace sampling and
  are always retained.
- Promote a head-dropped trace group when the snapshot contains `$error`, an
  error-level `$log`, an error marker, a failed HTTP/status value, or a span at
  least 3 seconds long. Promotion keeps EVERY event/span from that trace in the
  snapshot, including healthy ancestors and siblings.
- When sampling removes every item, resolve its public settlers locally and do
  not construct or send an analytics batch request. Sampling is a successful
  delivery-policy decision, not a transport failure callers should retry.
- Retain the latest row of a sampled-out OPEN span locally without its already
  resolved settler. If a later flush promotes that trace, the live root/page
  ancestor is still available; completed healthy rows are not retained across
  flushes. Cap retained browser rows at the live-span soft cap and retained
  server contexts at the delivery-queue context cap, so never-ended spans
  cannot turn tail promotion into an unbounded memory registry.


## trackEvent(eventType, data?, options?)

Buffers one EventItem. Returns a promise that resolves when the batch carrying
the event is acknowledged and rejects (pre-caught, so fire-and-forget is safe)
on invalid input, disabled/unavailable analytics, or definitive send failure.

TrackOptions:
  parent: ParentRef?           - the ONE span this item belongs under; overrides
                                 ambient context entirely (see "Parent resolution")
  root: bool?                  - drop the AMBIENT parent: start a new trace

Events do not accept `links`: OpenTelemetry links are owned by spans.

Server-side additionally:
  userId: uuid?    - explicit attribution (validated as uuid)
  request: RequestLike? - resolve attribution, the caller's trace, and the
    session correlation ids from an incoming request (see "Server request
    linking")


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
- Logs carry the same enclosing context as events, including the browser
  $page-view fallback (see EventItem): the enclosing span's (trace_id, span_id)
  from global spans / enclosing withSpan frames, else the current page view;
  the page view is stamped as a correlation column either way. Server logs inside a
  withSpan({ request }) scope join the CALLER'S TRACE, because the incoming
  `traceparent` gave that scope its trace id.
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
not pull the analytics runtime onto the critical path). They queue — with the
enclosing span context and timestamp captured at call time — in a 100-item ring
buffer (overflow drops the OLDEST), drained through the normal adoption path
(generation-checked, so a sign-out in between drops them) when the
idle-scheduled load completes. origin:"logger" items keep the load-triggering
fast path of custom events.


## startSpan(spanType, options?) / the Span handle

StartSpanOptions: TrackOptions & { data?, startedAtMs?, links? }
  = { data?, startedAtMs?, parent?, root?, links? }
(server-side additionally userId?).

Behavior:
- Validate spanType/data/startedAtMs; invalid input THROWS synchronously with
  the same messages in every environment.
- The span's open interval row (ended_at_ms: null) is enqueued immediately, so
  a span that is never ended still shows up as an open interval.
- setData(data): shallow-merge and re-write (validation applies to the merged
  result). end(options?): idempotent; endedAtMs must be an integer >= start.
- Handle members: traceId, spanId, spanType, isEnded, setData, end, trackEvent,
  startSpan, withSpan, run, spanContext(), getSpanPropagationHeaders(), fetch().
  spanContext() returns the serializable { traceId, spanId } identity — the one
  currency of span identity across every tier and boundary. It survives JSON
  (page props, headers, a job payload), and unlike a bare span id it is globally
  meaningful, because a span id only identifies a span WITHIN its trace. That is
  exactly why there is no bare-string ParentRef.

Inert spans (environment unavailability, NOT invalid input): when a CLIENT app
is used where telemetry cannot exist at all — e.g. server-side rendering /
non-browser — startSpan returns an INERT span instead of throwing, so
isomorphic code needs no environment branches:
- Input validation still throws exactly like the real path (malformed data,
  endedAtMs before start, setData after end, invalid child input).
- Lifecycle methods resolve immediately and never emit a row; trackEvent on
  the inert handle RESOLVES (knowingly dropped); spanContext() returns the
  { traceId, spanId } the span would have had; getSpanPropagationHeaders()
  returns {}; fetch() passes through to global fetch.
(Note: app.trackEvent in the same environment REJECTS instead — an event has
no handle to be inert through.)

## withSpan(spanType, optionsOrFn, fn?)

Starts the span, runs fn with the span as an ambient parent for everything
created inside (AsyncLocalStorage-exact on servers; synchronous-window-only in
browsers), ends it when fn settles. On throw: setData({ error: message }) then
end, then rethrow. Telemetry acks never block fn's result.

## setGlobalSpan(span) / clearGlobalSpan(span)

Registers/unregisters a span as an ambient parent for all subsequently tracked
items. Ending a span auto-unregisters it. Ambient contexts are ordered
OUTERMOST-FIRST; a span has exactly one parent, so the resolver takes the LAST
(innermost) one as the parent rather than merging them (see below).

## Parent resolution

  SpanContext = { traceId: string, spanId: string }
  ParentRef   = SpanContext | Span

There is deliberately NO bare-string ParentRef: a span id alone does not
identify a span, because span ids are only unique within a trace. Anything you
can hand the SDK as a parent therefore carries its trace id with it.

  resolveSpanParent({ explicit?, ambient?, links?, root? })
    -> { traceId, parentSpanId: string | null, links: SpanContext[] }
     | { error }

Resolution order:
1. `explicit` (the `parent` option) wins outright — a span has one parent, so an
   explicit parent is never merged with, or reconciled against, the enclosing
   scope. It is normalized via `spanContext()` when it is a live handle.
2. Otherwise, if `root` is not true, the LAST entry of `ambient` (the innermost
   enclosing withSpan frame / most recently registered global span) is the
   parent.
3. Otherwise there is no parent: mint a FRESH trace id and set
   `parentSpanId = null`. This is what `root: true` means, and W3C strengthens
   it — it is a genuinely new trace, not a subtree that merely forgot its
   ancestors.

The chosen parent's `traceId` becomes the new span's `traceId`; children always
live in their parent's trace.

`links` are non-hierarchical references: causally related spans that are NOT
this span's parent. Ambient contexts that belong to a DIFFERENT trace than the
chosen parent are automatically demoted to links rather than being dropped or
forced into a false parent relationship. This is the honest home for the case a
single-path model had to reject outright — a span joining two flows (a queued
message consumed inside an unrelated request, a batch job triggered by several
users' actions) records the extra flows as links and keeps exactly one parent.
Deduplicate by (traceId, spanId) and reject more than 32 links. The owner trace's
sampling decision governs whether link rows persist; linked traces are sampled
independently and a link never promotes either trace.

Any malformed context (bad hex shape, all-zero id, `parentSpanId === spanId`)
returns `{ error }` with a message naming the role ("parent", "ambient parent",
"link") — never a silently corrected id.


## Cross-tier propagation (traceparent + x-hexclave-span-context)

Two headers with strictly separated jobs:

- `traceparent` (W3C standard) is the ONE hierarchy carrier. It, and only it,
  tells the receiver which trace to join and which span to nest under.
- `x-hexclave-span-context` carries only NON-HIERARCHICAL correlation that W3C
  has no field for.

Splitting them this way is what buys interop: the hierarchy travels in the
standard header every OTel-compatible service and collector already understands,
so a Hexclave-instrumented frontend and a non-Hexclave backend (or vice versa)
still end up in one trace, and Hexclave's own extras degrade to a header the
other side simply ignores.

### traceparent

Value: "00-<32hex traceId>-<16hex spanId>-<flags>" for the `$http-client` span
opened for this request.

It is emitted only when the `$http-client` span is guaranteed to be stored.
Tentatively kept spans and pre-load spans that can be discarded MUST NOT be
advertised as remote parents. If one of those requests reaches a Hexclave
backend, the backend starts a fresh root trace instead of storing a reference to
a parent that may never exist. Emitted client contexts always carry sampled
flags `01`.

An explicitly caller-set `traceparent` is never overwritten.

### x-hexclave-span-context (header codec)

Header name: x-hexclave-span-context
Value: "v1." + base64url(JSON.stringify(payload)) where payload is:

  {
    projectId: string,                 // required
    sessionReplayId?: uuid,
    sessionReplaySegmentId?: uuid,
    pageViewSpanId?: 16hex,            // the sender's current $page-view span
  }

Nothing in this payload is ancestry. The replay/segment ids are database uuids,
and `pageViewSpanId` names which page the user was on — a grouping question, not
a parent question. The receiver stamps them onto its own rows as scalar
correlation columns.

`projectId` does double duty, and the second job is why the header rides even
with no correlation ids to carry. `traceparent` names a span id but not a
project, and a project only ever reads its own rows — so a receiver that inherits
a parent from a caller whose telemetry lives elsewhere writes a row that is
neither a child (nothing in this project has that span id) nor a root, and it
disappears from every traces view. A receiver must therefore treat the incoming
`traceparent` as HIERARCHY only when the span-context header claims the same
project; otherwise it keeps the incoming trace_id — so the two tiers still
correlate, including with external OTel tooling — and roots its own span.

Decode rules (receiver): null for missing/oversized (> 4096 chars)/wrong
version/undecodable/structurally invalid values — a bad header must never
throw into the request path. Individually invalid id fields are dropped, not
fatal. A payload whose `projectId` does not match the receiving app's project is
ignored WHOLESALE. All ids in the header are CLIENT-CONTROLLED labels: fine for
telemetry, never for authz/billing/security.

### When the headers ride (browser)

The SDK wraps global fetch AND patches XMLHttpRequest
(open/send/setRequestHeader on the prototype), idempotently via globalThis
markers with a provider registry (HMR / multiple apps share one wrapper).
On uninstall, restore each XHR prototype method only when that slot is still
the SDK's wrapper; never overwrite instrumentation installed later.

`traceparent` rides only when instrumentation opened a guaranteed-stored
`$http-client` span and the origin policy below allows it. Correlation context
may still ride without `traceparent`.

Attach `x-hexclave-span-context` when ALL of:
- spanPropagation.enabled !== false and there is something to say — either a
  correlation id OR a `traceparent` riding along, whose project claim it is (see
  the codec section). The bare-projectId case is not academic: it covers the
  pre-page-view boot window, which is when a browser makes its auth requests;
- target is http(s) and same-origin OR in the propagation origin policy: the
  union of spanPropagation.allowedOrigins and (unless useTrustedDomains is
  false) the trusted-domain-derived origins, all exact origin matches — plus
  localhost/loopback targets (any port) when the project allows localhost;
- the request is not mode: "no-cors" (fetch);
- the caller did NOT set the header themselves (caller intent always wins);
- across ALL registered providers there is exactly ONE candidate header value
  (ambiguous multi-project same-origin requests fail closed).

Both header values go through the SAME gate: the origin policy above (both leak
information about the caller, so neither escapes it) AND the single-candidate
rule. Two registered providers wanting to attach different traces means the
request goes out with NEITHER header — fail closed rather than join an arbitrary
trace.

### Manual propagation

app.getSpanPropagationHeaders(options?: { parent?, root? }) [client]
  Returns the propagation headers — `traceparent` for the resolved span plus
  `x-hexclave-span-context` — carrying the same context an item tracked right
  now would get, or {} when there is nothing to propagate. For transports the
  SDK cannot instrument (sendBeacon, WebSocket handshakes, manually-built
  requests).

span.getSpanPropagationHeaders()
  Same, but pinned to exactly this span. For a sampled trace, `traceparent`
  names this span's { traceId, spanId }, so the receiving backend span becomes
  its direct child with no ambient-context ambiguity. For a head-dropped or
  pre-load span, returns correlation only.

span.fetch(input, init?)
  fetch with the propagation headers pinned to this span. Browser: follows the
  same same-origin/allowedOrigins policy as the automatic wrapper and never
  overwrites explicitly-set headers. SERVER: fails closed — there is no
  self-origin, so no headers are attached; use getSpanPropagationHeaders()
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
- propagated: 1 means this span's context actually rode the outgoing headers, so
  the backend work for this request is in the same trace.
- End the span when response HEADERS arrive (never the body stream) or the
  request settles with an error. XHR: end on loadend; status 0 = errored.
- Aborted requests are NOT failures (SPA data layers cancel routinely).

Sampling / keep-drop state machine:
- `traceSampleRate` makes one deterministic head decision from the trace id,
  shared by browser/server propagation and flush. Sampling is therefore
  trace-wide, not a separate random draw per network span.
- `capture == "all"` writes the open `$http-client` row immediately. It
  propagates `traceparent` with flags `01` only when the whole trace is
  head-sampled and the row is already owned by a live delivery buffer.
- `capture == "errors-only"` writes NO row until end time, then keeps it only
  if the outcome is in the ALWAYS-KEEP class:
    status >= 400, OR network error (errored && !aborted), OR duration >= 3s.
  Dropped maybe-keep spans are never written at all.
- At flush, a failed/slow span or error event promotes the complete trace group
  present in that flush, regardless of `traceSampleRate`. A head-dropped,
  errors-only, or pre-load span does not propagate `traceparent`, because it
  cannot promise that the named parent will be stored. If it is later promoted,
  its local span remains useful but the backend request is a separate root
  trace.
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
   explicitly overridden. refresh_token_id is also the identity from which an
   authenticated browser trace's root W3C context is derived.
2. Parse the incoming `traceparent` (UNTRUSTED, but this is the only hierarchy
   input). Accept it only when `x-hexclave-span-context` contains the same
   project id and its sampled flag is `01`; then its trace id becomes the trace
   of everything recorded in this scope and its span id becomes the parent of
   the scope's root span. Without both guarantees, this request IS a root
   activity: mint a fresh trace id and give the scope's root span
   `parent_span_id = null`.
3. Decode the x-hexclave-span-context header (UNTRUSTED labels): session
   replay/segment ids and pageViewSpanId, all stamped as scalar correlation
   columns. A header naming a different projectId is ignored wholesale. This
   header contributes NO ancestry.
4. Run the callback inside an AsyncLocalStorage scope carrying this context;
   everything created inside (spans, events, logs, outbound-fetch spans)
   inherits the trace id and nests under the scope's root span.

Because the hierarchy arrives as a single (trace id, parent span id) pair, there
is no per-item ancestry decision to make: only the scope's root span uses the
incoming span id as its parent, and everything deeper parents to its own
enclosing span in the ordinary way.

Server outbound fetch instrumentation: wraps global fetch (idempotent,
replace-keyed per project); opens $http-client spans for outgoing requests
(same keep/drop semantics; parented by the enclosing span of the ambient request
context, in the request's trace) and attaches `traceparent` +
x-hexclave-span-context ONLY to the propagation origin policy —
spanPropagation.allowedOrigins plus the trusted-domain-derived defaults
(there is no self-origin server-side). On a server→server hop the outgoing
`traceparent` names the NEW hop's own `$http-client` span (in the same trace),
never the incoming one — that is what makes the multi-hop chain a real tree
rather than a fan of siblings. Installed EAGERLY at server-app construction
(register() and first { request } use remain as idempotent redundancy). Server
span.fetch follows the same origin policy.

Server delivery coalesces at most 400 items per batch and permits at most 32
batch requests in flight per app instance. When the collector is slow or
unavailable, a batch beyond that limit is dropped: its returned telemetry
promises reject and one warning is emitted for the overload episode. Delivery
must never open unbounded sockets or queue unbounded payloads in the host
application. Every collector delivery runs inside the hidden bridge's exact
telemetry-suppression context when that bridge is registered. Consequently the
Next/undici spans opened by the collector POST neither inherit the request being
exported nor emit another batch; runtimes where the bridge backed off still
send normally.

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
experimental_telemetry) flows into native operation-named rows with the OTel
tracer in `scope_name` — users never configure exporters, endpoints, or
collectors. Implemented as a minimal
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

Span identity: a bridge span's Hexclave identity and its OTel SpanContext are
THE SAME PAIR of ids. { traceId, spanId } is minted once, W3C-shaped, and used
verbatim both on the Hexclave wire and through the `@opentelemetry/api` surface —
there is no second id space and therefore no id-translation table. traceFlags is
1. An auto-instrumented library operation and a `withSpan` span are the same
kind of node in the same tree; `scope_name` distinguishes their authorship.

The bridge still keeps ONE bounded Map<w3cSpanId, { traceId, recordedSpanId }>
(cap 2000, FIFO eviction), but its job is no longer translation: it maps a span
the bridge minted to its NEAREST RECORDED ANCESTOR. See "Phantom skipping" below
— that is the entire reason the map exists.

Parenting contract, resolved at startSpan time, in priority order:
(a) the active/explicit OTel context names a span the bridge minted (registry
    HIT) → the bridge passes that registry entry down as `otelParent`. Arbitrary
    OTel nesting depth needs no path bookkeeping, because each level only ever
    names one parent.
      - `recordedSpanId` non-null → trace_id = entry.traceId,
        parent_span_id = entry.recordedSpanId.
      - `recordedSpanId` null → join entry.traceId as a ROOT
        (parent_span_id = null). It NEVER means "parent under the phantom".
(b) registry MISS, or no OTel parent at all → resolve from the ambient Hexclave
    context AT CALL TIME (innermost enclosing withSpan ALS frame, the server
    global-span registry, or the trace the request scope adopted from its
    incoming `traceparent`; synchronous lookups only — the async ambient request
    provider is never consulted). Foreign spans (wrapped remote SpanContexts,
    spans from an incompatible second api copy) miss the registry and land here.
(c) neither → trace root: fresh trace_id, parent_span_id = null, still recorded.
options.root: true skips (a) and (b). Ambient lookups are
AsyncLocalStorage-scoped, so resolution is concurrency-safe; startActiveSpan runs
its callback inside context.with(setSpan(ctx, span), fn) so nesting survives
awaits.

Cases (b) and (c) are decided INSIDE the seam, not in the bridge: they need app
state the bridge cannot reach (the global-span registry, the withSpan ALS frames,
and the trace the request scope adopted). So the bridge passes only what it knows
— `otelParent`, or null — and the seam returns the resolved identity. A bridge
that had to supply trace_id/parent_span_id itself could only ever implement (a).

Ignored span: only `STACK: wait(...)` from tracer name `stack-tracer`. That
operation wraps the telemetry sender's retry delay; recording it would let
every failed batch mint the row that fills the NEXT batch, an unbounded
feedback loop. Other `stack-tracer` spans MUST be recorded because they are the
backend's request/validation/route hierarchy. Next.js runtime spans and every
Prisma phase (including compile and serialize) are recorded with their exact
nesting. An ignored span remains API-complete and forwards its nearest recorded
ancestor to children, so it can never become a phantom parent.

### Phantom skipping (why the registry exists)

A non-recording span — one rejected by the capture policy, or any span
minted while the seam returned null — is API-complete but writes NO ROW, while
its children DO write rows. A child must therefore never name such a phantom as
its `parent_span_id`: the row it points at does not exist. Under a scalar parent
that silently detaches the whole subtree, and the subtree does not resurface as a
root either — the trace inbox fires on `parent_span_id IS NULL`, and an orphan's
parent is non-null. The failure mode is INVISIBLE DATA LOSS, so the registry
stores the nearest RECORDED ancestor rather than the immediate one:

- a RECORDING span registers { traceId, recordedSpanId: <its own span id> };
- a NON-RECORDING span WITH a registered parent re-registers that parent's
  `recordedSpanId` under its own span id, so a later lookup transparently skips
  the phantom;
- a NON-RECORDING span with NO registered parent is deliberately NOT registered
  at all, so its children take case (b) and resolve from ambient context. This is
  what keeps a Prisma span nested under the Hexclave request context even though
  the Next.js render span between them is never recorded.

### The API-only context of a non-recording span

A non-recording span (`handle === null`: capture-policy rejection, or the
seam declining) still needs a spec-valid SpanContext, because library code holds
the OTel `Span` object and may propagate it. The bridge mints one locally:

  traceId = handle?.traceId ?? otelParent?.traceId ?? generateW3cTraceId()
  spanId  = handle?.spanId  ?? generateW3cSpanId()
  traceFlags = 1

So a non-recording span inherits `otelParent.traceId` when a registered OTel
parent exists — keeping the trace coherent across the gap — and mints a fresh
trace id when there is none. Minting is CORRECT here rather than a leak: there is
no trace to inherit, and the alternative (an absent or all-zero id) is what would
actually break a library propagating the context, because an all-zero id is
invalid per the W3C spec and looks joinable while matching nothing. Neither
generator can return an all-zero id — both loop until non-zero.

The minted context is API-ONLY, and that is what makes it safe: nothing is stored
under those ids, and no child ever names them as a `parent_span_id`, because the
registry's nearest-recorded-ancestor rule above routes children past the phantom.
A minted context can therefore never produce a `parent_span_id` pointing at a row
that does not exist. `spanId` is always freshly minted, never inherited.

### Row emission

The seam is:

  beginLibrarySpan({ name, tracerName, startedAtMs, otelParent }) → handle | null

  otelParent: { traceId: string, recordedSpanId: string | null } | null
              // non-null = case (a); null defers resolution to the seam
  handle:     { traceId: string, spanId: string,
                end(endedAtMs, data): void }

It is called synchronously at startSpan (freezing the batch context and the
resolved identity); exactly ONE complete row ships per span, at end() — never
open intervals. The returned traceId/spanId ARE the span's OTel SpanContext, so
the seam's resolution is what OTel children see too. Row shape: `span_type` is
the library operation normalized to the custom span-name contract (the exact
original remains in `data.name`), and `scope_name` is the bounded OTel tracer
name. A non-null scope is accepted from server/admin auth only and keeps the
automatic span free. Then started/ended ms (end clamped >= start, integers),
trace_id/span_id/parent_span_id as resolved above, page_view_span_id from the
frozen batch context, data validated with the same rules as custom telemetry,
delivery fire-and-forget through the server telemetry buffer.

Library-span data shape: { ...allowlisted attributes, name, tracer_name,
kind? ("server"/"client"/"producer"/"consumer" — internal omitted),
status_code? ("ok"/"error" — unset omitted), status_message? (bounded 1KB),
dropped_event_count? (span events are dropped but counted), category }.
Reserved keys always win attribute collisions. Valid OTel creation-time links
and late addLink/addLinks calls are deduplicated, capped at 32, and emitted on
the final span row; link attributes are currently dropped.

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
{ instrumentations?: unknown[], requestAttribution?: boolean,
isTelemetrySuppressed?: () => boolean }) — register()
(now async; Next awaits it)
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
- hexclaveInstrumentation(app, options?) →
  { register, onRequestError, runWithTelemetrySuppressed } for
  the customer's instrumentation.ts; options = { instrumentations?:
  unknown[], requestAttribution?: boolean,
  isTelemetrySuppressed?: () => boolean } (see "Library span bridge").
  requestAttribution defaults true; false is for control planes whose incoming
  customer requests must not be resolved against a separate internal telemetry
  project. isTelemetrySuppressed is an advanced collector/control-plane hook:
  when it returns true, automatic SDK-native fetch, library, log, and error
  capture is suppressed alongside the runtime's instrumentations. register()
  is ASYNC. runWithTelemetrySuppressed(asyncCallback) is the stronger
  collector/control-plane boundary: it runs the callback inside the hidden
  library-span bridge's exact async context and suppresses SDK-native fetch,
  library, log, and error capture for its full async extent. It throws when
  called before register() successfully claims the bridge. Next awaits the
  async register(); it installs the server outbound-fetch instrumentation + the
  uncaught-exception monitor (both idempotent/HMR-safe;
  both also self-install at app construction), registers the next/headers
  ambient request provider (see "Ambient request provider") — after register(),
  bare trackEvent/withSpan/logger calls in route handlers, server actions, and
  RSCs attribute to the caller's session with no { request } threading — AND
  registers the library span bridge (claiming the OTel API global only if
  free), then wires the instrumentations entries.
  onRequestError(error, request, context) reports a $error event
  (mechanism_type "next.onRequestError") linked to the caller's session via
  the request headers when requestAttribution is enabled, and records it
  without caller attribution otherwise; it must never throw (warn instead).
  Throw at SETUP time if `app` is not a real HexclaveServerApp instance.
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
