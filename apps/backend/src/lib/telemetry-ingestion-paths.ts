const TELEMETRY_INGESTION_PATHS = new Set([
  "/api/latest/analytics/events/batch",
  "/api/v1/analytics/events/batch",
  "/api/latest/analytics/envelope",
  "/api/v1/analytics/envelope",
  "/api/latest/analytics/otlp/v1/traces",
  "/api/v1/analytics/otlp/v1/traces",
  "/api/latest/analytics/otlp/v1/logs",
  "/api/v1/analytics/otlp/v1/logs",
  "/api/latest/analytics/otlp/v1/metrics",
  "/api/v1/analytics/otlp/v1/metrics",
  "/api/latest/session-replays/batch",
  "/api/v1/session-replays/batch",
]);

export function isTelemetryIngestionPath(pathname: string): boolean {
  return TELEMETRY_INGESTION_PATHS.has(pathname);
}
