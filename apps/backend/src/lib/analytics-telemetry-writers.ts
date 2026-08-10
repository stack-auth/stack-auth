import { classifyTelemetrySignal, type LogLevel, type TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";
import { TELEMETRY_MAX_LOG_MESSAGE_BYTES, truncateUtf8Bytes } from "@hexclave/shared/dist/utils/analytics-wire";
import { createHash } from "crypto";
import { stripLoneSurrogates, type ClickHouseClient } from "./clickhouse";
import { computeGrouping } from "./issues/grouping";
import { DEFAULT_GROUPING_CONFIG_ID, type GroupingConfigId } from "./issues/grouping-config";
import { buildTelemetryResourceFields } from "./telemetry-resource";

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
  resource: TelemetryResource,
  /**
   * The authenticated SDK ingestion path is always an SDK producer. Platform-
   * synthesized events use separate writers rather than masquerading as input
   * from this batch.
   */
  producer: "sdk",
};

export function getEventStorageTable(eventType: string): "analytics_internal.events" | "analytics_internal.logs" {
  return classifyTelemetrySignal(eventType, "event").lens === "analytics"
    ? "analytics_internal.events"
    : "analytics_internal.logs";
}

export function getBatchDestinationDeduplicationToken(
  batchId: string,
  table: "analytics_internal.events" | "analytics_internal.logs" | "analytics_internal.spans",
): string {
  return `${batchId}:${table}`;
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

/**
 * What the background materializer needs in order to create/advance an Issue,
 * already coalesced per owning hash by `normalizeBatchEvents`. Coalescing here
 * rather than per event is what keeps a 500-error batch down to a handful of
 * Postgres rows: the SDK's own flood control caps 10 per fingerprint per page
 * view, so N is typically 1–5.
 */
export type IssueMaterializationInput = {
  ownerHash: string,
  aliasHashes: string[],
  groupingConfigId: GroupingConfigId,
  type: string,
  value: string,
  culprit: string,
  platform: string,
  count: number,
  firstEventAt: Date,
  lastEventAt: Date,
  serviceName: string | null,
  deploymentEnvironmentName: string | null,
  release: string | null,
  level: string,
  /** Mechanism facts from the creating occurrence; persisted on the Issue row. */
  handled: boolean,
  synthetic: boolean,
};

/**
 * Protocol-neutral normalized event batch. The current native SDK wire
 * normalizer produces this shape; a future standards-complete OTLP normalizer
 * can target the same boundary without adding another ingestion/storage path.
 */
export type NormalizedEventBatch = {
  productEvents: ReturnType<typeof buildBaseEventRow>[],
  logOccurrences: ReturnType<typeof buildLogRow>[],
  /** Empty unless the batch contained `$error` events. */
  issueInputs: IssueMaterializationInput[],
};

/**
 * `stripLoneSurrogates` is declared over `unknown` because it walks arbitrary
 * JSON. Here the input is statically a string, so this narrows the return
 * without a cast — ClickHouse rejects lone surrogates, so the strip is not
 * optional even for a field we control.
 */
function stripLoneSurrogatesInString(value: string): string {
  const stripped = stripLoneSurrogates(value);
  return typeof stripped === "string" ? stripped : "";
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
};

function buildErrorGroupingFields(event: BatchEventWireItem, context: BatchSignalContext, configId: GroupingConfigId): ErrorGroupingFields {
  const name = readStringField(event.data, "name") ?? "Error";
  const message = readStringField(event.data, "message") ?? "";
  const stack = readStringField(event.data, "stack");
  const synthetic = typeof event.data === "object" && event.data !== null
    && (event.data as Record<string, unknown>).synthetic != null;

  const grouping = computeGrouping({
    type: name,
    message,
    stack,
    platform: context.runtime === "browser" ? "javascript" : "node",
    synthetic,
  }, configId);

  return {
    grouping,
    columns: {
      issue_hash: grouping.ownerHash,
      issue_hashes: [grouping.ownerHash, ...grouping.aliasHashes],
      issue_grouping_config: grouping.configId,
      issue_variant: grouping.variant,
      grouping_degraded: grouping.variant === "degraded" ? 1 : 0,
      error_type: name,
      error_culprit: grouping.culprit,
      error_frames: JSON.stringify(grouping.frames),
      // Promoted out of `data` and stamped SERVER-side, so the batch route's
      // "log-fields" yup test — which forbids client-supplied `message`/`level`
      // on anything that is not `$log` — stays exactly as it is. No wire change.
      message: truncateUtf8Bytes(stripLoneSurrogatesInString(message), TELEMETRY_MAX_LOG_MESSAGE_BYTES),
      level: "error",
    },
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
      data: stripLoneSurrogates(event.data),
      producer: context.producer,
      runtime: context.runtime,
      ...buildTelemetryResourceFields(context.resource),
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
  batchId: string,
  ordinal: number,
  errorFields: ErrorGroupingFields | null,
) {
  return {
    ...buildBaseEventRow(event, context),
    occurrence_id: computeOccurrenceId(batchId, ordinal),
    // Stored alongside `occurrence_id` because the latter is a one-way hash:
    // the reconciler needs to ask "which batches have no ledger row?", which
    // requires the batch id itself, not a digest of it.
    batch_id: batchId,
    message: event.event_type === "$log" ? stripLoneSurrogates(event.message) : "",
    level: event.event_type === "$log" ? event.level : "",
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
function collectIssueInputs(grouped: readonly GroupedErrorOccurrence[], context: BatchSignalContext): IssueMaterializationInput[] {
  const byHash = new Map<string, IssueMaterializationInput>();

  for (const { event, grouping } of grouped) {
    const eventAt = new Date(event.event_at_ms);
    const existing = byHash.get(grouping.ownerHash);
    if (existing !== undefined) {
      existing.count += 1;
      if (eventAt < existing.firstEventAt) existing.firstEventAt = eventAt;
      if (eventAt > existing.lastEventAt) existing.lastEventAt = eventAt;
      continue;
    }
    byHash.set(grouping.ownerHash, {
      ownerHash: grouping.ownerHash,
      aliasHashes: grouping.aliasHashes,
      groupingConfigId: grouping.configId,
      type: readStringField(event.data, "name") ?? "Error",
      value: readStringField(event.data, "message") ?? "",
      culprit: grouping.culprit,
      platform: context.runtime === "browser" ? "javascript" : "node",
      count: 1,
      firstEventAt: eventAt,
      lastEventAt: eventAt,
      serviceName: context.resource.service.name,
      deploymentEnvironmentName: context.resource.deploymentEnvironmentName ?? null,
      release: readStringField(event.data, "release"),
      level: "error",
      // `handled` defaults to true when the SDK omitted it: an error we cannot
      // prove crashed the caller should not be reported as a crash.
      handled: readBooleanField(event.data, "handled") ?? true,
      synthetic: grouping.variant === "message" && readField(event.data, "synthetic") != null,
    });
  }

  return [...byHash.values()];
}

export function normalizeBatchEvents(
  events: BatchEventWireItem[],
  context: BatchSignalContext,
  batchId: string,
): NormalizedEventBatch {
  const configId = DEFAULT_GROUPING_CONFIG_ID;
  const grouped: GroupedErrorOccurrence[] = [];

  const productEvents: ReturnType<typeof buildBaseEventRow>[] = [];
  const logOccurrences: ReturnType<typeof buildLogRow>[] = [];

  events.forEach((event, ordinal) => {
    if (getEventStorageTable(event.event_type) === "analytics_internal.events") {
      productEvents.push(buildBaseEventRow(event, context));
      return;
    }
    const errorFields = event.event_type === "$error"
      ? buildErrorGroupingFields(event, context, configId)
      : null;
    if (errorFields !== null) grouped.push({ event, grouping: errorFields.grouping });
    logOccurrences.push(buildLogRow(event, context, batchId, ordinal, errorFields));
  });

  return { productEvents, logOccurrences, issueInputs: collectIssueInputs(grouped, context) };
}

/**
 * Dispatches event-shaped telemetry by taxonomy ownership. Product events and
 * code occurrences deliberately share a wire contract, but never a storage
 * table or dashboard read model.
 */
export async function insertBatchEvents(
  clickhouseClient: ClickHouseClient,
  normalized: NormalizedEventBatch,
  batchId: string,
): Promise<void> {

  const insertRows = async (
    table: "analytics_internal.events" | "analytics_internal.logs",
    values: NormalizedEventBatch["productEvents"],
  ) => {
    if (values.length === 0) return;
    await clickhouseClient.insert({
      table,
      values,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        // A mixed wire batch becomes one insert per destination. Stable
        // destination tokens make retries safe when one table committed before
        // another failed.
        async_insert: 0,
        insert_deduplication_token: getBatchDestinationDeduplicationToken(batchId, table),
        // Dedup must reach the MATERIALIZED VIEWS, not just the source table.
        //
        // ClickHouse defaults this to 0, which means a retried batch is
        // correctly deduplicated in `analytics_internal.logs` while the blocks
        // the dependent views push into their targets are inserted again. For
        // `issue_occurrence_rollup` that shows up as an issue whose lifetime
        // `times_seen` (Postgres ledger) says 1 while its windowed
        // `window_occurrences` (ClickHouse) says 2 — the two counters visibly
        // disagreeing on the same list row.
        deduplicate_blocks_in_dependent_materialized_views: 1,
      },
    });
  };

  await Promise.all([
    insertRows("analytics_internal.events", normalized.productEvents),
    insertRows("analytics_internal.logs", normalized.logOccurrences),
  ]);
}
