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
  errorCapture?: ErrorCaptureOptions,
  logs?: LogsOptions,
  spanPropagation?: SpanPropagationOptions,
  network?: NetworkOptions,
};

export function observabilityOptionsToJson(options: ObservabilityOptions | undefined): ObservabilityOptions | undefined {
  return options;
}

export function observabilityOptionsFromJson(options: ObservabilityOptions | undefined): ObservabilityOptions | undefined {
  return options;
}
