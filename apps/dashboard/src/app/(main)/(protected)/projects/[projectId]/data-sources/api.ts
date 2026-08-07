"use client";

/**
 * Dashboard-side client for the Data Sources internal API.
 *
 * Uses the admin app's raw request channel (the same path the external-db-sync
 * page uses) rather than an SDK method: these endpoints are dashboard-internal
 * and gain nothing from being in the public SDK surface.
 */
import type { StackAdminApp } from "@hexclave/next";
import { urlString } from "@hexclave/shared/dist/utils/urls";

const hexclaveAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

type AdminAppInternals = {
  sendRequest: (path: string, options: RequestInit, tokenType: "admin") => Promise<Response>,
};

export type AdminAppWithInternals = StackAdminApp<false> & {
  [hexclaveAppInternalsSymbol]: AdminAppInternals,
};

export type ConfigFieldDto = {
  name: string,
  display_name: string,
  description: string | null,
  required: boolean,
  secret: boolean,
  type: string,
  placeholder: string | null,
};

export type ConnectorDto = {
  id: string,
  display_name: string,
  description: string,
  category: string,
  auth_tier: string,
  credential_mode: string,
  stream_count: number,
  config_fields: ConfigFieldDto[],
};

export type CatalogueStats = {
  total: number,
  connectable: number,
  exposed: number,
  streams: number,
  runnable_streams: number,
};

export type DiscoveredStreamDto = {
  name: string,
  primaryKey: string[],
  cursorField: string | null,
  supportedSyncModes: string[],
  recommendedSyncMode: string,
  schema: { fields: Array<{ name: string, type: string, presence: number }>, sampledRecords: number } | null,
  error: string | null,
};

export type SourceListItem = {
  id: string,
  connector_id: string,
  connector_display_name: string,
  connector_available: boolean,
  display_name: string,
  status: "HEALTHY" | "SYNCING" | "FAILED" | "PAUSED",
  last_error: string | null,
  schedule_kind: string,
  schedule_value: string | null,
  next_sync_at: string | null,
  last_synced_at: string | null,
  enabled_stream_count: number,
  total_stream_count: number,
  has_pending_drift: boolean,
  created_at: string,
};

export type SchemaDriftDto = {
  addedFields: Array<{ name: string, type: string, presence: number }>,
  removedFields: string[],
  changedFields: Array<{ name: string, from: string, to: string }>,
  detectedAt: string,
};

export type SourceStreamDto = {
  id: string,
  name: string,
  enabled: boolean,
  sync_mode: string,
  supported_sync_modes: string[],
  cursor_field: string | null,
  primary_key: string[],
  row_count: number,
  discovered_schema: { fields: Array<{ name: string, type: string, presence: number }>, sampledRecords: number } | null,
  pending_drift: SchemaDriftDto | null,
  view_name: string,
};

export type SourceDetailDto = SourceListItem & {
  config: Record<string, string>,
  credentials: { isSet: boolean, fieldNames: string[] },
  streams: SourceStreamDto[],
};

export type SyncRunDto = {
  id: string,
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED",
  trigger: string,
  started_at: string,
  finished_at: string | null,
  duration_ms: number | null,
  rows_synced: number,
  ticks: number,
  error: string | null,
};

export type TestConnectionResult =
  | { ok: true, streams: DiscoveredStreamDto[] }
  | { ok: false, status: number, provider_message: string };

async function request<T>(
  adminApp: AdminAppWithInternals,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await adminApp[hexclaveAppInternalsSymbol].sendRequest(path, init, "admin");
  const text = await response.text();
  const body: unknown = text === "" ? {} : JSON.parse(text);
  if (!response.ok) {
    // Surface the backend's own message — for this feature it is usually the
    // PROVIDER's message, which is the only thing that tells a user what to fix.
    const message = typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  // Always send a body alongside the JSON content type. Declaring
  // `Content-Type: application/json` with an EMPTY body makes the backend's
  // body parser fail with "Invalid JSON in request body" before the handler
  // ever runs, which is how the parameterless POSTs (sync-now) used to break.
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  };
}

export async function fetchCatalogue(adminApp: AdminAppWithInternals) {
  return await request<{ connectors: ConnectorDto[], stats: CatalogueStats }>(
    adminApp, "/internal/data-sources/connectors", { method: "GET" });
}

export async function fetchSources(adminApp: AdminAppWithInternals) {
  const body = await request<{ sources: SourceListItem[] }>(
    adminApp, "/internal/data-sources", { method: "GET" });
  return body.sources;
}

export async function fetchSourceDetail(adminApp: AdminAppWithInternals, sourceId: string) {
  return await request<SourceDetailDto>(
    adminApp, urlString`/internal/data-sources/${sourceId}`, { method: "GET" });
}

export async function fetchSyncRuns(adminApp: AdminAppWithInternals, sourceId: string) {
  const body = await request<{ runs: SyncRunDto[] }>(
    adminApp, urlString`/internal/data-sources/${sourceId}/runs`, { method: "GET" });
  return body.runs;
}

export async function testConnection(
  adminApp: AdminAppWithInternals,
  connectorId: string,
  settings: Record<string, string>,
) {
  return await request<TestConnectionResult>(
    adminApp, "/internal/data-sources/test-connection",
    jsonInit("POST", { connector_id: connectorId, settings }));
}

export async function createSource(adminApp: AdminAppWithInternals, body: {
  connector_id: string,
  display_name: string,
  settings: Record<string, string>,
  streams: Array<{ name: string, sync_mode?: string, cursor_field?: string | null, primary_key?: string[] | null }>,
  schedule?: { kind: string, value?: string | null },
}) {
  return await request<{ id: string }>(
    adminApp, "/internal/data-sources", jsonInit("POST", body));
}

export async function updateSource(adminApp: AdminAppWithInternals, sourceId: string, body: {
  display_name?: string,
  paused?: boolean,
  schedule?: { kind: string, value?: string | null },
}) {
  await request(adminApp, urlString`/internal/data-sources/${sourceId}`, jsonInit("PATCH", body));
}

export async function updateStreams(adminApp: AdminAppWithInternals, sourceId: string, streams: Array<{
  name: string,
  enabled?: boolean,
  sync_mode?: string,
  cursor_field?: string | null,
  primary_key?: string[] | null,
}>) {
  await request(adminApp, urlString`/internal/data-sources/${sourceId}/streams`, jsonInit("PATCH", { streams }));
}

export async function syncNow(adminApp: AdminAppWithInternals, sourceId: string) {
  return await request<{ run_id: string, already_running: boolean }>(
    adminApp, urlString`/internal/data-sources/${sourceId}/sync`, jsonInit("POST"));
}

export async function deleteSource(adminApp: AdminAppWithInternals, sourceId: string) {
  await request(adminApp, urlString`/internal/data-sources/${sourceId}`, { method: "DELETE" });
}

export async function resolveDrift(
  adminApp: AdminAppWithInternals,
  sourceId: string,
  stream: string,
  action: "approve" | "ignore",
) {
  await request(adminApp, urlString`/internal/data-sources/${sourceId}/drift`,
    jsonInit("POST", { stream, action }));
}

export async function createStreamView(adminApp: AdminAppWithInternals, sourceId: string, stream: string) {
  return await request<{ view_name: string }>(
    adminApp, urlString`/internal/data-sources/${sourceId}/view`, jsonInit("POST", { stream }));
}

export async function dropStreamView(adminApp: AdminAppWithInternals, sourceId: string, stream: string) {
  await request(adminApp,
    `${urlString`/internal/data-sources/${sourceId}/view`}?stream=${encodeURIComponent(stream)}`,
    { method: "DELETE" });
}
