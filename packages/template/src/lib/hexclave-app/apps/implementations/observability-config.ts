import type { NetworkOptions } from "./network-capture";

export { type NetworkOptions } from "./network-capture";

export type ErrorCaptureOptions = {
  /** Whether global uncaught-error capture is enabled. @default true */
  enabled?: boolean,
  /** Error-message substrings to drop locally, merged with SDK defaults. */
  ignoreErrors?: string[],
};

export const DEFAULT_CONSOLE_CAPTURE_LEVELS: ("log" | "warn" | "error" | "info" | "debug")[] = ["warn", "error"];

export type LogsOptions = {
  /**
   * Console methods mirrored into structured log records. Original console
   * calls always run first. Pass an empty array to disable console capture.
   *
   * @default ["warn", "error"]
   */
  captureConsole?: ("log" | "warn" | "error" | "info" | "debug")[],
};

export type SpanPropagationOptions = {
  /** Set false to stop attaching the Hexclave context header. @default true */
  enabled?: boolean,
  /** Extra exact origins allowed to receive the propagation header. */
  allowedOrigins?: string[],
  /** Include exact origins derived from trusted domains. @default true */
  useTrustedDomains?: boolean,
};

export type ObservabilityOptions = {
  /** Whether logs, errors, spans, and code instrumentation are enabled. @default true */
  enabled?: boolean,
  /**
   * Deterministic sample rate in [0, 1] for healthy traces. Sampling is applied
   * once to the coalesced SDK flush, so every event/span in one trace receives
   * the same decision. Failed and slow traces are always retained.
   *
   * @default 1
   */
  traceSampleRate?: number,
  errorCapture?: ErrorCaptureOptions,
  logs?: LogsOptions,
  spanPropagation?: SpanPropagationOptions,
  network?: NetworkOptions,
};

export function normalizeTraceSampleRate(options: ObservabilityOptions | undefined): number {
  const sampleRate = options?.traceSampleRate ?? options?.network?.sampleRate ?? 1;
  if (typeof sampleRate !== "number" || !(sampleRate >= 0 && sampleRate <= 1)) {
    throw new Error("Hexclave analytics: observability.traceSampleRate must be a number between 0 and 1");
  }
  if (
    options?.traceSampleRate !== undefined
    && options.network?.sampleRate !== undefined
    && options.traceSampleRate !== options.network.sampleRate
  ) {
    throw new Error("Hexclave analytics: observability.traceSampleRate and the deprecated network.sampleRate alias must match when both are set");
  }
  return sampleRate;
}

// ObservabilityOptions is JSON-native by construction (no RegExp/function-valued
// fields, unlike AnalyticsOptions.replays.blockClass and TelemetryOptions.waitUntil),
// so it crosses the SSR serialization boundary as-is — there is deliberately no
// toJson/fromJson pair here. Keep it that way: adding a non-JSON field means
// adding the codec, not silently dropping the field.
