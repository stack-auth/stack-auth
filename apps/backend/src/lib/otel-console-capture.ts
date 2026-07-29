import { context, trace } from "@opentelemetry/api";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";
import { TELEMETRY_MAX_LOG_MESSAGE_BYTES, truncateUtf8Bytes } from "@hexclave/shared/dist/utils/analytics-wire";
import { nicify } from "@hexclave/shared/dist/utils/strings";

/**
 * Backend console → OTel Logs API bridge. The backend logs exclusively through
 * `console.*` (directly and via captureError) — nothing calls
 * `logs.getLogger(...).emit(...)` — so without this bridge the
 * BatchLogRecordProcessor + AnalyticsLogExporter registered in
 * instrumentation-node.ts drain an empty queue forever and the internal
 * project's Logs page stays empty. This mirrors the client SDK's opt-in
 * console capture (packages/template .../implementations/logs.ts) with the
 * same semantics — original method first, re-entrancy guard, "Hexclave"-prefix
 * skip, nicify serialization, shared body byte cap — but emits OTel log
 * records instead of `$log` events, because on the backend the OTel pipeline
 * (not the SDK event tracker) is the delivery path.
 *
 * Trace correlation is free: the OTel logs SDK stamps `context.active()`'s
 * span context onto each record at emit time, so logs printed while a request
 * span is active land in the Logs UI linked to that trace.
 */

export type ConsoleCaptureLevel = "warn" | "error";

export const OTEL_CONSOLE_SCOPE_NAME = "stack-backend-console";

// Backend self-telemetry deliberately captures only actionable console output.
const CONSOLE_LEVEL_SEVERITIES = new Map<ConsoleCaptureLevel, { severityNumber: SeverityNumber, severityText: string }>([
  ["warn", { severityNumber: SeverityNumber.WARN, severityText: "WARN" }],
  ["error", { severityNumber: SeverityNumber.ERROR, severityText: "ERROR" }],
]);

// Console is a process-wide global, so the capture state must be too.
// level → the ORIGINAL method our patch wraps plus the patch itself (patched
// at most once per level; uninstall compares against the patch reference
// before restoring so it never severs a third party's later patch).
const patchedConsoleMethods = new Map<ConsoleCaptureLevel, { original: (...args: unknown[]) => void, patched: (...args: unknown[]) => void }>();
let captureActive = false;
let inConsoleCapture = false;
let warnedCaptureFailure = false;

// Matches ANSI CSI escape sequences (colors, cursor movement). Next.js and
// other Node tooling colorize their console output for the terminal; the
// escapes carry no meaning in the Logs UI and render as literal garbage there,
// so they are stripped from the mirrored body (the terminal still gets them —
// the original console method runs on the raw args).
// eslint-disable-next-line no-control-regex -- the ESC control character is the whole point of this regex
const ANSI_ESCAPE_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function serializeConsoleArgs(args: unknown[]): string {
  // Strings pass through verbatim; everything else goes through nicify — the
  // shared bounded serializer (depth-limited, circular-safe) — so one logged
  // object cannot explode the payload. The shared body byte cap is the final
  // size bound (applied by the caller).
  return args.map((arg) => typeof arg === "string" ? arg : nicify(arg, { maxDepth: 4 })).join(" ").replace(ANSI_ESCAPE_RE, "");
}

/**
 * Patches console.log/info/debug/warn/error to MIRROR calls into the global
 * OTel Logs API. The original method always runs FIRST (and unconditionally —
 * capture must never eat or delay the developer's own console output);
 * re-entrancy is guarded so console use inside the serializer or the logs SDK
 * cannot loop; and messages starting with "Hexclave" (our own telemetry
 * warnings) are skipped so telemetry warnings never report themselves.
 *
 * The logger is fetched from the api-logs global registry at EMIT time, not at
 * install time: @vercel/otel registers the LoggerProvider inside registerOTel,
 * and per-call lookup makes the bridge independent of installation order (a
 * logger grabbed before registration would be a permanent no-op).
 *
 * Returns the uninstaller. Uninstall restores a method only when it is still
 * OUR patch (someone else patched on top otherwise).
 */
export function installOtelConsoleCapture(options: {
  onErrorTrace?: (traceId: string) => void,
} = {}): () => void {
  captureActive = true;

  for (const [level, severity] of CONSOLE_LEVEL_SEVERITIES) {
    if (patchedConsoleMethods.has(level)) continue;
    const original = console[level].bind(console);
    const patched = (...args: unknown[]): void => {
      original(...args);
      if (!captureActive || inConsoleCapture) return;
      const first = args[0];
      if (typeof first === "string" && first.startsWith("Hexclave")) return;
      inConsoleCapture = true;
      try {
        const activeContext = context.active();
        const activeSpanContext = trace.getSpanContext(activeContext);
        if (level === "error" && activeSpanContext !== undefined) {
          options.onErrorTrace?.(activeSpanContext.traceId);
        }
        logs.getLogger(OTEL_CONSOLE_SCOPE_NAME).emit({
          severityNumber: severity.severityNumber,
          severityText: severity.severityText,
          body: truncateUtf8Bytes(serializeConsoleArgs(args), TELEMETRY_MAX_LOG_MESSAGE_BYTES),
          attributes: { console_level: level },
          // Pass the context explicitly. Depending on an SDK implementation to
          // re-read context.active() later risks detaching the log from the
          // request span when processors/exporters defer work.
          context: activeContext,
        });
      } catch (error) {
        // Capture must never throw into whoever called console.*; the original
        // output already happened, so only the mirror is lost.
        if (!warnedCaptureFailure) {
          warnedCaptureFailure = true;
          console.warn("Hexclave analytics: console capture failed:", error);
        }
      } finally {
        inConsoleCapture = false;
      }
    };
    patchedConsoleMethods.set(level, { original, patched });
    console[level] = patched;
  }

  return () => {
    captureActive = false;
    for (const [level, entry] of patchedConsoleMethods) {
      // Identity check: restoring over a third party's later patch would sever
      // their chain, so a superseded slot just stays a pass-through wrapper.
      if (console[level] === entry.patched) {
        console[level] = entry.original;
        patchedConsoleMethods.delete(level);
      }
    }
  };
}
