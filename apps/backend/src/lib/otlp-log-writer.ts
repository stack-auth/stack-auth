import { CUSTOM_TELEMETRY_NAME_RE, isAnalyticsSystemEvent, isW3cSpanId, TELEMETRY_UUID_RE } from "@hexclave/shared/dist/utils/analytics-wire";
import { createHash } from "crypto";
import { stripLoneSurrogates, type ClickHouseClient } from "./clickhouse";
import { computeOccurrenceId, normalizeErrorOccurrence, type IssueMaterializationInput } from "./analytics-telemetry-writers";
import { attributesJson, dateFromUnixNano, productAttributes, scrubOtlpValue, stringAttribute, taggedValue, type OtlpTenantContext } from "./otlp-trace-writer";
import type { CanonicalOtlpLogRecord } from "./otlp-logs";

function severityLevel(number: number, text: string): string {
  if (text !== "") return text.toLowerCase();
  if (number >= 21) return "fatal";
  if (number >= 17) return "error";
  if (number >= 13) return "warn";
  if (number >= 9) return "info";
  if (number >= 5) return "debug";
  if (number >= 1) return "trace";
  return "";
}

// Mirrors the name half of getHexclaveOtlpLogContractError: a product event is
// a known analytics system event ($click, $form-submit, …) or a valid custom
// name. Origin gating already happened at the route's contract check, so the
// writer only classifies. Keep the two in lockstep — a name the contract
// accepts but this rejects silently misfiles the record as a $log line.
function isProductEventName(eventName: string): boolean {
  return isAnalyticsSystemEvent(eventName) || CUSTOM_TELEMETRY_NAME_RE.test(eventName);
}

function rawProductData(log: CanonicalOtlpLogRecord): unknown {
  return log.errorEnvelope !== null
    ? productAttributes(log.errorEnvelope.fields)
    : (() => {
      const value = log.attributes.get("hexclave.data");
      return value?.type === "kvlist" ? productAttributes(value.value) : productAttributes(log.attributes);
    })();
}

export function getOtlpLogPolicyData(log: CanonicalOtlpLogRecord): unknown {
  return rawProductData(log);
}

function productData(log: CanonicalOtlpLogRecord): unknown {
  return scrubOtlpValue(log.policyScrubbedData ?? rawProductData(log), "OTLP product data");
}

function validUuidAttribute(log: CanonicalOtlpLogRecord, key: string): string | null {
  const value = stringAttribute(log.attributes, key);
  return value !== null && TELEMETRY_UUID_RE.test(value) ? value : null;
}

export function getOtlpLogsDeduplicationToken(logs: CanonicalOtlpLogRecord[], tenant: OtlpTenantContext): string {
  const batchId = getOtlpLogsBatchId(logs, tenant);
  return createHash("sha256").update(JSON.stringify({
    tenant: stableTenantIdentity(tenant),
    occurrenceIds: logs.map((log, ordinal) => getOtlpLogOccurrenceId(log, batchId, ordinal)),
  })).digest("hex");
}

function stableTenantIdentity(tenant: OtlpTenantContext): Pick<OtlpTenantContext, "projectId" | "branchId" | "userId" | "refreshTokenId"> {
  // Grouping rollout settings are server policy, not batch identity. Including
  // them here would make a retry during a config transition write the same
  // OTLP batch under a second ClickHouse deduplication token.
  return {
    projectId: tenant.projectId,
    branchId: tenant.branchId,
    userId: tenant.userId,
    refreshTokenId: tenant.refreshTokenId,
  };
}

function getOtlpLogIdentity(log: CanonicalOtlpLogRecord, ordinal: number): string {
  if (log.errorEnvelope?.identityError === null && log.errorEnvelope.eventId !== null) {
    // Event IDs are the client-owned identity. The rest of the payload may be
    // enriched by a retrying producer without creating a second occurrence.
    return `event:${log.errorEnvelope.eventId}`;
  }
  // Vanilla OTLP and legacy flat errors without an event ID have no natural
  // identity. Keep their old deterministic content fallback, but include the
  // ordinal so equal records in one batch remain distinct.
  return `legacy:${ordinal}:${JSON.stringify({
    ...log,
    body: log.body === null ? null : taggedValue(log.body),
    attributes: attributesJson(log.attributes),
    resource: { ...log.resource, attributes: attributesJson(log.resource.attributes) },
    scope: { ...log.scope, attributes: attributesJson(log.scope.attributes) },
  })}`;
}

function getOtlpLogsBatchId(logs: CanonicalOtlpLogRecord[], tenant: OtlpTenantContext): string {
  const hash = createHash("sha256").update(JSON.stringify({
    tenant: stableTenantIdentity(tenant),
    identities: logs.map(getOtlpLogIdentity),
  })).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function getOtlpLogOccurrenceId(log: CanonicalOtlpLogRecord, batchId: string, ordinal: number): string {
  if (log.errorEnvelope?.identityError === null && log.errorEnvelope.eventId !== null) return log.errorEnvelope.eventId;
  return computeOccurrenceId(batchId, ordinal);
}

export type OtlpLogInsertDestination = {
  table: "analytics_internal.logs" | "analytics_internal.events",
  values: unknown[],
  suffix: "canonical-logs" | "product-events",
  deduplicationToken: string,
};

/**
 * Plans the two physical writes separately. ClickHouse deduplicates by the
 * destination token, so a retry can safely replay only the destination that
 * failed after the other one committed. This is the OTLP equivalent of
 * Relay's item-level processing boundary; the HTTP route still reports
 * rejected input records through OTLP partialSuccess before this plan runs.
 */
export function buildOtlpLogInsertPlan(logs: CanonicalOtlpLogRecord[], tenant: OtlpTenantContext): OtlpLogInsertDestination[] {
  if (logs.length === 0) return [];
  const requestToken = getOtlpLogsDeduplicationToken(logs, tenant);
  const destinations: OtlpLogInsertDestination[] = [
    {
      table: "analytics_internal.logs",
      values: buildOtlpLogRows(logs, tenant),
      suffix: "canonical-logs",
      deduplicationToken: `${requestToken}:canonical-logs`,
    },
    {
      table: "analytics_internal.events",
      values: buildOtlpProductEventRows(logs, tenant),
      suffix: "product-events",
      deduplicationToken: `${requestToken}:product-events`,
    },
  ];
  return destinations.filter((destination) => destination.values.length > 0);
}

function errorProjection(log: CanonicalOtlpLogRecord, tenant: OtlpTenantContext, batchId: string, ordinal: number): {
  columns: Record<string, unknown>,
  issueInput: IssueMaterializationInput,
} | null {
  if (stringAttribute(log.attributes, "hexclave.signal.type") !== "error" || log.eventName !== "$error") return null;
  const eventNano = log.timeUnixNano === "0" ? log.observedTimeUnixNano : log.timeUnixNano;
  const pageViewSpanId = stringAttribute(log.attributes, "hexclave.page_view.span_id");
  const normalized = normalizeErrorOccurrence({
    event_type: "$error",
    event_at_ms: dateFromUnixNano(eventNano, "error time").getTime(),
    data: productData(log),
    ...log.traceId === null || log.spanId === null ? {} : { trace_id: log.traceId, span_id: log.spanId },
    ...isW3cSpanId(pageViewSpanId)
      ? { page_view_span_id: pageViewSpanId }
      : {},
  }, {
    runtime: tenant.userId === null ? "server" : "browser",
    serviceName: stringAttribute(log.resource.attributes, "service.name"),
    deploymentEnvironmentName: stringAttribute(log.resource.attributes, "deployment.environment.name"),
    groupingConfig: tenant.groupingConfig,
  }, batchId, ordinal);
  return {
    columns: {
      ...normalized.columns,
      // The grouping/materialization adapter still consumes the flat error
      // fields, but the occurrence row must retain the SDK event identity.
      occurrence_id: getOtlpLogOccurrenceId(log, batchId, ordinal),
    },
    issueInput: {
      ...normalized.issueInput,
      occurrenceId: getOtlpLogOccurrenceId(log, batchId, ordinal),
    },
  };
}

export function buildOtlpLogRows(logs: CanonicalOtlpLogRecord[], tenant: OtlpTenantContext) {
  const batchId = getOtlpLogsBatchId(logs, tenant);
  return logs.map((log, ordinal) => {
    const eventNano = log.timeUnixNano === "0" ? log.observedTimeUnixNano : log.timeUnixNano;
    const signalType = stringAttribute(log.attributes, "hexclave.signal.type");
    const error = errorProjection(log, tenant, batchId, ordinal);
    return {
      // The physical logs table is canonical for every OTel LogRecord. Product
      // markers select compatibility views/projections; an arbitrary vanilla
      // OTel eventName alone never changes product taxonomy.
      event_type: signalType === "event" && isProductEventName(log.eventName)
        ? log.eventName
        : error === null ? "$log" : "$error",
      event_at: dateFromUnixNano(eventNano, "log time"),
      level: severityLevel(log.severityNumber, log.severityText),
      data: stripLoneSurrogates(productData(log)),
      producer: "sdk" as const,
      runtime: tenant.userId === null ? "server" as const : "browser" as const,
      project_id: tenant.projectId,
      branch_id: tenant.branchId,
      user_id: tenant.userId ?? validUuidAttribute(log, "hexclave.user.id"),
      team_id: null,
      refresh_token_id: tenant.refreshTokenId ?? validUuidAttribute(log, "hexclave.refresh_token.id"),
      session_replay_id: validUuidAttribute(log, "hexclave.session_replay.id"),
      session_replay_segment_id: validUuidAttribute(log, "hexclave.session_replay.segment.id"),
      trace_id: log.traceId,
      span_id: log.spanId,
      page_view_span_id: isW3cSpanId(stringAttribute(log.attributes, "hexclave.page_view.span_id"))
        ? stringAttribute(log.attributes, "hexclave.page_view.span_id")
        : null,
      service_namespace: stringAttribute(log.resource.attributes, "service.namespace"),
      service_name: stringAttribute(log.resource.attributes, "service.name"),
      service_version: stringAttribute(log.resource.attributes, "service.version"),
      service_instance_id: stringAttribute(log.resource.attributes, "service.instance.id"),
      deployment_environment_name: stringAttribute(log.resource.attributes, "deployment.environment.name"),
      resource_attributes: attributesJson(log.resource.attributes),
      occurrence_id: getOtlpLogOccurrenceId(log, batchId, ordinal),
      batch_id: batchId,
      time_unix_nano: log.timeUnixNano,
      observed_time_unix_nano: log.observedTimeUnixNano,
      severity_number: log.severityNumber,
      severity_text: log.severityText,
      otel_event_name: log.eventName,
      body: log.body === null ? "" : JSON.stringify(scrubOtlpValue(taggedValue(log.body), "OTLP log body")),
      attributes: attributesJson(log.attributes),
      dropped_attributes: log.droppedAttributesCount,
      trace_flags: log.flags,
      resource_dropped_attributes: log.resource.droppedAttributesCount,
      resource_schema_url: log.resource.schemaUrl,
      scope_name: log.scope.name === "" ? null : log.scope.name,
      scope_version: log.scope.version === "" ? null : log.scope.version,
      scope_attributes: attributesJson(log.scope.attributes),
      scope_dropped_attributes: log.scope.droppedAttributesCount,
      scope_schema_url: log.scope.schemaUrl,
      ...error === null ? {} : error.columns,
    };
  });
}

export function buildOtlpIssueInputs(logs: CanonicalOtlpLogRecord[], tenant: OtlpTenantContext): IssueMaterializationInput[] {
  const batchId = getOtlpLogsBatchId(logs, tenant);
  return logs.flatMap((log, ordinal) => {
    const error = errorProjection(log, tenant, batchId, ordinal);
    return error === null ? [] : [error.issueInput];
  });
}

export function getOtlpIssueBatchId(logs: CanonicalOtlpLogRecord[], tenant: OtlpTenantContext): string {
  return getOtlpLogsBatchId(logs, tenant);
}

export function buildOtlpProductEventRows(logs: CanonicalOtlpLogRecord[], tenant: OtlpTenantContext) {
  const canonicalRows = buildOtlpLogRows(logs, tenant);
  return logs.flatMap((sourceLog, index) => {
    if (stringAttribute(sourceLog.attributes, "hexclave.signal.type") !== "event" || !isProductEventName(sourceLog.eventName)) return [];
    const row = canonicalRows[index];
    return {
      event_type: sourceLog.eventName,
      event_at: row.event_at,
      data: stripLoneSurrogates(productData(sourceLog)),
      producer: row.producer,
      runtime: row.runtime,
      project_id: row.project_id,
      branch_id: row.branch_id,
      user_id: row.user_id,
      team_id: row.team_id,
      refresh_token_id: row.refresh_token_id,
      session_replay_id: row.session_replay_id,
      session_replay_segment_id: row.session_replay_segment_id,
      trace_id: row.trace_id,
      span_id: row.span_id,
      page_view_span_id: row.page_view_span_id,
      service_namespace: row.service_namespace,
      service_name: row.service_name,
      service_version: row.service_version,
      service_instance_id: row.service_instance_id,
      deployment_environment_name: row.deployment_environment_name,
      resource_attributes: row.resource_attributes,
    };
  });
}

export async function insertOtlpLogs(client: ClickHouseClient, logs: CanonicalOtlpLogRecord[], tenant: OtlpTenantContext): Promise<void> {
  await Promise.all(buildOtlpLogInsertPlan(logs, tenant).map(async (destination) => await client.insert({
    table: destination.table,
    values: destination.values,
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: 0,
      wait_for_async_insert: 1,
      insert_deduplication_token: destination.deduplicationToken,
      deduplicate_blocks_in_dependent_materialized_views: 1,
    },
  })));
}
