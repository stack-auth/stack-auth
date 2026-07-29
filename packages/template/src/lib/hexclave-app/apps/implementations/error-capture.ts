import type { ErrorCaptureOptions } from "./observability-config";
import { truncateUtf8Bytes } from "./telemetry-core";

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
 * (follow-up — ignoreErrors substring matching covers the v1 need); and no
 * replay-on-error buffered flush (follow-up).
 */

// Mirrors the `$log` message cap (TELEMETRY_MAX_LOG_MESSAGE_BYTES): big enough for
// real stacks, small enough that one error cannot crowd out the 64KB
// item-data budget. Shared by the client capture below and the server-side
// _captureServerRequestError path.
export const ERROR_TEXT_MAX_BYTES = 8_192;

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
};

export function normalizeErrorCaptureOptions(options: ErrorCaptureOptions | undefined): NormalizedErrorCaptureOptions {
  return {
    enabled: options?.enabled !== false,
    ignoreErrors: [...DEFAULT_IGNORE_ERRORS, ...options?.ignoreErrors ?? []],
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

type NormalizedError = {
  name: string,
  message: string,
  stack: string | null,
  synthetic: boolean,
};

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
  /** Force the synthetic flag on (used when the CALLER already synthesized the message, e.g. primitive rejections). */
  synthetic?: boolean,
  /** Extra flat fields (filename/lineno/colno, url/path, route metadata, …). */
  extra?: Record<string, unknown>,
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
export function buildErrorEventData(error: unknown, options: BuildErrorEventDataOptions): Record<string, unknown> {
  return buildErrorEventDataFromNormalized(normalizeCapturedError(error), options);
}

// Split from buildErrorEventData so the client capture path — which already
// normalized the error for dedupe/flood-control — never normalizes twice:
// normalizeCapturedError synthesizes a fresh capture-site stack for plain
// objects, so a second call would produce a DIFFERENT stack (and fingerprint)
// than the one the dedupe logic compared.
function buildErrorEventDataFromNormalized(normalized: NormalizedError, options: BuildErrorEventDataOptions): Record<string, unknown> {
  const message = truncateUtf8Bytes(normalized.message, ERROR_TEXT_MAX_BYTES);
  const stack = normalized.stack !== null ? truncateUtf8Bytes(normalized.stack, ERROR_TEXT_MAX_BYTES) : null;
  return {
    message,
    name: normalized.name,
    ...stack !== null ? { stack } : {},
    mechanism_type: options.mechanismType,
    handled: options.handled,
    ...normalized.synthetic || options.synthetic === true ? { synthetic: 1 } : {},
    // Fingerprint over the UNTRUNCATED inputs would differ from what a reader
    // can recompute from the row, so hash the bounded values.
    fingerprint: computeErrorFingerprint(normalized.name, message, stack),
    ...options.release !== null ? { release: options.release } : {},
    ...options.environment !== null ? { environment: options.environment } : {},
    sdk_version: options.sdkVersion,
    ...options.extra ?? {},
  };
}

export type ClientErrorCaptureDeps = {
  /** Delivers one `$error` event's data (fire-and-forget; the sink pre-catches). */
  emit: (data: Record<string, unknown>) => void,
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
  // Single-slot dedupe: the exact same error signature arriving back-to-back
  // (double-registered handlers, immediate re-render loops) is dropped.
  let lastCaptured: { name: string, message: string, fingerprint: string, stack: string | null } | null = null;
  // Flood control, keyed to the current page view (see getCurrentPageViewSpanId).
  let capPageViewSpanId: string | null = deps.getCurrentPageViewSpanId();
  let perFingerprintCounts = new Map<string, number>();
  let totalOnPageView = 0;
  let droppedByCap = 0;
  let warnedCap = false;

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
      if (isAlreadyCaptured(raw)) return;
      const normalized = normalizeCapturedError(raw);
      if (deps.ignoreErrors.some((needle) => normalized.message.includes(needle))) return;

      // Page-view rollover resets the caps (compare-on-capture, see the dep doc).
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
        return;
      }
      const fingerprintCount = perFingerprintCounts.get(fingerprint) ?? 0;
      if (fingerprintCount >= MAX_ERRORS_PER_FINGERPRINT_PER_PAGE_VIEW || totalOnPageView >= MAX_ERRORS_PER_PAGE_VIEW) {
        droppedByCap += 1;
        if (!warnedCap) {
          warnedCap = true;
          console.warn(`Hexclave analytics: error capture rate cap reached on this page view (${MAX_ERRORS_PER_FINGERPRINT_PER_PAGE_VIEW} per error group / ${MAX_ERRORS_PER_PAGE_VIEW} total); further errors are dropped locally (${droppedByCap} so far)`);
        }
        return;
      }
      perFingerprintCounts.set(fingerprint, fingerprintCount + 1);
      totalOnPageView += 1;
      markCaptured(raw);
      lastCaptured = { name: normalized.name, message, fingerprint, stack };

      deps.emit(buildErrorEventDataFromNormalized(normalized, {
        mechanismType: info.mechanismType,
        handled: false,
        synthetic: info.synthetic,
        release: deps.release,
        environment: deps.environment,
        sdkVersion: deps.sdkVersion,
        extra: {
          // Query strings and fragments routinely contain OAuth codes, reset
          // tokens, and other credentials. Keep the useful page identity while
          // matching the network-capture URL privacy boundary.
          url: `${window.location.origin}${window.location.pathname}`,
          path: window.location.pathname,
          ...info.extra ?? {},
        },
      }));
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
