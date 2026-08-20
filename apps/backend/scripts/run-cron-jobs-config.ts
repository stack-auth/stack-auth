import { WORKFLOW_INVOCATION_BACKSTOP_TIMEOUT_MS } from "../src/lib/workflows/protocol";

export const CRON_WORKFLOW_ENGINE_MAX_DURATION_MS = 3 * 60 * 1000;
const CRON_TRANSPORT_TIMEOUT_MARGIN_MS = 30_000;

// These maintenance endpoints perform one short tick and do not request a
// loop budget. Preserve the former global-fetch 300-second headers bound for
// them rather than giving them the workflow endpoint's longer budget.
const CRON_DEFAULT_TRANSPORT_TIMEOUT_MS = 5 * 60 * 1000;

// The workflow endpoint receives this same max_duration_ms. Caller bound =
// its requested loop budget + the engine backstop + a small transport margin.
export function getCronTransportTimeoutMs(maxDurationMs: number): number {
  return maxDurationMs + WORKFLOW_INVOCATION_BACKSTOP_TIMEOUT_MS + CRON_TRANSPORT_TIMEOUT_MARGIN_MS;
}

export function getCronRequestTimeoutMs(maxDurationMs: number | undefined): number {
  return maxDurationMs == null ? CRON_DEFAULT_TRANSPORT_TIMEOUT_MS : getCronTransportTimeoutMs(maxDurationMs);
}

export type CronEndpoint = {
  path: string,
  intervalMs: number,
  maxDurationMs?: number,
};

export const CRON_WORKFLOW_ENGINE_ENDPOINT = {
  path: "/api/latest/internal/workflow-engine-step",
  intervalMs: 1000,
  maxDurationMs: CRON_WORKFLOW_ENGINE_MAX_DURATION_MS,
} satisfies CronEndpoint & { maxDurationMs: number };

export const CRON_ENDPOINTS: CronEndpoint[] = [
  { path: "/api/latest/internal/external-db-sync/sequencer", intervalMs: 1000 },
  { path: "/api/latest/internal/external-db-sync/poller", intervalMs: 1000 },
  CRON_WORKFLOW_ENGINE_ENDPOINT,
  { path: "/api/latest/internal/growth-watchdog-step", intervalMs: 5 * 60_000 },
];
