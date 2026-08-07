/**
 * Application layer for Data Warehouse: everything the dashboard routes call.
 *
 * Kept separate from the route handlers so the connect flow's ordering rules
 * live in one place — most importantly that the TEST CONNECTION gate is a hard
 * gate, and a source cannot be created on credentials that have not just been
 * proven to work.
 */
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import type { Tenancy } from "@/lib/tenancies";
import { Prisma } from "@/generated/prisma/client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import type { Json } from "@hexclave/shared/dist/utils/json";
import { getConnector, getRunnableConnector, getRunnableConnectorOrThrow, listCatalogueConnectors } from "./catalogue";
import type { RunnableConnector } from "./catalogue/capabilities";
import {
  createLazyView, dropLazyView, getImportedRowCounts, getLazyViewName, markImportedRowsDeleted,
} from "./clickhouse";
import {
  assertRequiredSettingsPresent, describeStoredCredentials, decryptCredentials,
  encryptCredentials, getPlainConfigFields, getSecretConfigFields, partitionSettings,
} from "./credentials";
import { discoverStreams, type DiscoveredStream } from "./discover";
import { computeNextSyncAt } from "./sync";
import { testConnection } from "./runtime";

export type TestConnectionOutcome =
  | { ok: true, streams: DiscoveredStream[] }
  | { ok: false, status: number, providerMessage: string };

/** Catalogue as the dashboard sees it: T1 connectors that the runtime can run. */
export function listCatalogueForUi() {
  return listCatalogueConnectors().map(connector => ({
    id: connector.id,
    display_name: connector.displayName,
    description: connector.description,
    category: connector.category,
    auth_tier: connector.authTier,
    credential_mode: connector.credentialMode.name,
    stream_count: connector.streams.length,
    config_fields: connector.configFields.map(field => ({
      name: field.name,
      display_name: field.displayName,
      description: field.description ?? null,
      required: field.required,
      secret: field.secret,
      type: field.type,
      placeholder: null,
    })),
  }));
}

/**
 * The setup wizard's hard gate: prove the credentials, THEN discover streams.
 *
 * Discovery is only attempted after the check stream returns 2xx, so a user
 * with a bad key sees the provider's own message rather than a wall of
 * per-stream failures that all say the same thing.
 */
export async function testAndDiscover(options: {
  connectorId: string,
  settings: Record<string, string>,
}): Promise<TestConnectionOutcome> {
  const manifest = getRunnableConnectorOrThrow(options.connectorId);
  const { config, secrets } = partitionSettings(manifest, options.settings);
  assertRequiredSettingsPresent(manifest, config, secrets);

  const check = await testConnection({ manifest, config, secrets });
  if (!check.ok) return check;

  const streams = await discoverStreams({ manifest, config, secrets });
  return { ok: true, streams };
}

/**
 * Creates a source. Re-runs the test gate server-side rather than trusting a
 * client-side "I already tested this": the gate is a security and correctness
 * boundary, and the two calls are separated by however long the user spent on
 * the stream-selection step.
 */
export async function createSource(options: {
  tenancy: Tenancy,
  connectorId: string,
  displayName: string,
  settings: Record<string, string>,
  selectedStreams: Array<{
    name: string,
    sync_mode?: string,
    cursor_field?: string | null,
    primary_key?: string[] | null,
  }>,
  schedule?: { kind: string, value?: string | null },
}): Promise<{ id: string }> {
  const manifest = getRunnableConnectorOrThrow(options.connectorId);
  const { config, secrets } = partitionSettings(manifest, options.settings);
  assertRequiredSettingsPresent(manifest, config, secrets);

  const check = await testConnection({ manifest, config, secrets });
  if (!check.ok) {
    throw new StatusError(
      StatusError.BadRequest,
      `Connection test failed (HTTP ${check.status}): ${check.providerMessage}`,
    );
  }

  const discovered = await discoverStreams({ manifest, config, secrets });
  const discoveredByName = new Map(discovered.map(stream => [stream.name, stream]));

  const selected = options.selectedStreams.filter(stream =>
    manifest.streams.some(entry => entry.name === stream.name));
  if (selected.length === 0) {
    throw new StatusError(StatusError.BadRequest, "Select at least one stream to import.");
  }

  const scheduleKind = options.schedule?.kind ?? "manual";
  const scheduleValue = options.schedule?.value ?? null;
  assertValidSchedule(scheduleKind, scheduleValue);

  const encryptedCredentials = await encryptCredentials(secrets);

  // The source and its streams are created in one transaction, but as two
  // statements rather than a nested write: `DataSourceStream` reaches its
  // tenancy through the compound relation to `DataSource`, so Prisma refuses a
  // raw `tenancyId` scalar inside a nested `create`. `createMany` takes scalars.
  const source = await retryTransaction(globalPrismaClient, async (tx) => {
    const created = await tx.dataSource.create({
      data: {
        tenancyId: options.tenancy.id,
        connectorId: options.connectorId,
        displayName: options.displayName.trim() === "" ? manifest.displayName : options.displayName.trim(),
        status: "HEALTHY",
        config: config as unknown as Prisma.InputJsonValue,
        encryptedCredentials: encryptedCredentials as unknown as Prisma.InputJsonValue,
        scheduleKind,
        scheduleValue,
        nextSyncAt: computeNextSyncAt(scheduleKind, scheduleValue, new Date()),
      },
    });
    await tx.dataSourceStream.createMany({
      data: selected.map(stream => {
        const manifestStream = manifest.streams.find(entry => entry.name === stream.name);
        const discoveredStream = discoveredByName.get(stream.name);
        const syncMode = stream.sync_mode === "incremental"
          && manifestStream?.supportedSyncModes.includes("incremental") === true
          ? "incremental"
          : "full_refresh";
        return {
          tenancyId: options.tenancy.id,
          dataSourceId: created.id,
          streamName: stream.name,
          enabled: true,
          syncMode,
          cursorField: stream.cursor_field ?? manifestStream?.cursorField ?? null,
          primaryKeyFields: stream.primary_key ?? manifestStream?.primaryKey ?? [],
          discoveredSchema: (discoveredStream?.schema ?? null) as unknown as Prisma.InputJsonValue,
        };
      }),
    });
    return created;
  });

  return { id: source.id };
}

function assertValidSchedule(kind: string, value: string | null): void {
  if (!["manual", "interval", "cron"].includes(kind)) {
    throw new StatusError(StatusError.BadRequest, `Unknown schedule type "${kind}".`);
  }
  if (kind === "manual") return;
  if (value == null || value.trim() === "") {
    throw new StatusError(StatusError.BadRequest, "A scheduled source needs an interval or a cron expression.");
  }
  if (computeNextSyncAt(kind, value, new Date()) == null) {
    throw new StatusError(
      StatusError.BadRequest,
      kind === "cron"
        ? `"${value}" is not a valid 5-field cron expression.`
        : `"${value}" is not a valid interval in minutes.`,
    );
  }
}

export async function listSources(tenancy: Tenancy) {
  const sources = await globalPrismaClient.dataSource.findMany({
    where: { tenancyId: tenancy.id },
    include: { streams: true },
    orderBy: { createdAt: "desc" },
  });
  return sources.map(source => {
    const definition = getConnector(source.connectorId);
    const runnable = getRunnableConnector(source.connectorId);
    return {
      id: source.id,
      connector_id: source.connectorId,
      connector_display_name: definition?.displayName ?? source.connectorId,
      // A source whose connector was withdrawn stays listed and readable, but
      // is reported as unsupported rather than silently appearing healthy.
      connector_available: runnable != null,
      display_name: source.displayName,
      status: source.status,
      last_error: source.lastError,
      schedule_kind: source.scheduleKind,
      schedule_value: source.scheduleValue,
      next_sync_at: source.nextSyncAt?.toISOString() ?? null,
      last_synced_at: source.lastSyncedAt?.toISOString() ?? null,
      enabled_stream_count: source.streams.filter(stream => stream.enabled).length,
      total_stream_count: source.streams.length,
      has_pending_drift: source.streams.some(stream => stream.pendingDrift != null),
      created_at: source.createdAt.toISOString(),
    };
  });
}

export async function getSourceDetail(tenancy: Tenancy, sourceId: string) {
  const source = await globalPrismaClient.dataSource.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: sourceId } },
    include: { streams: { orderBy: { streamName: "asc" } } },
  });
  if (source == null) throw new StatusError(StatusError.NotFound, "Data source not found.");

  const definition = getConnector(source.connectorId);
  const manifest = getRunnableConnector(source.connectorId);
  const rowCounts = await getImportedRowCounts({ tenancy, sourceId: source.id });
  const config = (source.config ?? {}) as Record<string, string>;

  return {
    id: source.id,
    connector_id: source.connectorId,
    connector_display_name: definition?.displayName ?? source.connectorId,
    connector_available: manifest != null,
    display_name: source.displayName,
    status: source.status,
    last_error: source.lastError,
    schedule_kind: source.scheduleKind,
    schedule_value: source.scheduleValue,
    next_sync_at: source.nextSyncAt?.toISOString() ?? null,
    last_synced_at: source.lastSyncedAt?.toISOString() ?? null,
    created_at: source.createdAt.toISOString(),
    // Only non-secret settings are ever echoed back.
    config: manifest == null ? {} : Object.fromEntries(
      getPlainConfigFields(manifest).map(field => [field.name, config[field.name] ?? ""]),
    ),
    credentials: manifest == null
      ? { isSet: source.encryptedCredentials != null, fieldNames: [] }
      : describeStoredCredentials(manifest, source.encryptedCredentials),
    streams: source.streams.map(stream => {
      const manifestStream = manifest?.streams.find(entry => entry.name === stream.streamName);
      return {
        id: stream.id,
        name: stream.streamName,
        enabled: stream.enabled,
        sync_mode: stream.syncMode,
        supported_sync_modes: manifestStream?.supportedSyncModes ?? ["full_refresh"],
        cursor_field: stream.cursorField,
        primary_key: stream.primaryKeyFields,
        row_count: rowCounts[stream.streamName] ?? 0,
        discovered_schema: stream.discoveredSchema as Json | null,
        pending_drift: stream.pendingDrift as Json | null,
        view_name: getLazyViewName(tenancy, sourceSlug(source.displayName, source.id), stream.streamName),
      };
    }),
  };
}

/**
 * Slug used in lazy view names. Derived from the display name so the view is
 * recognisable, with the source id's prefix appended so two sources of the same
 * connector cannot collide.
 */
export function sourceSlug(displayName: string, sourceId: string): string {
  const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  return `${base === "" ? "source" : base}_${sourceId.replace(/-/g, "").slice(0, 6)}`;
}

export async function updateSource(options: {
  tenancy: Tenancy,
  sourceId: string,
  displayName?: string,
  schedule?: { kind: string, value?: string | null },
  paused?: boolean,
}) {
  const source = await globalPrismaClient.dataSource.findUnique({
    where: { tenancyId_id: { tenancyId: options.tenancy.id, id: options.sourceId } },
  });
  if (source == null) throw new StatusError(StatusError.NotFound, "Data source not found.");

  const scheduleKind = options.schedule?.kind ?? source.scheduleKind;
  const scheduleValue = options.schedule === undefined
    ? source.scheduleValue
    : (options.schedule.value ?? null);
  if (options.schedule !== undefined) assertValidSchedule(scheduleKind, scheduleValue);

  const paused = options.paused ?? source.status === "PAUSED";

  await globalPrismaClient.dataSource.update({
    where: { tenancyId_id: { tenancyId: options.tenancy.id, id: options.sourceId } },
    data: {
      ...options.displayName != null ? { displayName: options.displayName } : {},
      scheduleKind,
      scheduleValue,
      // A paused source has no next slot at all, so pausing takes effect
      // immediately rather than after one more scheduled run.
      nextSyncAt: paused ? null : computeNextSyncAt(scheduleKind, scheduleValue, new Date()),
      ...options.paused === true ? { status: "PAUSED" as const } : {},
      ...options.paused === false && source.status === "PAUSED" ? { status: "HEALTHY" as const } : {},
    },
  });
}

export async function updateStreams(options: {
  tenancy: Tenancy,
  sourceId: string,
  streams: Array<{
    name: string,
    enabled?: boolean,
    sync_mode?: string,
    cursor_field?: string | null,
    primary_key?: string[] | null,
  }>,
}) {
  const source = await globalPrismaClient.dataSource.findUnique({
    where: { tenancyId_id: { tenancyId: options.tenancy.id, id: options.sourceId } },
    include: { streams: true },
  });
  if (source == null) throw new StatusError(StatusError.NotFound, "Data source not found.");
  const manifest = getRunnableConnectorOrThrow(source.connectorId);

  for (const update of options.streams) {
    const manifestStream = manifest.streams.find(entry => entry.name === update.name);
    if (manifestStream == null) continue;
    const existing = source.streams.find(stream => stream.streamName === update.name);
    const syncMode = update.sync_mode === "incremental" && manifestStream.supportedSyncModes.includes("incremental")
      ? "incremental"
      : update.sync_mode === "full_refresh" ? "full_refresh" : existing?.syncMode ?? "full_refresh";

    if (existing == null) {
      await globalPrismaClient.dataSourceStream.create({
        data: {
          tenancyId: options.tenancy.id,
          dataSourceId: options.sourceId,
          streamName: update.name,
          enabled: update.enabled ?? false,
          syncMode,
          cursorField: update.cursor_field ?? manifestStream.cursorField ?? null,
          primaryKeyFields: update.primary_key ?? manifestStream.primaryKey,
        },
      });
      continue;
    }

    // Switching a stream to incremental with a cursor already banked would skip
    // everything older than that mark, so the cursor is reset on a mode change.
    const modeChanged = syncMode !== existing.syncMode;
    await globalPrismaClient.dataSourceStream.update({
      where: { tenancyId_id: { tenancyId: options.tenancy.id, id: existing.id } },
      data: {
        ...update.enabled != null ? { enabled: update.enabled } : {},
        syncMode,
        ...update.cursor_field !== undefined ? { cursorField: update.cursor_field } : {},
        ...update.primary_key != null ? { primaryKeyFields: update.primary_key } : {},
        ...modeChanged ? { cursorValue: null } : {},
      },
    });
  }
}

export async function listSyncRuns(tenancy: Tenancy, sourceId: string, limit = 50) {
  const runs = await globalPrismaClient.dataSourceSyncRun.findMany({
    where: { tenancyId: tenancy.id, dataSourceId: sourceId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return runs.map(run => ({
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt?.toISOString() ?? null,
    duration_ms: run.finishedAt == null ? null : run.finishedAt.getTime() - run.startedAt.getTime(),
    rows_synced: run.rowsSynced,
    ticks: run.ticks,
    error: run.error,
  }));
}

/**
 * Disconnects a source: tombstones its imported rows, drops any lazy views it
 * created, then removes the row. Views are dropped BEFORE the source record
 * goes, because their names are derived from it — losing the record first would
 * strand the views with no way left to name them.
 */
export async function deleteSource(tenancy: Tenancy, sourceId: string) {
  const source = await globalPrismaClient.dataSource.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: sourceId } },
    include: { streams: true },
  });
  if (source == null) throw new StatusError(StatusError.NotFound, "Data source not found.");

  const slug = sourceSlug(source.displayName, source.id);
  for (const stream of source.streams) {
    await dropLazyView({ tenancy, sourceSlug: slug, stream: stream.streamName });
  }
  await markImportedRowsDeleted({ tenancy, sourceId });
  await globalPrismaClient.dataSource.delete({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: sourceId } },
  });
}

export async function createStreamView(tenancy: Tenancy, sourceId: string, streamName: string) {
  const source = await globalPrismaClient.dataSource.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: sourceId } },
    include: { streams: true },
  });
  if (source == null) throw new StatusError(StatusError.NotFound, "Data source not found.");
  const stream = source.streams.find(entry => entry.streamName === streamName);
  if (stream == null) throw new StatusError(StatusError.NotFound, "Stream not found on this data source.");

  const schema = stream.discoveredSchema as { fields?: Array<{ name: string }> } | null;
  const fields = (schema?.fields ?? []).map(field => field.name);
  const viewName = await createLazyView({
    tenancy,
    sourceId,
    sourceSlug: sourceSlug(source.displayName, source.id),
    stream: streamName,
    fields,
  });
  return { view_name: viewName };
}

export async function dropStreamView(tenancy: Tenancy, sourceId: string, streamName: string) {
  const source = await globalPrismaClient.dataSource.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: sourceId } },
  });
  if (source == null) throw new StatusError(StatusError.NotFound, "Data source not found.");
  await dropLazyView({
    tenancy,
    sourceSlug: sourceSlug(source.displayName, source.id),
    stream: streamName,
  });
}

/**
 * Resolves pending schema drift. Approving adopts the observed shape as the new
 * baseline; ignoring keeps the old baseline, so the same drift is reported again
 * next time rather than being suppressed forever.
 */
export async function resolveDrift(options: {
  tenancy: Tenancy,
  sourceId: string,
  streamName: string,
  action: "approve" | "ignore",
}) {
  const stream = await globalPrismaClient.dataSourceStream.findUnique({
    where: {
      tenancyId_dataSourceId_streamName: {
        tenancyId: options.tenancy.id,
        dataSourceId: options.sourceId,
        streamName: options.streamName,
      },
    },
  });
  if (stream == null) throw new StatusError(StatusError.NotFound, "Stream not found on this data source.");
  if (stream.pendingDrift == null) return;

  if (options.action === "ignore") {
    await globalPrismaClient.dataSourceStream.update({
      where: { tenancyId_id: { tenancyId: options.tenancy.id, id: stream.id } },
      data: { pendingDrift: Prisma.DbNull },
    });
    return;
  }

  const drift = stream.pendingDrift as {
    addedFields?: Array<{ name: string, type: string, presence: number }>,
    removedFields?: string[],
    changedFields?: Array<{ name: string, to: string }>,
  };
  const current = (stream.discoveredSchema ?? { fields: [], sampledRecords: 0 }) as {
    fields: Array<{ name: string, type: string, presence: number }>,
    sampledRecords: number,
  };
  const removed = new Set(drift.removedFields ?? []);
  const retyped = new Map((drift.changedFields ?? []).map(field => [field.name, field.to]));
  const nextFields = current.fields
    .filter(field => !removed.has(field.name))
    .map(field => retyped.has(field.name) ? { ...field, type: retyped.get(field.name)! } : field)
    .concat(drift.addedFields ?? []);

  await globalPrismaClient.dataSourceStream.update({
    where: { tenancyId_id: { tenancyId: options.tenancy.id, id: stream.id } },
    data: {
      discoveredSchema: { fields: nextFields, sampledRecords: current.sampledRecords } as unknown as Prisma.InputJsonValue,
      pendingDrift: Prisma.DbNull,
    },
  });
}

/** Re-runs discovery against live credentials, for the source's Schema tab. */
export async function rediscoverSource(tenancy: Tenancy, sourceId: string): Promise<DiscoveredStream[]> {
  const source = await globalPrismaClient.dataSource.findUnique({
    where: { tenancyId_id: { tenancyId: tenancy.id, id: sourceId } },
  });
  if (source == null) throw new StatusError(StatusError.NotFound, "Data source not found.");
  const manifest = getRunnableConnectorOrThrow(source.connectorId);
  const secrets = await decryptCredentials(source.encryptedCredentials);
  return await discoverStreams({
    manifest,
    config: (source.config ?? {}) as Record<string, string>,
    secrets,
  });
}

export function describeConnector(manifest: RunnableConnector) {
  return {
    id: manifest.id,
    display_name: manifest.displayName,
    description: manifest.description,
    category: manifest.category,
    auth_tier: manifest.authTier,
    secret_field_names: getSecretConfigFields(manifest).map(field => field.displayName),
    streams: manifest.streams.map(stream => ({
      name: stream.name,
      primary_key: stream.primaryKey,
      cursor_field: stream.cursorField ?? null,
      supported_sync_modes: stream.supportedSyncModes,
    })),
  };
}

import.meta.vitest?.test("source slugs are stable, safe, and collision-resistant", ({ expect }) => {
  expect(sourceSlug("My Stripe (prod)", "abcdef12-3456-7890-abcd-ef1234567890"))
    .toBe("my_stripe_prod_abcdef");
  // Two sources with the same name stay distinct.
  expect(sourceSlug("Stripe", "11111111-1111-1111-1111-111111111111"))
    .not.toBe(sourceSlug("Stripe", "22222222-2222-2222-2222-222222222222"));
  expect(sourceSlug("!!!", "abcdef12-3456-7890-abcd-ef1234567890")).toBe("source_abcdef");
});
