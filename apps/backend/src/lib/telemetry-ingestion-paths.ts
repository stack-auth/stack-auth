const TELEMETRY_INGESTION_PATHS = new Set([
  "/api/latest/analytics/events/batch",
  "/api/v1/analytics/events/batch",
  "/api/latest/session-replays/batch",
  "/api/v1/session-replays/batch",
]);

export function isTelemetryIngestionPath(pathname: string): boolean {
  return TELEMETRY_INGESTION_PATHS.has(pathname);
}
