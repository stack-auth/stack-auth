import type { TelemetrySettings } from "ai";

/**
 * AI SDK telemetry is useful for latency, model, token, and tool-call traces,
 * but its defaults include prompts and generations. Those routinely contain
 * customer or authentication context, so backend telemetry records the
 * operation shape while excluding inputs and outputs.
 */
export function getAiTelemetry(functionId: string): TelemetrySettings {
  return {
    isEnabled: true,
    functionId,
    recordInputs: false,
    recordOutputs: false,
  };
}
