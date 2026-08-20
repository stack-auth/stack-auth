import { WORKFLOW_INVOCATION_BACKSTOP_TIMEOUT_MS } from "../src/lib/workflows/protocol";

export const CRON_WORKFLOW_ENGINE_MAX_DURATION_MS = 3 * 60 * 1000;
const CRON_TRANSPORT_TIMEOUT_MARGIN_MS = 30_000;
const CRON_DEFAULT_TRANSPORT_TIMEOUT_MS = 5 * 60 * 1000;

// The workflow endpoint receives this same max_duration_ms. Caller bound =
// its requested loop budget + the engine backstop + a small transport margin.
export function getCronTransportTimeoutMs(maxDurationMs: number): number {
  return maxDurationMs + WORKFLOW_INVOCATION_BACKSTOP_TIMEOUT_MS + CRON_TRANSPORT_TIMEOUT_MARGIN_MS;
}

export function getCronRequestTimeoutMs(maxDurationMs: number | undefined): number {
  return maxDurationMs == null ? CRON_DEFAULT_TRANSPORT_TIMEOUT_MS : getCronTransportTimeoutMs(maxDurationMs);
}
