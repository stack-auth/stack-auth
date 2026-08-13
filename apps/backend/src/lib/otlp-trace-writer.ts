import { isW3cSpanId, TELEMETRY_UUID_RE, type TelemetrySpanKind, type TelemetrySpanStatusCode } from "@hexclave/shared/dist/utils/analytics-wire";
import { createHash } from "crypto";
import { stripLoneSurrogates, type ClickHouseClient } from "./clickhouse";
import { type CanonicalOtlpSpan, type OtlpAttributes, type OtlpAttributeValue } from "./otlp-traces";
import { insertSpanLinks, insertSpans, type SpanInsertRow, type SpanLinkInsertRow } from "./spans";
import type { GroupingRuntimeConfig } from "./issues/grouping-config";
import { scrubErrorIngestPayload } from "./error-ingest";

// The product read model predates an explicit "unspecified" kind. OTel kind 0
// is projected as internal while the canonical numeric meaning remains
// recoverable from the accepted OTLP contract and all other kinds map 1:1.
const SPAN_KINDS: readonly TelemetrySpanKind[] = ["internal", "internal", "server", "client", "producer", "consumer"];
const STATUS_CODES: readonly TelemetrySpanStatusCode[] = ["unset", "ok", "error"];

export type OtlpTenantContext = {
  projectId: string,
  branchId: string,
  userId: string | null,
  refreshTokenId: string | null,
  /** Server-resolved rolling replay; authenticated context wins over OTLP attributes. */
  sessionReplayId?: string | null,
  /** Server-owned rollout setting; never trust a client-provided grouping id. */
  groupingConfig?: GroupingRuntimeConfig,
};

type SpanEventInsertRow = {
  event_type: string,
  event_at: Date,
  data: unknown,
  producer: "sdk",
  runtime: "server",
  project_id: string,
  branch_id: string,
  user_id: string | null,
  team_id: null,
  refresh_token_id: string | null,
  session_replay_id: string | null,
  session_replay_segment_id: string | null,
  trace_id: string,
  span_id: string,
  page_view_span_id: string | null,
  service_namespace: string | null,
  service_name: string | null,
  service_version: string | null,
  service_instance_id: string | null,
  deployment_environment_name: string | null,
  resource_attributes: string,
  event_ordinal: number,
  time_unix_nano: string,
  attributes: string,
  dropped_attributes: number,
};

export function taggedValue(value: OtlpAttributeValue): unknown {
  if (value.type === "kvlist") return { type: value.type, value: taggedAttributes(value.value) };
  if (value.type === "array") return { type: value.type, value: value.value.map(taggedValue) };
  return value;
}

export function taggedAttributes(attributes: OtlpAttributes): Record<string, unknown> {
  return Object.fromEntries([...attributes].map(([key, value]) => [key, taggedValue(value)]));
}

export function productValue(value: OtlpAttributeValue): unknown {
  if (value.type === "kvlist") return productAttributes(value.value);
  if (value.type === "array") return value.value.map(productValue);
  if (value.type === "int") {
    const numeric = Number(value.value);
    return Number.isSafeInteger(numeric) ? numeric : value.value;
  }
  return value.value;
}

export function productAttributes(attributes: OtlpAttributes): Record<string, unknown> {
  return Object.fromEntries([...attributes].map(([key, value]) => [key, productValue(value)]));
}

function customSpanData(attributes: OtlpAttributes): Record<string, unknown> | null {
  const value = attributes.get("hexclave.data");
  if (value?.type !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed))
    : null;
}

export function attributesJson(attributes: OtlpAttributes): string {
  const scrubbed = scrubErrorIngestPayload(taggedAttributes(attributes));
  if (scrubbed.value === undefined) throw new Error("OTLP attributes could not be normalized for durable storage");
  return JSON.stringify(stripLoneSurrogates(scrubbed.value));
}

export function scrubOtlpValue(value: unknown, label: string): unknown {
  const scrubbed = scrubErrorIngestPayload(value);
  if (scrubbed.value === undefined) throw new Error(`${label} could not be normalized for durable storage`);
  return scrubbed.value;
}

export function stringAttribute(attributes: OtlpAttributes, key: string): string | null {
  const value = attributes.get(key);
  return value?.type === "string" ? value.value : null;
}

function rawProductSpanData(span: CanonicalOtlpSpan): Record<string, unknown> {
  const customData = customSpanData(span.attributes);
  if (customData !== null) return customData;
  return productAttributes(span.attributes);
}

export function getOtlpSpanPolicyData(span: CanonicalOtlpSpan): unknown {
  return rawProductSpanData(span);
}

function productSpanData(span: CanonicalOtlpSpan): unknown {
  return span.policyScrubbedData ?? rawProductSpanData(span);
}

function validUuidAttribute(attributes: OtlpAttributes, key: string): string | null {
  const value = stringAttribute(attributes, key);
  return value !== null && TELEMETRY_UUID_RE.test(value) ? value : null;
}

function validSpanIdAttribute(attributes: OtlpAttributes, key: string): string | null {
  const value = stringAttribute(attributes, key);
  return isW3cSpanId(value) ? value : null;
}

export function dateFromUnixNano(value: string, field: string): Date {
  const millis = Number(BigInt(value) / 1_000_000n);
  const date = new Date(millis);
  if (!Number.isSafeInteger(millis) || Number.isNaN(date.getTime())) {
    throw new Error(`${field} is outside the supported timestamp range`);
  }
  return date;
}

function resourceFields(span: CanonicalOtlpSpan) {
  return {
    service_namespace: stringAttribute(span.resource.attributes, "service.namespace"),
    service_name: stringAttribute(span.resource.attributes, "service.name"),
    service_version: stringAttribute(span.resource.attributes, "service.version"),
    service_instance_id: stringAttribute(span.resource.attributes, "service.instance.id"),
    deployment_environment_name: stringAttribute(span.resource.attributes, "deployment.environment.name"),
    resource_attributes: attributesJson(span.resource.attributes),
  };
}

export function buildOtlpTraceRows(spans: CanonicalOtlpSpan[], tenant: OtlpTenantContext): {
  spans: SpanInsertRow[],
  events: SpanEventInsertRow[],
  links: SpanLinkInsertRow[],
} {
  const spanRows: SpanInsertRow[] = [];
  const eventRows: SpanEventInsertRow[] = [];
  const linkRows: SpanLinkInsertRow[] = [];
  for (const span of spans) {
    const resources = resourceFields(span);
    const sessionReplayId = validUuidAttribute(span.attributes, "hexclave.session_replay.id");
    const sessionReplaySegmentId = validUuidAttribute(span.attributes, "hexclave.session_replay.segment.id");
    const pageViewSpanId = validSpanIdAttribute(span.attributes, "hexclave.page_view.span_id");
    spanRows.push({
      trace_id: span.traceId,
      span_id: span.spanId,
      span_type: span.name,
      billing_item: span.attributes.get("hexclave.signal.type")?.type === "string"
        && span.attributes.get("hexclave.signal.type")?.value === "custom_span"
        ? "analytics_spans"
        : null,
      started_at: dateFromUnixNano(span.startTimeUnixNano, "startTimeUnixNano"),
      // 0 = the open-span marker (see the normalizer): the span has not ended
      // yet, so ended_at stays NULL and version 0 lets the end-write replace
      // this row.
      ended_at: span.endTimeUnixNano === "0" ? null : dateFromUnixNano(span.endTimeUnixNano, "endTimeUnixNano"),
      parent_span_id: span.parentSpanId,
      trace_state: span.traceState,
      trace_flags: span.flags,
      start_time_unix_nano: span.startTimeUnixNano,
      end_time_unix_nano: span.endTimeUnixNano,
      kind: SPAN_KINDS[span.kind],
      status_code: STATUS_CODES[span.status.code],
      status_message: span.status.message === "" ? null : span.status.message,
      ...resources,
      resource_dropped_attributes: span.resource.droppedAttributesCount,
      resource_schema_url: span.resource.schemaUrl,
      scope_name: span.scope.name === "" ? null : span.scope.name,
      scope_version: span.scope.version === "" ? null : span.scope.version,
      scope_attributes: attributesJson(span.scope.attributes),
      scope_dropped_attributes: span.scope.droppedAttributesCount,
      scope_schema_url: span.scope.schemaUrl,
      attributes: attributesJson(span.attributes),
      dropped_attributes: span.droppedAttributesCount,
      dropped_events: span.droppedEventsCount,
      dropped_links: span.droppedLinksCount,
      data: JSON.stringify(stripLoneSurrogates(scrubOtlpValue(productSpanData(span), "OTLP span data"))),
      producer: "sdk",
      project_id: tenant.projectId,
      branch_id: tenant.branchId,
      user_id: tenant.userId,
      team_id: null,
      refresh_token_id: tenant.refreshTokenId,
      session_replay_id: sessionReplayId,
      session_replay_segment_id: sessionReplaySegmentId,
      page_view_span_id: pageViewSpanId,
      version: span.endTimeUnixNano,
    });
    eventRows.push(...span.events.map((event, eventOrdinal) => ({
      event_type: event.name,
      event_at: dateFromUnixNano(event.timeUnixNano, "event.timeUnixNano"),
      data: stripLoneSurrogates(scrubOtlpValue(productAttributes(event.attributes), "OTLP span event data")),
      producer: "sdk" as const,
      runtime: "server" as const,
      project_id: tenant.projectId,
      branch_id: tenant.branchId,
      user_id: tenant.userId,
      team_id: null,
      refresh_token_id: tenant.refreshTokenId,
      session_replay_id: sessionReplayId,
      session_replay_segment_id: sessionReplaySegmentId,
      trace_id: span.traceId,
      span_id: span.spanId,
      page_view_span_id: pageViewSpanId,
      ...resources,
      event_ordinal: eventOrdinal,
      time_unix_nano: event.timeUnixNano,
      attributes: attributesJson(event.attributes),
      dropped_attributes: event.droppedAttributesCount,
    })));
    linkRows.push(...span.links.map((link) => {
      const linkedProjectId = tenant.projectId === "internal"
        ? stringAttribute(link.attributes, "hexclave.linked.project.id") ?? tenant.projectId
        : tenant.projectId;
      const linkedBranchId = tenant.projectId === "internal"
        ? stringAttribute(link.attributes, "hexclave.linked.branch.id") ?? tenant.branchId
        : tenant.branchId;
      return {
        project_id: tenant.projectId,
        branch_id: tenant.branchId,
        trace_id: span.traceId,
        owner_span_id: span.spanId,
        linked_trace_id: link.traceId,
        linked_span_id: link.spanId,
        linked_project_id: linkedProjectId,
        linked_branch_id: linkedBranchId,
        linked_trace_state: link.traceState === "" ? null : link.traceState,
        linked_trace_flags: link.flags,
        attributes: attributesJson(link.attributes),
        dropped_attributes: link.droppedAttributesCount,
      };
    }));
  }
  return { spans: spanRows, events: eventRows, links: linkRows };
}

export function getOtlpTraceDeduplicationToken(canonicalSpans: CanonicalOtlpSpan[], tenant: OtlpTenantContext): string {
  const rows = buildOtlpTraceRows(canonicalSpans, tenant);
  // Rollout policy is server-owned interpretation state, not a property of the
  // OTLP batch. It must not change the ClickHouse retry token while a policy is
  // being rolled out; otherwise the same exporter retry can be inserted twice.
  const stableTenant = {
    projectId: tenant.projectId,
    branchId: tenant.branchId,
    userId: tenant.userId,
    refreshTokenId: tenant.refreshTokenId,
  };
  return createHash("sha256").update(JSON.stringify({ tenant: stableTenant, rows })).digest("hex");
}

export async function insertOtlpTraces(client: ClickHouseClient, canonicalSpans: CanonicalOtlpSpan[], tenant: OtlpTenantContext): Promise<void> {
  const rows = buildOtlpTraceRows(canonicalSpans, tenant);
  // OTLP exporters retry failed exports. Hash the canonical, authenticated
  // write so an identical retry uses the same ClickHouse block token on every
  // destination; resource-provided tenant claims cannot influence this key.
  const requestToken = getOtlpTraceDeduplicationToken(canonicalSpans, tenant);
  await Promise.all([
    insertSpans(client, rows.spans, { deduplicationToken: `${requestToken}:spans` }),
    insertSpanLinks(client, rows.links, { deduplicationToken: `${requestToken}:span-links` }),
    rows.events.length === 0 ? Promise.resolve() : client.insert({
      table: "analytics_internal.span_events",
      values: rows.events,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 0,
        wait_for_async_insert: 1,
        insert_deduplication_token: `${requestToken}:span-events`,
        deduplicate_blocks_in_dependent_materialized_views: 1,
      },
    }),
  ]);
}
