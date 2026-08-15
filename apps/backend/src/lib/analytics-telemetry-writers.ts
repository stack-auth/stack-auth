import { classifyTelemetrySignal, type LogLevel, type TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";
import { TELEMETRY_MAX_LOG_MESSAGE_BYTES, truncateUtf8Bytes } from "@hexclave/shared/dist/utils/analytics-wire";
import { createHash } from "crypto";
import { stripLoneSurrogates, type ClickHouseClient } from "./clickhouse";
import { computeGrouping, computeGroupingWithReadableConfigs, getGroupingHashProvenance } from "./issues/grouping";
import { readGroupingFingerprint } from "./issues/grouping-fingerprint";
import { resolveGroupingConfig, type GroupingConfigResolution, type GroupingRuntimeConfig } from "./issues/grouping-config";
import { serializeGroupingProvenance } from "./issues/grouping-provenance";
import type { IssueBatchDelta } from "./issues/issue-materialization-contract";
import { buildTelemetryResourceFields } from "./telemetry/resource";
import { scrubErrorIngestPayload } from "./error-ingest";
import { normalizeErrorEnvelope } from "@hexclave/shared/dist/utils/error-envelope";
import { writeTelemetryDestinations, type TelemetryWritePlan } from "./telemetry/write-plan";

export type BatchEventWireItem = {
  event_type: string,
  event_at_ms: number,
  data: unknown,
  /**
   * The ENCLOSING span this event happened inside, as W3C identity. Both fields
   * arrive together or not at all: an event is an instant, so unlike a span it has
   * no identity of its own and never roots a trace — an event outside any span
   * simply carries no trace at all, and is correlated by page view and session.
   */
  trace_id?: string,
  span_id?: string,
  /** CORRELATION: which `$page-view` span the event happened on. */
  page_view_span_id?: string,
  message?: string,
  level?: LogLevel,
};

export type BatchSignalContext = {
  projectId: string,
  branchId: string,
  userId: string | null,
  refreshTokenId: string | null,
  sessionReplayId: string | null,
  sessionReplaySegmentId: string | null,
  runtime: "browser" | "server",
  /**
   * Released analytics batches predate the resource envelope. They retain
   * nullable resource columns rather than being assigned an invented service
   * name; versioned batches always provide the structured resource.
   */
  resource: TelemetryResource | null,
  /**
   * The authenticated SDK ingestion path is always an SDK producer. Platform-
   * synthesized events use separate writers rather than masquerading as input
   * from this batch.
   */
  producer: "sdk",
  /** Environment-level grouping rollout settings; omitted means the default. */
  groupingConfig?: GroupingRuntimeConfig,
};

export type TelemetryLens = "product" | "observability";

export function getTelemetryLens(eventType: string): TelemetryLens {
  return classifyTelemetrySignal(eventType, "event").lens === "analytics"
    ? "product"
    : "observability";
}

export function getBatchDestinationDeduplicationToken(
  batchId: string,
  table: "analytics_internal.events" | "analytics_internal.logs" | "analytics_internal.telemetry" | "analytics_internal.spans",
): string {
  const canonicalTable = table === "analytics_internal.events" || table === "analytics_internal.logs"
    ? "analytics_internal.telemetry"
    : table;
  return `${batchId}:${canonicalTable}`;
}

/**
 * Deterministic identity for one occurrence.
 *
 * `analytics_internal.logs` has no natural key — no id, no ordinal — so before
 * this existed there was no way to keyset-paginate occurrences with equal
 * timestamps, and no way to make Postgres materialization exactly-once.
 *
 * Derived from `(batch_id, ordinal)` rather than randomly generated so that a
 * RETRIED batch produces byte-identical ids. That is what lets ClickHouse's
 * `insert_deduplication_token` and the Postgres materialization ledger agree
 * about which occurrences a batch contained: a random id would make the retry
 * look like new data to one of the two stores.
 */
export function computeOccurrenceId(batchId: string, ordinal: number): string {
  return createHash("sha256").update(`${batchId}:${ordinal}`, "utf8").digest("hex").slice(0, 32);
}

const NATIVE_EVENT_ID_RE = /^[0-9a-f]{32}$/iu;

function getNativeEventId(event: BatchEventWireItem): string | null {
  const eventId = readStringField(event.data, "event_id");
  return eventId !== null && NATIVE_EVENT_ID_RE.test(eventId) ? eventId.toLowerCase() : null;
}

function getOccurrenceId(event: BatchEventWireItem, batchId: string, ordinal: number): string {
  return getNativeEventId(event) ?? computeOccurrenceId(batchId, ordinal);
}

/**
 * Native SDK event batch after protocol-specific fields have been normalized
 * into the shared telemetry, log, and issue write inputs.
 */
export type NormalizedEventBatch = {
  productEvents: ReturnType<typeof buildBaseEventRow>[],
  logOccurrences: ReturnType<typeof buildLogRow>[],
  /** Empty unless the batch contained `$error` events. */
  issueInputs: IssueBatchDelta[],
};

export type NativeTelemetryWritePlan = TelemetryWritePlan<IssueBatchDelta>;

/**
 * `stripLoneSurrogates` is declared over `unknown` because it walks arbitrary
 * JSON. Here the input is statically a string, so this narrows the return
 * without a cast — ClickHouse rejects lone surrogates, so the strip is not
 * optional even for a field we control.
 */
function stripLoneSurrogatesInString(value: string): string {
  const sanitized = stripLoneSurrogates(value);
  if (typeof sanitized !== "string") throw new Error("Expected lone-surrogate normalization to preserve a string value");
  return sanitized;
}

function scrubBatchEvent(event: BatchEventWireItem): BatchEventWireItem {
  const result = scrubErrorIngestPayload(event.data);
  if (result.value === undefined) throw new Error("Telemetry event data could not be normalized for durable storage");
  return { ...event, data: result.value };
}

/**
 * The telemetry `data` column is typed ClickHouse JSON, which only stores
 * objects — but the released pre-versioned wire contract accepted ANY JSON
 * value as `data` (the legacy Postgres/String storage kept it verbatim), and
 * old SDKs embedded in customer apps keep that contract forever. Wrapping is
 * the leniency-preserving projection into the typed column: the original value
 * survives losslessly under a reserved key instead of 400ing the whole batch
 * or silently dropping the item. Versioned batches are validated to be plain
 * objects up front, so this is a no-op for them.
 */
function toStorableTelemetryData(data: unknown): unknown {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) return data;
  return { "$value": data };
}

function scrubBatchMessage(message: string): string {
  const result = scrubErrorIngestPayload(message);
  if (typeof result.value !== "string") throw new Error("Telemetry log message could not be normalized for durable storage");
  return result.value;
}

function serializeErrorEnvelope(data: unknown): string {
  const serialized = JSON.stringify(normalizeErrorEnvelope(data));
  return stripLoneSurrogatesInString(serialized);
}

function requireLogMessage(event: BatchEventWireItem): string {
  if (event.message === undefined) throw new Error("$log event is missing its validated message");
  return event.message;
}

function readField(data: unknown, key: string): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  return (data as Record<string, unknown>)[key];
}

function readBooleanField(data: unknown, key: string): boolean | null {
  const value = readField(data, key);
  return typeof value === "boolean" ? value : null;
}

function readStringField(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * Grouping output for one `$error` row, plus the columns derived from it.
 *
 * `computeGrouping` never throws and never returns an empty hash — it degrades
 * to a deterministic `sha256(type ‖ parameterizedMessage)` with
 * `variant: "degraded"`. That matters because the rollup materialized view
 * filters on `issue_hash != ''`, so an empty hash would silently drop the
 * occurrence out of every issue-level aggregate while leaving it visible in
 * `default.errors` — the worst of both worlds.
 */
type ErrorGroupingFields = {
  grouping: ReturnType<typeof computeGrouping>,
  columns: Record<string, unknown>,
};

/** One `$error` occurrence paired with its (single) grouping result. */
type GroupedErrorOccurrence = {
  event: BatchEventWireItem,
  grouping: ReturnType<typeof computeGrouping>,
  occurrenceId: string,
};

function buildErrorGroupingFields(event: BatchEventWireItem, context: Pick<BatchSignalContext, "runtime">, groupingConfig: GroupingConfigResolution): ErrorGroupingFields {
  const name = readStringField(event.data, "name") ?? "Error";
  const message = readStringField(event.data, "message") ?? "";
  const stack = readStringField(event.data, "stack");
  const synthetic = readBooleanField(event.data, "synthetic") === true;
  const level = event.level ?? "error";

  const grouping = computeGroupingWithReadableConfigs({
    type: name,
    message,
    stack,
    platform: context.runtime === "browser" ? "javascript" : "node",
    fingerprint: readGroupingFingerprint(event.data),
    synthetic,
  }, groupingConfig);
  const groupingProvenance = getGroupingHashProvenance(grouping);

  return {
    grouping,
    columns: {
      issue_hash: grouping.ownerHash,
      issue_hashes: [grouping.ownerHash, ...grouping.aliasHashes],
      issue_grouping_config: grouping.configId,
      issue_variant: grouping.variant,
      issue_grouping_provenance: serializeGroupingProvenance(groupingProvenance),
      grouping_degraded: grouping.variant === "degraded" ? 1 : 0,
      error_type: name,
      error_culprit: grouping.culprit,
      error_frames: JSON.stringify(grouping.frames),
      error_envelope: serializeErrorEnvelope(event.data),
      // Promoted out of `data` and stamped SERVER-side, so the batch route's
      // "log-fields" yup test — which forbids client-supplied `message`/`level`
      // on anything that is not `$log` — stays exactly as it is. No wire change.
      message: truncateUtf8Bytes(stripLoneSurrogatesInString(message), TELEMETRY_MAX_LOG_MESSAGE_BYTES),
      level,
    },
  };
}

/**
 * Compatibility projection for one canonical OTel error LogRecord. The OTel
 * receiver uses this seam so issue grouping remains one implementation while
 * canonical serialization/storage stays independent of the legacy batch wire.
 */
export function normalizeErrorOccurrence(
  event: BatchEventWireItem,
  context: {
    runtime: BatchSignalContext["runtime"],
    serviceName: string | null,
    deploymentEnvironmentName: string | null,
    groupingConfig?: GroupingRuntimeConfig,
  },
  batchId: string,
  ordinal: number,
): { columns: Record<string, unknown>, issueInput: IssueBatchDelta } {
  if (event.event_type !== "$error") throw new Error("normalizeErrorOccurrence requires a $error event");
  const errorFields = buildErrorGroupingFields(event, context, resolveGroupingConfig(context.groupingConfig));
  const issueInput = collectIssueInputs([{
    event,
    grouping: errorFields.grouping,
    occurrenceId: computeOccurrenceId(batchId, ordinal),
  }], context)[0];
  return {
    columns: {
      occurrence_id: computeOccurrenceId(batchId, ordinal),
      batch_id: batchId,
      ...errorFields.columns,
    },
    issueInput,
  };
}

/**
 * The columns every event-shaped row carries, i.e. exactly `EVENTS_COLUMNS`.
 *
 * Split from the logs-only fields below so the TYPE of a product-event row does
 * not gain optional keys that its destination table has no columns for. A
 * conditional spread would have widened both row types to the union, which the
 * compile-time drift guard in the tests correctly rejects.
 */
function buildBaseEventRow(event: BatchEventWireItem, context: BatchSignalContext) {
  {
    return {
      event_type: event.event_type,
      event_at: new Date(event.event_at_ms),
      data: stripLoneSurrogates(toStorableTelemetryData(event.data)),
      producer: context.producer,
      runtime: context.runtime,
      ...(context.resource === null ? {} : buildTelemetryResourceFields(context.resource)),
      project_id: context.projectId,
      branch_id: context.branchId,
      user_id: context.userId,
      team_id: null,
      refresh_token_id: context.refreshTokenId,
      session_replay_id: context.sessionReplayId,
      session_replay_segment_id: context.sessionReplaySegmentId,
      // Stored verbatim: the SDK owns span identity, so there is nothing to
      // compose here any more. `trace_id` is the ENCLOSING span's trace, not a
      // trace this event roots.
      trace_id: event.trace_id ?? null,
      span_id: event.span_id ?? null,
      page_view_span_id: event.page_view_span_id ?? null,
    };
  }
}

/**
 * A row destined for `analytics_internal.logs`, i.e. `LOGS_COLUMNS`.
 *
 * Occurrence identity is a logs-table concept: `events` and `span_events` share
 * the plain `EVENTS_COLUMNS` shape and have no such columns, so stamping these
 * unconditionally would send unknown fields to those tables.
 */
function buildLogRow(
  event: BatchEventWireItem,
  context: BatchSignalContext,
  occurrenceId: string,
  batchId: string,
  errorFields: ErrorGroupingFields | null,
) {
  const otelBase = buildBaseEventRow(event, context);
  return {
    ...otelBase,
    occurrence_id: occurrenceId,
    // Stored alongside `occurrence_id` because the latter is a one-way hash:
    // the reconciler needs to ask "which batches have no ledger row?", which
    // requires the batch id itself, not a digest of it.
    batch_id: batchId,
    body: JSON.stringify(event.event_type === "$log"
      ? { type: "string", value: stripLoneSurrogates(scrubBatchMessage(requireLogMessage(event))) }
      : { type: "null", value: null }),
    data: stripLoneSurrogates(toStorableTelemetryData(event.data)),
    level: event.event_type === "$log" ? event.level : "",
    error_envelope: "{}",
    ...errorFields?.columns ?? {},
  };
}

/**
 * Coalesces a batch's `$error` occurrences into at most one materialization
 * input per owning hash.
 *
 * Grouping by hash (not by event) is what keeps the Postgres write to a single
 * statement per batch: a 500-error batch typically yields 1–5 inputs, because
 * the SDK's own flood control already caps 10 per fingerprint per page view.
 * The `min`/`max` folding here is what lets the later `UPDATE` use
 * `LEAST`/`GREATEST`, which are commutative and therefore safe under concurrent
 * batches touching the same hot issue.
 *
 * Takes already-computed grouping results rather than the raw events, so
 * grouping runs exactly once per occurrence. Recomputing here would double the
 * cost of the one part of ingest that scales with error volume (a 50-frame
 * parse plus two SHA-256 passes each).
 */
function collectIssueInputs(grouped: readonly GroupedErrorOccurrence[], context: {
  runtime: BatchSignalContext["runtime"],
  serviceName: string | null,
  deploymentEnvironmentName: string | null,
}): IssueBatchDelta[] {
  const byHash = new Map<string, IssueBatchDelta>();

  for (const { event, grouping, occurrenceId } of grouped) {
    const eventAt = new Date(event.event_at_ms);
    const existing = byHash.get(grouping.ownerHash);
    if (existing !== undefined) {
      existing.count += 1;
      if (eventAt < existing.firstEventAt) existing.firstEventAt = eventAt;
      if (eventAt > existing.lastEventAt) existing.lastEventAt = eventAt;
      existing.aliasHashes = [...new Set([...existing.aliasHashes, ...grouping.aliasHashes])];
      const incomingProvenance = getGroupingHashProvenance(grouping);
      if (existing.groupingProvenance === undefined) {
        existing.groupingProvenance = incomingProvenance;
        continue;
      }
      for (const candidate of incomingProvenance) {
        const alreadyRecorded = existing.groupingProvenance.some((recorded) =>
          serializeGroupingProvenance([recorded]) === serializeGroupingProvenance([candidate])
        );
        if (!alreadyRecorded) existing.groupingProvenance.push(candidate);
      }
      continue;
    }
    const groupingProvenance = getGroupingHashProvenance(grouping);
    byHash.set(grouping.ownerHash, {
      ownerHash: grouping.ownerHash,
      aliasHashes: grouping.aliasHashes,
      occurrenceId,
      groupingConfigId: grouping.configId,
      groupingProvenance,
      type: readStringField(event.data, "name") ?? "Error",
      value: readStringField(event.data, "message") ?? "",
      culprit: grouping.culprit,
      platform: context.runtime === "browser" ? "javascript" : "node",
      count: 1,
      firstEventAt: eventAt,
      lastEventAt: eventAt,
      serviceName: context.serviceName,
      deploymentEnvironmentName: context.deploymentEnvironmentName,
      release: readStringField(event.data, "release"),
      level: event.level ?? readStringField(event.data, "level") ?? "error",
      // `handled` defaults to true when the SDK omitted it: an error we cannot
      // prove crashed the caller should not be reported as a crash.
      handled: readBooleanField(event.data, "handled") ?? true,
      // The fingerprint variant may be `custom` even when the captured value
      // was synthetic; preserve the mechanism fact independently of which hash
      // won.
      synthetic: readBooleanField(event.data, "synthetic") === true,
    });
  }

  return [...byHash.values()];
}

export function normalizeBatchEvents(
  events: BatchEventWireItem[],
  context: BatchSignalContext,
  batchId: string,
): NormalizedEventBatch {
  const groupingConfig = resolveGroupingConfig(context.groupingConfig);
  const grouped: GroupedErrorOccurrence[] = [];

  const productEvents: ReturnType<typeof buildBaseEventRow>[] = [];
  const logOccurrences: ReturnType<typeof buildLogRow>[] = [];

  events.forEach((rawEvent, ordinal) => {
    // Scrubbing is an error-pipeline control and must not touch product
    // analytics: customers expect $page-view/$click/custom-event data to be
    // stored byte-identical to what the SDK captured (e.g. exact-match URL
    // queries), and only durable-storage normalization (lone-surrogate
    // stripping, object wrapping) may be applied to it below.
    if (getTelemetryLens(rawEvent.event_type) === "product") {
      productEvents.push(buildBaseEventRow(rawEvent, context));
      return;
    }
    const event = scrubBatchEvent(rawEvent);
    const occurrenceId = getOccurrenceId(event, batchId, ordinal);
    const errorFields = event.event_type === "$error"
      ? buildErrorGroupingFields(event, context, groupingConfig)
      : null;
    if (errorFields !== null) {
      grouped.push({
        event,
        grouping: errorFields.grouping,
        occurrenceId,
      });
    }
    logOccurrences.push(buildLogRow(event, context, occurrenceId, batchId, errorFields));
  });

  return { productEvents, logOccurrences, issueInputs: collectIssueInputs(grouped, {
    runtime: context.runtime,
    serviceName: context.resource?.service.name ?? null,
    deploymentEnvironmentName: context.resource?.deploymentEnvironmentName ?? null,
  }) };
}

export function buildTelemetryWritePlan(
  normalized: NormalizedEventBatch,
  batchId: string,
): NativeTelemetryWritePlan {
  return {
    batchId,
    destinations: [{
      table: "analytics_internal.telemetry",
      values: [...normalized.productEvents, ...normalized.logOccurrences],
      deduplicationToken: getBatchDestinationDeduplicationToken(batchId, "analytics_internal.telemetry"),
    }],
    issueInputs: normalized.issueInputs,
  };
}

/**
 * Writes all event-shaped telemetry to one physical table. Taxonomy ownership
 * remains visible through event_type and the compatibility views; storage no
 * longer duplicates the large shared tenancy/time prefix.
 */
export async function insertBatchEvents(
  clickhouseClient: ClickHouseClient,
  plan: NativeTelemetryWritePlan,
): Promise<void> {
  await writeTelemetryDestinations(clickhouseClient, plan.destinations);
}
