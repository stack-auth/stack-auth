import { LOG_LEVELS, TELEMETRY_MAX_LOG_MESSAGE_BYTES, type LogLevel } from "@hexclave/shared/dist/utils/analytics-wire";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import { computeErrorFingerprint, ERROR_TEXT_MAX_BYTES, normalizeCapturedError } from "./error-capture";
import { getCustomTelemetryDataError, truncateUtf8Bytes } from "./telemetry-core";

/**
 * Native logs (`app.logger`) — `$log` events with the extra wire fields
 * (message/level) the batch route requires for that type. This module is
 * deliberately tiny and dependency-light: the logger is exposed eagerly on
 * every app instance (client and server), so it must not pull in the
 * lazily-loaded tracker or any autocapture code. Delivery is
 * environment-specific and injected via `emit` — the client sink rides the
 * tracker event path (with pre-load adoption), the server sink rides the
 * server telemetry buffer (inheriting ambient request ancestry).
 */

/** One `$log` event, wire-ready: message pre-truncated, level resolved. */
export type LogEmitItem = {
  message: string,
  level: LogLevel,
  data: Record<string, unknown> | undefined,
  // Client-side routing hint, never sent on the wire: "console" items come
  // from the automatic mirror and must never force the lazy analytics runtime
  // to load (they ride a bounded pre-load queue instead); "logger" items are
  // explicit developer intent and keep the load-triggering fast path.
  origin: "logger" | "console",
};

export type Logger = {
  [K in LogLevel]: (message: string, data?: Record<string, unknown>) => void
};

export type CreateLoggerDeps = {
  /**
   * Delivers one log item. Returns "unavailable" when this environment cannot
   * deliver logs at all (analytics disabled, unsupported environment) — the
   * logger then warns ONCE and keeps dropping silently; actual delivery
   * failures are handled (and pre-caught) inside the sink like every other
   * telemetry send.
   */
  emit: (item: LogEmitItem) => "ok" | "unavailable",
  /** Stamped on every emitted item — see LogEmitItem.origin. @default "logger" */
  origin?: "logger" | "console",
};

/**
 * Builds the `{ trace, debug, info, warn, error }` logger. Every method is
 * fire-and-forget and NEVER throws into user code: invalid structured data is
 * dropped with a warning (same validation as event data), non-string messages
 * are coerced, and unavailability warns once.
 */
export function createLogger(deps: CreateLoggerDeps): Logger {
  let warnedUnavailable = false;
  const log = (level: LogLevel, message: string, data?: Record<string, unknown>): void => {
    // A logging API must deliver or drop — never throw. Non-string messages
    // (someone passing an object despite the types) are coerced rather than
    // dropped: the intent to log is clear, only the shape is wrong.
    const messageText = typeof message === "string" ? message : nicify(message, { maxDepth: 4 });
    const dataError = getCustomTelemetryDataError(data);
    if (dataError !== null) {
      console.warn(`Hexclave analytics: dropping ${level} log: ${dataError}`);
      return;
    }
    const result = deps.emit({
      message: truncateUtf8Bytes(messageText, TELEMETRY_MAX_LOG_MESSAGE_BYTES),
      level,
      data,
      origin: deps.origin ?? "logger",
    });
    if (result === "unavailable" && !warnedUnavailable) {
      warnedUnavailable = true;
      console.warn("Hexclave analytics: app.logger is unavailable in this environment (analytics disabled or unsupported); logs will be dropped");
    }
  };
  return Object.fromEntries(LOG_LEVELS.map((level) => [level, (message: string, data?: Record<string, unknown>) => log(level, message, data)])) as Logger;
}

// ---------------------------------------------------------------------------
// Console capture (on by default for warn/error; observability.logs.captureConsole)
// ---------------------------------------------------------------------------

export type ConsoleCaptureLevel = "log" | "warn" | "error" | "info" | "debug";

/** Log level each console method maps to (`console.log` has no level peer → info). */
const CONSOLE_LEVEL_LOG_LEVELS = new Map<ConsoleCaptureLevel, LogLevel>([
  ["log", "info"],
  ["info", "info"],
  ["debug", "debug"],
  ["warn", "warn"],
  ["error", "error"],
]);

// Flood control for the automatic mirror: per console level, a token bucket
// that admits a burst then a sustained rate. Per LEVEL (not global) so a
// runaway info/log loop can never starve error capture. When a bucket first
// runs dry, one final `$log` records that the mirror is dropping — visible in
// the dashboard instead of a silent gap. Explicit app.logger.* calls are NOT
// rate limited (developer intent beats flood protection there).
const CONSOLE_CAPTURE_BUCKET_BURST = 100;
const CONSOLE_CAPTURE_BUCKET_REFILL_PER_SEC = 10;

type ConsoleCaptureSink = { levels: Set<ConsoleCaptureLevel>, logger: Logger, projectId: string, serviceName: string };

// Console is a per-process global, so ALL capture state must be too — and it
// must be shared across duplicate SDK COPIES in one page/process (two bundled
// copies with module-local state would each wrap the other's wrapper; a
// restore could then sever the chain into infinite recursion). One
// Symbol.for-keyed slot on globalThis makes every copy see the same patch
// registry and the same re-entrancy flag.
type ConsoleCaptureGlobalState = {
  // One current sink per project+service identity. HMR replaces the same pair,
  // but capture is disabled while distinct pairs are registered: console output
  // has no app identity, so routing it to either service would be fabrication.
  sinksByIdentity: Map<string, ConsoleCaptureSink>,
  // level → the ORIGINAL method our patch wraps plus the patch itself (patched
  // at most once per level across all SDK copies; the sink swap happens inside
  // the patch, and the patch reference is what uninstall compares against
  // before restoring).
  patched: Map<ConsoleCaptureLevel, { original: (...args: unknown[]) => void, patched: (...args: unknown[]) => void }>,
  // Re-entrancy latch: console use from inside the mirror (the serializer, the
  // logger's own warnings) must never mirror again. SDK diagnostics are kept out
  // by the "Hexclave" message-prefix skip inside the patch instead.
  suppressed: boolean,
  buckets: Map<ConsoleCaptureLevel, { tokens: number, lastRefillMs: number, warnedDry: boolean }>,
  warnedFailure: boolean,
};

const CONSOLE_CAPTURE_STATE_KEY = Symbol.for("hexclave.analytics.console-capture.v2");

function getConsoleCaptureState(): ConsoleCaptureGlobalState {
  const holder = globalThis as { [CONSOLE_CAPTURE_STATE_KEY]?: ConsoleCaptureGlobalState };
  holder[CONSOLE_CAPTURE_STATE_KEY] ??= {
    sinksByIdentity: new Map(),
    patched: new Map(),
    suppressed: false,
    buckets: new Map(),
    warnedFailure: false,
  };
  return holder[CONSOLE_CAPTURE_STATE_KEY];
}

function getActiveConsoleCaptureSink(state: ConsoleCaptureGlobalState): ConsoleCaptureSink | null {
  if (state.sinksByIdentity.size !== 1) return null;
  return state.sinksByIdentity.values().next().value ?? null;
}

// Keys whose values must never leave the process through the automatic
// mirror. Matched case-insensitively against object keys at any (bounded)
// depth — console.error("auth failed", { headers }) is one of the most common
// accidental token leaks. Free-text strings are NOT scanned (unreliable), the
// same trade every major capture SDK makes.
const SENSITIVE_KEY_RE = /authorization|cookie|passw|secret|token|api[-_]?key|session[-_]?id|private[-_]?key/i;
const REDACTION_MAX_DEPTH = 4;

function redactSensitiveKeys(value: unknown, depth: number): unknown {
  if (depth <= 0 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveKeys(item, depth - 1));
  // Non-plain objects (Error, Map, class instances) pass through untouched:
  // walking their own enumerable props would produce a lossy copy that nicify
  // then serializes worse than the original (e.g. dropping Error.message).
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
    key,
    SENSITIVE_KEY_RE.test(key) ? "[redacted]" : redactSensitiveKeys(entryValue, depth - 1),
  ]));
}

function serializeConsoleArgs(args: unknown[]): string {
  // Strings pass through verbatim; everything else is key-redacted then goes
  // through nicify — the SDK's existing bounded serializer (depth-limited,
  // circular-safe) — so one logged object cannot explode the payload or leak
  // credential-shaped fields. The logger's 8KB message cap is the final size
  // bound.
  return args.map((arg) => typeof arg === "string" ? arg : nicify(redactSensitiveKeys(arg, REDACTION_MAX_DEPTH), { maxDepth: 4 })).join(" ");
}

function takeConsoleCaptureToken(state: ConsoleCaptureGlobalState, level: ConsoleCaptureLevel): "ok" | "dry" | "newly-dry" {
  let bucket = state.buckets.get(level);
  const nowMs = performance.now();
  if (bucket === undefined) {
    bucket = { tokens: CONSOLE_CAPTURE_BUCKET_BURST, lastRefillMs: nowMs, warnedDry: false };
    state.buckets.set(level, bucket);
  }
  bucket.tokens = Math.min(
    CONSOLE_CAPTURE_BUCKET_BURST,
    bucket.tokens + ((nowMs - bucket.lastRefillMs) / 1000) * CONSOLE_CAPTURE_BUCKET_REFILL_PER_SEC,
  );
  bucket.lastRefillMs = nowMs;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    bucket.warnedDry = false;
    return "ok";
  }
  if (bucket.warnedDry) return "dry";
  bucket.warnedDry = true;
  return "newly-dry";
}

/**
 * Patches the requested console methods to MIRROR calls into `logger` as
 * `$log` events. The original method always runs FIRST (and unconditionally —
 * capture must never eat or delay the developer's own console output);
 * re-entrancy is guarded so the logger's/serializer's own console use cannot
 * loop; messages starting with "Hexclave" (the SDK's own warns) are skipped so
 * telemetry warnings never report themselves; and a per-level token bucket
 * bounds runaway logging loops.
 *
 * Returns the uninstaller. Uninstall restores a method only when it is still
 * OUR patch (someone else patched on top otherwise), and always detaches the
 * sink.
 */
export function installConsoleCapture(opts: { levels: readonly ConsoleCaptureLevel[], logger: Logger, projectId: string, serviceName: string }): () => void {
  const state = getConsoleCaptureState();
  const levels = new Set(opts.levels);
  const sink: ConsoleCaptureSink = { levels, logger: opts.logger, projectId: opts.projectId, serviceName: opts.serviceName };
  const identity = `${opts.projectId}\u0000${opts.serviceName}`;
  const conflictingIdentities = [...state.sinksByIdentity.keys()].filter((registeredIdentity) => registeredIdentity !== identity);
  if (conflictingIdentities.length > 0) {
    console.warn("Hexclave analytics: automatic console capture is disabled because multiple telemetry services share this runtime; use each app's explicit logger or configure console capture on only one service");
  }
  state.sinksByIdentity.set(identity, sink);
  // Fresh buckets per install: the rate limit is per-page-load noise control,
  // not a bypass boundary, and carrying half-drained buckets across an HMR
  // reinstall would make drop behavior depend on how often the app reloaded.
  state.buckets.clear();

  for (const level of levels) {
    if (state.patched.has(level)) continue;
    const original = console[level].bind(console);
    const patched = (...args: unknown[]): void => {
      original(...args);
      const currentSink = getActiveConsoleCaptureSink(state);
      if (currentSink === null || !currentSink.levels.has(level) || state.suppressed) return;
      const first = args[0];
      if (typeof first === "string" && first.startsWith("Hexclave")) return;
      state.suppressed = true;
      try {
        const logLevel = CONSOLE_LEVEL_LOG_LEVELS.get(level);
        if (logLevel === undefined) return; // impossible: the map covers every ConsoleCaptureLevel
        const token = takeConsoleCaptureToken(state, level);
        if (token === "dry") return;
        if (token === "newly-dry") {
          currentSink.logger.warn(`Hexclave console capture is dropping console.${level} calls (rate limit: burst ${CONSOLE_CAPTURE_BUCKET_BURST}, ${CONSOLE_CAPTURE_BUCKET_REFILL_PER_SEC}/s)`, { console_level: level, rate_limited: true });
          return;
        }
        // console.error(err) with an actual Error arg carries the SAME
        // fingerprint the $error pipeline would compute (identical truncation
        // before hashing — see buildErrorEventDataFromNormalized), so the
        // dashboard can collapse a thrown-AND-logged error into one line.
        const errorArg = args.find((arg): arg is Error => arg instanceof Error);
        let errorExtras: Record<string, unknown> = {};
        if (errorArg !== undefined) {
          const normalized = normalizeCapturedError(errorArg);
          const errorMessage = truncateUtf8Bytes(normalized.message, ERROR_TEXT_MAX_BYTES);
          const errorStack = normalized.stack !== null ? truncateUtf8Bytes(normalized.stack, ERROR_TEXT_MAX_BYTES) : null;
          errorExtras = {
            error_name: normalized.name,
            error_fingerprint: computeErrorFingerprint(normalized.name, errorMessage, errorStack),
          };
        }
        currentSink.logger[logLevel](serializeConsoleArgs(args), { console_level: level, ...errorExtras });
      } catch (error) {
        // Capture must never throw into whoever called console.*; the original
        // output already happened, so only the mirror is lost.
        if (!state.warnedFailure) {
          state.warnedFailure = true;
          console.warn("Hexclave analytics: console capture failed:", error);
        }
      } finally {
        state.suppressed = false;
      }
    };
    state.patched.set(level, { original, patched });
    console[level] = patched;
  }

  return () => {
    // A later same-project install replaced this registration; its capture
    // remains authoritative.
    if (state.sinksByIdentity.get(identity) !== sink) return;
    state.sinksByIdentity.delete(identity);
    for (const [level, entry] of state.patched) {
      const levelStillUsed = [...state.sinksByIdentity.values()].some((registeredSink) => registeredSink.levels.has(level));
      if (levelStillUsed) continue;
      // Identity check: restoring over a third party's later patch would sever
      // their chain, so a superseded slot just stays a pass-through wrapper.
      if (console[level] === entry.patched) {
        console[level] = entry.original;
        state.patched.delete(level);
      }
    }
  };
}
