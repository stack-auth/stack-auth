import type { DebugImage } from "@hexclave/shared/dist/utils/analytics-wire";
import { getDebugImagesForStack } from "./debug-ids";
import type { CapturedExceptionValue, CaptureEvent, ErrorEventId, ErrorScopeData, ErrorStackFrame } from "../interfaces/error-capture";
import type { ErrorCaptureOptions } from "./observability-config";
import { truncateUtf8Bytes } from "./telemetry-core";
import { generateUuid } from "./telemetry-transport";
import { getActiveErrorScope, mergeErrorScopeData } from "./error-scope";
import { MAX_ERROR_PROCESSORS } from "./error-processors";
import type { CapturedErrorEvent, ErrorEventProcessor } from "../interfaces/error-capture";

/**
 * Global error capture (`$error` events), functional-style like web-vitals.ts.
 *
 * The recipe follows sentry-javascript (v9/v10) where its decisions matter:
 * the window.onerror / onunhandledrejection PROPERTY slots are patched (never
 * addEventListener — the property handler is what frameworks chain through,
 * and forwarding its return value preserves "suppress default logging"
 * semantics), rejection reasons are extracted 3-way (primitive → `.reason` →
 * `.detail.reason`), non-Error throws get a synthesized message + `synthetic`
 * marker, and a captured-marker plus an ignore-next counter prevent
 * double-capture and recursion.
 *
 * What we deliberately do NOT do (unlike Sentry): no client-side stack
 * PARSING into frames and no sourcemapping — the raw (bounded) stack string
 * ships and grouping stays server-side; no allowUrls/denyUrls filtering
 * (`ignoreErrors` substring matching covers the current need); and no
 * replay-on-error buffered flush.
 */

// Mirrors the `$log` message cap (TELEMETRY_MAX_LOG_MESSAGE_BYTES): big enough for
// real stacks, small enough that one error cannot crowd out the 64KB
// item-data budget. Shared by the client capture below and the server-side
// _captureServerRequestError path.
export const ERROR_TEXT_MAX_BYTES = 8_192;

/** Sentry/Relay-compatible event identity: lowercase hexadecimal, no dashes. */
export function generateErrorEventId(): ErrorEventId {
  return generateUuid().replace(/-/g, "");
}

// First ~50 frames are plenty for grouping/debugging; raising V8's default 10
// at install time is what makes the "first 50 frames" of the raw stack exist
// at all.
const ERROR_STACK_TRACE_LIMIT = 50;

// Flood control, per $page-view (reset when the current page-view span id
// changes — see installClientErrorCapture): a broken render loop must not
// generate unbounded telemetry.
const MAX_ERRORS_PER_FINGERPRINT_PER_PAGE_VIEW = 10;
const MAX_ERRORS_PER_PAGE_VIEW = 100;

// Default local drops: "Script error" is cross-origin noise (no message, no
// stack — nothing actionable), "ResizeObserver loop" is a benign browser
// warning surfaced as an error. Substring-matched like user ignores.
export const DEFAULT_IGNORE_ERRORS = ["Script error", "ResizeObserver loop"] as const;

export type NormalizedErrorCaptureOptions = {
  enabled: boolean,
  ignoreErrors: readonly string[],
  eventProcessors?: readonly ErrorEventProcessor[],
  beforeSend?: ErrorCaptureOptions["beforeSend"],
};

export function normalizeErrorCaptureOptions(options: ErrorCaptureOptions | undefined): NormalizedErrorCaptureOptions {
  const eventProcessors = [...options?.eventProcessors ?? []];
  if (eventProcessors.length > MAX_ERROR_PROCESSORS) {
    throw new Error(`Hexclave error capture: at most ${MAX_ERROR_PROCESSORS} event processors are allowed`);
  }
  return {
    enabled: options?.enabled !== false,
    ignoreErrors: [...DEFAULT_IGNORE_ERRORS, ...options?.ignoreErrors ?? []],
    eventProcessors,
    beforeSend: options?.beforeSend,
  };
}

// Non-enumerable marker so the same error OBJECT never double-captures (e.g.
// rethrown through a boundary and surfacing at both onerror and a rejection
// handler). Non-enumerable keeps it out of JSON.stringify / for-in of user
// code that inspects the error.
const CAPTURED_MARKER = "__hexclaveCaptured__";

function isAlreadyCaptured(value: unknown): boolean {
  return typeof value === "object" && value !== null && CAPTURED_MARKER in value;
}

function markCaptured(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  try {
    Object.defineProperty(value, CAPTURED_MARKER, { value: true, enumerable: false });
  } catch {
    // Frozen/sealed error objects simply stay unmarked; the single-slot dedupe
    // below still catches the common immediate double-fire.
  }
}

function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

/**
 * djb2-xor over UTF-16 code units (same local-hash flavor the tracker uses for
 * clipboard comparison). Purely a LOCAL grouping key for flood control plus a
 * server-side grouping hint — never a security boundary.
 */
function djb2Hash(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function computeErrorFingerprint(name: string, message: string, stack: string | null): string {
  // Only the FIRST stack line participates: deeper frames differ per call path
  // for what users consider "the same error" (matches how server-side grouping
  // will bucket, and keeps the flood-control key stable across re-renders).
  const firstStackLine = stack === null ? "" : stack.split("\n").find((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("at ") || trimmed.includes("@");
  }) ?? "";
  return djb2Hash(`${name}\n${message}\n${firstStackLine}`).toString(16);
}

export type NormalizedError = {
  name: string,
  message: string,
  stack: string | null,
  synthetic: boolean,
};

/**
 * Sentry's linked-errors integration keeps the causal chain in one event and
 * places the originating error last. That ordering matters: the last value is
 * the primary group identity while the preceding values explain the cause or
 * AggregateError branch. Keep the same bounded shape here so `cause` and
 * `AggregateError.errors` are useful without allowing a malicious cyclic graph
 * to turn capture into an unbounded traversal.
 */
export const MAX_LINKED_ERROR_VALUES = 10;

function linkedErrorProperty(error: Error, key: "cause" | "errors"): unknown {
  try {
    return Reflect.get(error, key);
  } catch {
    return undefined;
  }
}

function exceptionValueFromNormalized(normalized: NormalizedError, mechanism?: CapturedExceptionValue["mechanism"]): CapturedExceptionValue {
  return {
    // The top-level compatibility fields are bounded below, but the canonical
    // exception chain is also sent through OTel as part of the same `data`
    // object. Keep both representations on the same byte budget; otherwise a
    // long raw stack would bypass the top-level cap and make the event fail the
    // shared 64 KB telemetry contract.
    type: truncateUtf8Bytes(normalized.name, ERROR_TEXT_MAX_BYTES),
    value: truncateUtf8Bytes(normalized.message, ERROR_TEXT_MAX_BYTES),
    ...normalized.stack === null ? {} : { stacktrace: { raw: truncateUtf8Bytes(normalized.stack, ERROR_TEXT_MAX_BYTES) } },
    ...mechanism === undefined ? {} : { mechanism },
  };
}

/**
 * Aggregate byte budget for one event's `exception.values` chain. Per-value
 * truncation bounds each entry, but MAX_LINKED_ERROR_VALUES entries at up to
 * ~3x ERROR_TEXT_MAX_BYTES of raw text each could still sum well past the
 * shared 64KB item-data contract (CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES) and
 * get the whole event dropped at ingest. 32KB leaves room for the bounded
 * top-level message/stack (8KB each), debug images (4KB), and typical scope
 * data, while a realistic worst-case single root value (~25KB) still fits.
 */
export const ERROR_EXCEPTION_VALUES_MAX_BYTES = 32_768;

const exceptionValueEncoder = new TextEncoder();

/**
 * Applies the same per-value byte bounds `buildLinkedExceptionValues` bakes in
 * to a CALLER-supplied value (captureEvent adapters hand us pre-built chains
 * that must not bypass the byte budget every other capture path enforces).
 * Frames are capped at the raw-stack frame budget for the same reason.
 */
function boundExceptionValue(value: CapturedExceptionValue): CapturedExceptionValue {
  const boundFrame = (frame: ErrorStackFrame): ErrorStackFrame => ({
    ...frame.filename === undefined ? {} : { filename: truncateUtf8Bytes(frame.filename, ERROR_TEXT_MAX_BYTES) },
    ...frame.abs_path === undefined ? {} : { abs_path: truncateUtf8Bytes(frame.abs_path, ERROR_TEXT_MAX_BYTES) },
    ...frame.function === undefined ? {} : { function: truncateUtf8Bytes(frame.function, ERROR_TEXT_MAX_BYTES) },
    ...frame.module === undefined ? {} : { module: truncateUtf8Bytes(frame.module, ERROR_TEXT_MAX_BYTES) },
    ...frame.lineno === undefined ? {} : { lineno: frame.lineno },
    ...frame.colno === undefined ? {} : { colno: frame.colno },
    ...frame.in_app === undefined ? {} : { in_app: frame.in_app },
    ...frame.context_line === undefined ? {} : { context_line: truncateUtf8Bytes(frame.context_line, ERROR_TEXT_MAX_BYTES) },
  });
  const boundMechanism = value.mechanism === undefined ? undefined : {
    ...value.mechanism.type === undefined ? {} : { type: truncateUtf8Bytes(value.mechanism.type, ERROR_TEXT_MAX_BYTES) },
    ...value.mechanism.handled === undefined ? {} : { handled: value.mechanism.handled },
    ...value.mechanism.data === undefined ? {} : jsonSafeMechanismData(value.mechanism.data),
  };
  const stacktrace = value.stacktrace === undefined ? undefined : {
    ...value.stacktrace.raw === undefined ? {} : { raw: truncateUtf8Bytes(value.stacktrace.raw, ERROR_TEXT_MAX_BYTES) },
    ...value.stacktrace.frames === undefined ? {} : { frames: value.stacktrace.frames.slice(0, ERROR_STACK_TRACE_LIMIT).map(boundFrame) },
  };
  return {
    ...value.type === undefined ? {} : { type: truncateUtf8Bytes(value.type, ERROR_TEXT_MAX_BYTES) },
    ...value.value === undefined ? {} : { value: truncateUtf8Bytes(value.value, ERROR_TEXT_MAX_BYTES) },
    ...boundMechanism === undefined ? {} : { mechanism: boundMechanism },
    ...stacktrace === undefined ? {} : { stacktrace },
  };
}

function jsonSafeMechanismData(data: Record<string, unknown>): { data?: Record<string, unknown> } {
  // Adapter metadata is outside the typed scalar fields and may contain a
  // cycle or BigInt. Validate it once here; dropping only that optional field
  // keeps capture synchronous and preserves the bounded exception identity.
  try {
    JSON.stringify(data);
    return { data };
  } catch {
    return {};
  }
}

/**
 * Bounds a whole exception chain: per-value truncation, the linked-value count
 * cap, and the aggregate ERROR_EXCEPTION_VALUES_MAX_BYTES budget. The LAST
 * value is the primary group identity, so trimming keeps the root plus the
 * values nearest it (its direct causes) and drops the outermost-linked entries
 * first — the same preference buildLinkedExceptionValues applies at its count
 * cap. The root always survives, even alone over budget: an over-budget event
 * beats silently losing the primary identity.
 */
function boundExceptionValues(values: readonly CapturedExceptionValue[], primaryMechanism: { type: string, handled: boolean }): CapturedExceptionValue[] {
  const bounded = values.slice(-MAX_LINKED_ERROR_VALUES).map(boundExceptionValue);
  const primaryIndex = bounded.length - 1;
  if (primaryIndex >= 0) {
    const primary = bounded[primaryIndex];
    bounded[primaryIndex] = {
      ...primary,
      mechanism: {
        ...primary.mechanism,
        type: truncateUtf8Bytes(primaryMechanism.type, ERROR_TEXT_MAX_BYTES),
        handled: primaryMechanism.handled,
      },
    };
  }
  const kept: CapturedExceptionValue[] = [];
  // Byte accounting mirrors what JSON.stringify(values) actually costs: the
  // enclosing `[]` plus one `,` between entries.
  let bytes = 2;
  for (let i = bounded.length - 1; i >= 0; i--) {
    const entryBytes = exceptionValueEncoder.encode(JSON.stringify(bounded[i])).length + (kept.length > 0 ? 1 : 0);
    if (kept.length > 0 && bytes + entryBytes > ERROR_EXCEPTION_VALUES_MAX_BYTES) break;
    bytes += entryBytes;
    kept.unshift(bounded[i]);
  }
  return kept;
}

export function buildLinkedExceptionValues(error: unknown, normalized: NormalizedError = normalizeCapturedError(error)): CapturedExceptionValue[] {
  const values: CapturedExceptionValue[] = [];
  const seen = new Set<object>();

  const visit = (candidate: unknown, source: string | null, isRoot: boolean): void => {
    if (!(candidate instanceof Error) || seen.has(candidate) || values.length >= MAX_LINKED_ERROR_VALUES) return;
    seen.add(candidate);

    const cause = linkedErrorProperty(candidate, "cause");
    if (cause instanceof Error) visit(cause, "cause", false);

    const aggregateErrors = linkedErrorProperty(candidate, "errors");
    if (Array.isArray(aggregateErrors)) {
      for (const [index, child] of aggregateErrors.entries()) {
        if (child instanceof Error) visit(child, `errors[${index}]`, false);
        if (values.length >= MAX_LINKED_ERROR_VALUES) break;
      }
    }

    const direct = isRoot ? normalized : normalizeCapturedError(candidate);
    const hasChildren = cause instanceof Error || (Array.isArray(aggregateErrors) && aggregateErrors.some((child) => child instanceof Error));
    const mechanism = source === null
      ? undefined
      : {
        type: "chained",
        handled: true,
        data: {
          source,
          ...hasChildren ? { is_exception_group: true } : {},
        },
      };
    if (values.length >= MAX_LINKED_ERROR_VALUES) {
      // Children are visited before their parent so the root can stay last.
      // If the graph is deeper than the cap, retain the newest bounded child
      // values and always keep the root identity that drives grouping.
      if (!isRoot) return;
      values.splice(0, values.length - (MAX_LINKED_ERROR_VALUES - 1));
    }
    values.push(exceptionValueFromNormalized(direct, mechanism));
  };

  if (error instanceof Error) visit(error, null, true);
  if (values.length === 0) values.push(exceptionValueFromNormalized(normalized));
  return values;
}

/**
 * Normalizes anything thrown/rejected into name/message/stack. Non-Error
 * values are marked `synthetic` and — for objects — get a stack synthesized at
 * capture time (a fresh Error here), so there is at least a capture location
 * to look at. Primitives stay stackless: a capture-site stack for a primitive
 * throw points at the SDK, which is worse than nothing.
 */
export function normalizeCapturedError(value: unknown): NormalizedError {
  if (value instanceof Error) {
    return {
      name: value.name !== "" ? value.name : "Error",
      message: value.message,
      stack: typeof value.stack === "string" ? value.stack : null,
      synthetic: false,
    };
  }
  if (isPrimitive(value)) {
    return { name: "Error", message: String(value), stack: null, synthetic: true };
  }
  // Plain object (or function): the keys are the most identifying thing we can
  // say without serializing arbitrary user data into an error message.
  const keys = Object.keys(value as object).sort();
  return {
    name: "Error",
    message: `Object captured as exception with keys: ${keys.length > 0 ? keys.join(", ") : "(none)"}`,
    stack: new Error().stack ?? null,
    synthetic: true,
  };
}

export type BuildErrorEventDataOptions = {
  /** e.g. "global.onerror", "global.unhandledrejection", "node.uncaughtexception", "next.onRequestError", "captured". */
  mechanismType: string,
  handled: boolean,
  release: string | null,
  environment: string | null,
  sdkVersion: string,
  /** Stable product event identity. Generated when omitted for automatic captures. */
  eventId?: ErrorEventId,
  /** Public scope data merged into the bounded event projection. */
  scope?: ErrorScopeData,
  /** Force the synthetic flag on (used when the CALLER already synthesized the message, e.g. primitive rejections). */
  synthetic?: boolean,
  /** Extra flat fields (filename/lineno/colno, url/path, route metadata, …). */
  extra?: Record<string, unknown>,
  /**
   * Resolves the `debug_images` for a stack (see debug-ids.ts). Injectable so
   * tests can exercise the payload without writing to `globalThis`; production
   * callers leave it unset and get the real global reader.
   */
  getDebugImages?: (stack: string | null) => DebugImage[],
  /** Canonical exception chain. Generated automatically for captureException. */
  exceptionValues?: readonly CapturedExceptionValue[],
};

/**
 * The `$error` event's `data` payload, shared by every capture path (browser
 * globals, Node monitor, Next.js onRequestError). Mechanism info is FLATTENED
 * into `mechanism_type` / `handled` / `synthetic` scalars rather than a nested
 * `mechanism` object: the ClickHouse events table stores `data` as JSON and
 * flat scalars keep `data.mechanism_type = '...'`-style filters trivial (and
 * match how every other system event exposes its fields). `synthetic` is
 * present-when-set (like the tracker's `rage`/`dead` flags) so filters stay
 * cheap.
 */
export function buildErrorEventData(error: unknown, options: BuildErrorEventDataOptions): CapturedErrorEvent {
  const normalized = normalizeCapturedError(error);
  return buildErrorEventDataFromNormalized(normalized, {
    ...options,
    exceptionValues: buildLinkedExceptionValues(error, normalized),
  });
}

// Split from buildErrorEventData so client capture paths — which already
// normalized the error for dedupe/flood-control (see
// createClientErrorCapturePolicy) — never normalize twice:
// normalizeCapturedError synthesizes a fresh capture-site stack for plain
// objects, so a second call would produce a DIFFERENT stack (and fingerprint)
// than the one the dedupe logic compared. Exported for consumers of the
// policy's admission result (console.error promotion in client-analytics.ts).
export function buildErrorEventDataFromNormalized(normalized: NormalizedError, options: BuildErrorEventDataOptions): CapturedErrorEvent {
  const message = truncateUtf8Bytes(normalized.message, ERROR_TEXT_MAX_BYTES);
  const stack = normalized.stack !== null ? truncateUtf8Bytes(normalized.stack, ERROR_TEXT_MAX_BYTES) : null;
  // Resolved from the TRUNCATED stack on purpose: symbolication joins debug
  // images onto the frames parsed out of the stack that actually shipped, so an
  // image for a frame that got truncated away would never be used.
  const debugImages = (options.getDebugImages ?? getDebugImagesForStack)(stack);
  // Bounded at the single choke point every capture path funnels through, so
  // neither a deep automatic cause chain nor an adapter-supplied chain can
  // push the event past the shared item-data budget.
  const exceptionValues = boundExceptionValues(options.exceptionValues ?? [exceptionValueFromNormalized(normalized)], {
    type: options.mechanismType,
    handled: options.handled,
  });
  return {
    event_id: options.eventId ?? generateErrorEventId(),
    message,
    name: normalized.name,
    ...stack !== null ? { stack } : {},
    ...debugImages.length > 0 ? { debug_images: debugImages } : {},
    mechanism_type: options.mechanismType,
    handled: options.handled,
    ...normalized.synthetic || options.synthetic === true ? { synthetic: 1 } : {},
    exception: { values: exceptionValues },
    // Fingerprint over the UNTRUNCATED inputs would differ from what a reader
    // can recompute from the row, so hash the bounded values.
    fingerprint: computeErrorFingerprint(normalized.name, message, stack),
    ...options.release !== null ? { release: options.release } : {},
    ...options.environment !== null ? { environment: options.environment } : {},
    sdk_version: options.sdkVersion,
    ...errorScopeToEventData(options.scope),
    ...options.extra ?? {},
  };
}

function errorScopeToEventData(scope: ErrorScopeData | undefined): Record<string, unknown> {
  if (scope === undefined) return {};
  return {
    ...scope.user === undefined ? {} : { user: scope.user },
    ...scope.tags === undefined ? {} : { tags: scope.tags },
    ...scope.contexts === undefined ? {} : { contexts: scope.contexts },
    ...scope.extra === undefined ? {} : { extra: scope.extra },
    ...scope.breadcrumbs === undefined ? {} : { breadcrumbs: scope.breadcrumbs },
    ...scope.level === undefined ? {} : { level: scope.level },
    // Processors are execution policy, not event data. They are passed to the
    // pipeline from the capture-time scope snapshot and never serialized.
    // The SDK event's local `fingerprint` is a client dedup key; grouping
    // reads `fingerprint_override`.
    ...scope.fingerprint === undefined ? {} : { fingerprint_override: scope.fingerprint },
  };
}

function renderStackFrames(frames: readonly ErrorStackFrame[] | undefined): string | null {
  if (frames === undefined || frames.length === 0) return null;
  const lines = frames.map((frame) => {
    const functionName = frame.function ?? "?";
    const filename = frame.abs_path ?? frame.filename ?? "<unknown>";
    const location = frame.lineno === undefined
      ? filename
      : `${filename}:${frame.lineno}${frame.colno === undefined ? "" : `:${frame.colno}`}`;
    return `    at ${functionName} (${location})`;
  });
  return lines.join("\n");
}

/**
 * Adapts a normalized event input onto the existing `$error` projection. The
 * exception chain is retained under `exception`; name/message/stack remain at
 * the top level because backend grouping reads those fields directly.
 */
export function buildCapturedEventData(event: CaptureEvent, options: {
  eventId: ErrorEventId,
  release: string | null,
  environment: string | null,
  sdkVersion: string,
  scope?: ErrorScopeData,
}): CapturedErrorEvent {
  const exception = event.exception?.values.at(-1);
  const name = event.name ?? exception?.type ?? "Error";
  const message = event.message ?? exception?.value ?? "";
  if (message === "") throw new Error("Hexclave captureEvent requires message or exception.values[].value");
  // `raw` outranks rendered frames: it is the engine-native stack, which is
  // what server-side grouping and debug-image lookup are tuned for. Without
  // this fallback, an adapter supplying only `stacktrace.raw` would produce an
  // event with no top-level stack at all.
  const stack = event.stack ?? exception?.stacktrace?.raw ?? renderStackFrames(exception?.stacktrace?.frames);
  if (typeof event.handled !== "boolean") {
    throw new Error("Hexclave captureEvent requires a boolean handled field");
  }
  const data = buildErrorEventDataFromNormalized({
    name,
    message,
    stack,
    synthetic: false,
  }, {
    mechanismType: event.mechanism ?? "captured.event",
    handled: event.handled,
    release: event.release ?? options.release,
    environment: event.environment ?? options.environment,
    sdkVersion: options.sdkVersion,
    eventId: options.eventId,
    scope: mergeErrorScopeData(options.scope, event),
    exceptionValues: event.exception?.values,
    extra: {
      ...event.platform === undefined ? {} : { platform: event.platform },
    },
  });
  return data;
}

export type ClientErrorCaptureAdmission = {
  /**
   * Normalized exactly ONCE, by the policy. Callers must build the event from
   * THIS (via buildErrorEventDataFromNormalized) instead of re-normalizing:
   * normalizeCapturedError synthesizes a fresh capture-site stack for plain
   * objects, so a second normalization would diverge from what dedupe saw.
   */
  normalized: NormalizedError,
};

export type ClientErrorCapturePolicy = {
  /**
   * Runs the local admission policy for one candidate error. Returns null when
   * the capture must be dropped locally; on admission the error object is
   * marked captured and counted against the flood caps, so the caller MUST
   * emit the event it builds from the returned normalization.
   */
  admit: (raw: unknown) => ClientErrorCaptureAdmission | null,
};

/**
 * The LOCAL admission policy shared by every automatic client `$error` source:
 * already-captured marker, ignoreErrors substring drops, single-slot signature
 * dedupe, and the per-page-view flood caps. Extracted from the global-handler
 * installer so console.error promotion cannot bypass it — and so both sources
 * can share ONE state instance: an error that was console.error'd and later
 * surfaces at window.onerror must dedupe and count as a single capture.
 */
export function createClientErrorCapturePolicy(deps: {
  ignoreErrors: readonly string[],
  getCurrentPageViewSpanId: () => string | null,
}): ClientErrorCapturePolicy {
  // Single-slot dedupe: the exact same error signature arriving back-to-back
  // (double-registered handlers, immediate re-render loops) is dropped.
  let lastCaptured: { name: string, message: string, fingerprint: string, stack: string | null } | null = null;
  // Flood control, keyed to the current page view (see getCurrentPageViewSpanId).
  let capPageViewSpanId = deps.getCurrentPageViewSpanId();
  let perFingerprintCounts = new Map<string, number>();
  let totalOnPageView = 0;
  let droppedByCap = 0;
  let warnedCap = false;

  return {
    admit: (raw) => {
      if (isAlreadyCaptured(raw)) return null;
      const normalized = normalizeCapturedError(raw);
      if (deps.ignoreErrors.some((needle) => normalized.message.includes(needle))) return null;

      // Page-view rollover resets the caps (compare-on-capture: the policy is
      // created EAGERLY, before the lazily-loaded tracker exists, so it samples
      // the id on every admission instead of hooking the tracker lifecycle).
      const pageViewSpanId = deps.getCurrentPageViewSpanId();
      if (pageViewSpanId !== capPageViewSpanId) {
        capPageViewSpanId = pageViewSpanId;
        perFingerprintCounts = new Map();
        totalOnPageView = 0;
        droppedByCap = 0;
      }

      const message = truncateUtf8Bytes(normalized.message, ERROR_TEXT_MAX_BYTES);
      const stack = normalized.stack !== null ? truncateUtf8Bytes(normalized.stack, ERROR_TEXT_MAX_BYTES) : null;
      const fingerprint = computeErrorFingerprint(normalized.name, message, stack);
      if (
        lastCaptured !== null
        && lastCaptured.name === normalized.name
        && lastCaptured.message === message
        && lastCaptured.fingerprint === fingerprint
        && lastCaptured.stack === stack
      ) {
        return null;
      }
      const fingerprintCount = perFingerprintCounts.get(fingerprint) ?? 0;
      if (fingerprintCount >= MAX_ERRORS_PER_FINGERPRINT_PER_PAGE_VIEW || totalOnPageView >= MAX_ERRORS_PER_PAGE_VIEW) {
        droppedByCap += 1;
        if (!warnedCap) {
          warnedCap = true;
          console.warn(`Hexclave analytics: error capture rate cap reached on this page view (${MAX_ERRORS_PER_FINGERPRINT_PER_PAGE_VIEW} per error group / ${MAX_ERRORS_PER_PAGE_VIEW} total); further errors are dropped locally (${droppedByCap} so far)`);
        }
        return null;
      }
      perFingerprintCounts.set(fingerprint, fingerprintCount + 1);
      totalOnPageView += 1;
      markCaptured(raw);
      lastCaptured = { name: normalized.name, message, fingerprint, stack };
      return { normalized };
    },
  };
}

export type ClientErrorCaptureDeps = {
  /** Delivers one `$error` event's data (fire-and-forget; the sink pre-catches). */
  emit: (data: CapturedErrorEvent, scope?: ErrorScopeData) => void,
  /** Only consulted by the DEFAULT policy; ignored when `policy` is supplied. */
  ignoreErrors: readonly string[],
  release: string | null,
  environment: string | null,
  sdkVersion: string,
  /**
   * The current `$page-view` span id — the flood-control reset boundary. The
   * capture module installs EAGERLY (before the lazily-loaded tracker exists),
   * so instead of hooking the tracker's page-view lifecycle it samples this on
   * every capture and resets the caps when the id changes. Pre-load captures
   * (id still null) count against the first page's budget.
   */
  getCurrentPageViewSpanId: () => string | null,
  /**
   * Shared admission policy. Pass the same instance to every automatic capture
   * source (ClientAnalytics shares it with console.error promotion) so dedupe
   * and flood caps see one stream. Defaults to a fresh instance.
   */
  policy?: ClientErrorCapturePolicy,
};

export type ClientErrorCapture = {
  uninstall: () => void,
};

/**
 * Installs the browser global error capture. Returns null outside browser-like
 * environments. Never throws into the page: every internal failure warns once
 * and arms the ignore-next counter so a failure of OUR code surfacing at the
 * global handler cannot recurse.
 */
export function installClientErrorCapture(deps: ClientErrorCaptureDeps): ClientErrorCapture | null {
  if (typeof window === "undefined") return null;

  // --- instance state ------------------------------------------------------
  // Armed when our own capture path failed (or when we otherwise know the next
  // global error is self-inflicted); the timed decrement bounds the blind spot
  // to the current task + its immediate timeout turn.
  let ignoreNext = 0;
  // Synchronous re-entrancy guard: capture code must never capture itself.
  let capturing = false;
  let warnedInternalFailure = false;
  // Dedupe/flood-control live in the (possibly shared) policy; only the
  // handler-reentrancy state above belongs to this installer.
  const policy = deps.policy ?? createClientErrorCapturePolicy({
    ignoreErrors: deps.ignoreErrors,
    getCurrentPageViewSpanId: deps.getCurrentPageViewSpanId,
  });

  const armIgnoreNext = () => {
    ignoreNext += 1;
    setTimeout(() => {
      ignoreNext = Math.max(0, ignoreNext - 1);
    }, 0);
  };

  const capture = (raw: unknown, info: { mechanismType: string, synthetic?: boolean, extra?: Record<string, unknown> }): void => {
    if (capturing) return;
    capturing = true;
    try {
      if (ignoreNext > 0) return;
      const admission = policy.admit(raw);
      if (admission === null) return;
      const normalized = admission.normalized;

      const scope = getActiveErrorScope()?.snapshot();
      deps.emit(buildErrorEventDataFromNormalized(normalized, {
        mechanismType: info.mechanismType,
        handled: false,
        synthetic: info.synthetic,
        release: deps.release,
        environment: deps.environment,
        sdkVersion: deps.sdkVersion,
        scope,
        exceptionValues: buildLinkedExceptionValues(raw, normalized),
        extra: {
          // Query strings and fragments routinely contain OAuth codes, reset
          // tokens, and other credentials. Keep the useful page identity while
          // matching the network-capture URL privacy boundary.
          url: `${window.location.origin}${window.location.pathname}`,
          path: window.location.pathname,
          ...info.extra ?? {},
        },
      }), scope);
    } catch (captureError) {
      // A failure HERE must never recurse through the very handlers we patch:
      // arm the ignore-next counter before doing anything else that could throw.
      armIgnoreNext();
      if (!warnedInternalFailure) {
        warnedInternalFailure = true;
        console.warn("Hexclave analytics: error capture failed:", captureError);
      }
    } finally {
      capturing = false;
    }
  };

  // --- Error.stackTraceLimit -----------------------------------------------
  // V8's default of 10 frames is often too shallow to group framework errors;
  // 50 matches the "first ~50 frames" budget of the (8KB-bounded) raw stack.
  // Saved + restored on uninstall; only ever raised, never lowered.
  const errorCtor = Error as ErrorConstructor & { stackTraceLimit?: unknown };
  const previousStackTraceLimit = errorCtor.stackTraceLimit;
  if (typeof previousStackTraceLimit === "number" && previousStackTraceLimit < ERROR_STACK_TRACE_LIMIT) {
    errorCtor.stackTraceLimit = ERROR_STACK_TRACE_LIMIT;
  }

  // --- window.onerror ------------------------------------------------------
  const previousOnError = window.onerror;
  const patchedOnError: OnErrorEventHandler = function (this: unknown, message, url, line, col, error) {
    if (error != null) {
      capture(error, {
        mechanismType: "global.onerror",
        extra: {
          ...typeof url === "string" && url !== "" ? { filename: url } : {},
          ...typeof line === "number" ? { lineno: line } : {},
          ...typeof col === "number" ? { colno: col } : {},
        },
      });
    } else if (typeof message === "string") {
      // No error object (old browsers, some cross-realm throws): synthesize a
      // single "frame" from url:line:col so the row is at least locatable.
      const messageText = message;
      const syntheticError = new Error(messageText);
      syntheticError.stack = `${messageText}\n    at ? (${typeof url === "string" && url !== "" ? url : "<anonymous>"}:${typeof line === "number" ? line : 0}:${typeof col === "number" ? col : 0})`;
      capture(syntheticError, {
        mechanismType: "global.onerror",
        synthetic: true,
        extra: {
          ...typeof url === "string" && url !== "" ? { filename: url } : {},
          ...typeof line === "number" ? { lineno: line } : {},
          ...typeof col === "number" ? { colno: col } : {},
        },
      });
    }
    // else: `message` is an Event and there is no error object — a
    // resource-load error surfaced oddly, not a runtime error. Skip capture
    // but still forward.

    if (typeof previousOnError === "function") {
      // Chain + forward the ORIGINAL's return value (it controls default
      // console logging); never clobber.
      return previousOnError.apply(this, [message, url, line, col, error]);
    }
    return false;
  };
  window.onerror = patchedOnError;

  // --- window.onunhandledrejection -----------------------------------------
  const previousOnUnhandledRejection = window.onunhandledrejection;
  const patchedOnUnhandledRejection = function (this: WindowEventHandlers, event: PromiseRejectionEvent): unknown {
    // Sentry's 3-way extraction: a primitive event IS the reason (some
    // frameworks re-dispatch the raw value), else `.reason`, else CustomEvent
    // style `.detail.reason`.
    let reason: unknown = event;
    if (!isPrimitive(event)) {
      if ("reason" in event) {
        reason = event.reason;
      } else {
        const detail = (event as { detail?: unknown }).detail;
        if (typeof detail === "object" && detail !== null && "reason" in detail) {
          reason = (detail as { reason: unknown }).reason;
        }
      }
    }
    if (isPrimitive(reason)) {
      capture(new Error(`Non-Error promise rejection captured with value: ${String(reason)}`), {
        mechanismType: "global.unhandledrejection",
        synthetic: true,
      });
    } else {
      capture(reason, { mechanismType: "global.unhandledrejection" });
    }
    if (typeof previousOnUnhandledRejection === "function") {
      // `window`, not `this`: the browser always invokes the slot with the
      // window as receiver, and lib.dom types the stored handler's `this` as
      // the full Window (which our chained wrapper's `this` cannot prove).
      return previousOnUnhandledRejection.call(window, event);
    }
    return true;
  };
  window.onunhandledrejection = patchedOnUnhandledRejection;

  return {
    uninstall: () => {
      // Only restore slots that are still OURS — someone patched on top
      // otherwise, and restoring would sever their chain.
      if (window.onerror === patchedOnError) {
        window.onerror = previousOnError;
      }
      if (window.onunhandledrejection === patchedOnUnhandledRejection) {
        window.onunhandledrejection = previousOnUnhandledRejection;
      }
      if (typeof previousStackTraceLimit === "number" && errorCtor.stackTraceLimit === ERROR_STACK_TRACE_LIMIT) {
        errorCtor.stackTraceLimit = previousStackTraceLimit;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Server monitor
// ---------------------------------------------------------------------------

/** Marker on globalThis: projectId → uninstaller (mirrors server-fetch-instrumentation). */
const SERVER_ERROR_MONITOR_MARKER = "__hexclaveServerErrorMonitor";

function getServerMonitorRegistry(): Map<string, () => void> {
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  const existing = g[SERVER_ERROR_MONITOR_MARKER];
  // instanceof narrows to Map<any, any>; only this module ever writes values,
  // so they are the uninstallers the return type declares.
  if (existing instanceof Map) return existing;
  const registry = new Map<string, () => void>();
  g[SERVER_ERROR_MONITOR_MARKER] = registry;
  return registry;
}

type ProcessLike = {
  on: (event: string, listener: (error: unknown) => void) => unknown,
  removeListener: (event: string, listener: (error: unknown) => void) => unknown,
};

function getProcessLike(): ProcessLike | null {
  const candidate = (globalThis as { process?: unknown }).process;
  if (typeof candidate !== "object" || candidate === null) return null;
  const withMethods = candidate as { on?: unknown, removeListener?: unknown };
  if (typeof withMethods.on !== "function" || typeof withMethods.removeListener !== "function") return null;
  return candidate as ProcessLike;
}

/**
 * Installs the server-side uncaught-error monitor via
 * `process.on("uncaughtExceptionMonitor")` — ONLY that event, on purpose: a
 * plain `uncaughtException` listener changes Node's crash semantics (the
 * process no longer exits), and an auth SDK must never hijack the host app's
 * crash policy. The monitor is observation-only and fires regardless of other
 * handlers. Flush is best-effort: the capture triggers an immediate send
 * attempt, but on a hard exit Node does not wait for in-flight network I/O,
 * so the very last error of a crashing process can be lost — the accepted
 * cost of staying semantics-neutral.
 *
 * REPLACE-keyed per project on globalThis (same rationale as the fetch
 * instrumentation): dev-server HMR constructs fresh app instances, and
 * stacking listeners would report every crash once per HMR generation.
 * Returns the uninstaller, or null where `process` events are unavailable.
 */
export function installServerErrorMonitor(opts: {
  projectId: string,
  capture: (error: unknown) => void,
}): (() => void) | null {
  const processLike = getProcessLike();
  if (processLike === null) return null;

  const registry = getServerMonitorRegistry();
  const previous = registry.get(opts.projectId);
  if (previous !== undefined) {
    previous();
    registry.delete(opts.projectId);
  }

  const listener = (error: unknown) => {
    try {
      opts.capture(error);
    } catch (captureError) {
      // The process is already crashing; our reporting failure must not add a
      // second crash on top.
      console.warn("Hexclave analytics: failed to report an uncaught exception:", captureError);
    }
  };
  processLike.on("uncaughtExceptionMonitor", listener);

  const uninstall = () => {
    processLike.removeListener("uncaughtExceptionMonitor", listener);
    if (registry.get(opts.projectId) === uninstall) {
      registry.delete(opts.projectId);
    }
  };
  registry.set(opts.projectId, uninstall);
  return uninstall;
}
