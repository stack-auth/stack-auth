import { CUSTOM_TELEMETRY_NAME_RE, isAnalyticsSystemEvent, isW3cSpanId, TELEMETRY_UUID_RE } from "@hexclave/shared/dist/utils/analytics-wire";
import { createHash } from "crypto";
import { stripLoneSurrogates, type ClickHouseClient } from "@/lib/clickhouse";
import { computeOccurrenceId, normalizeErrorOccurrence } from "@/lib/analytics-telemetry-writers";
import type { IssueBatchDelta } from "@/lib/issues/issue-materialization-contract";
import { attributesJson, dateFromUnixNano, productAttributes, scrubOtlpValue, stringAttribute, taggedValue, type OtlpTenantContext } from "./trace-writer";
import type { CanonicalOtlpLogRecord } from "./logs";
import { writeTelemetryDestinations, type TelemetryWriteDestination } from "@/lib/telemetry/write-plan";

/**
 * Log records carry the server-resolved rolling replay context. Keep this
 * explicit at the log-writer boundary so callers compiling against an older
 * trace-context declaration still see the log-specific field.
 */
type OtlpLogTenantContext = OtlpTenantContext & {
  sessionReplayId?: string | null,
};

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

export function getOtlpLogsDeduplicationToken(logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext): string {
  const batchId = getOtlpLogsBatchId(logs, tenant);
  return createHash("sha256").update(JSON.stringify({
    tenant: stableTenantIdentity(tenant),
    occurrenceIds: logs.map((log, ordinal) => getOtlpLogOccurrenceId(log, batchId, ordinal)),
  })).digest("hex");
}

function stableTenantIdentity(tenant: OtlpLogTenantContext): Pick<OtlpTenantContext, "projectId" | "branchId" | "userId" | "refreshTokenId"> {
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
  // Vanilla OTLP records and `$error` records without an event ID have no
  // natural identity, so derive a deterministic one from the record content;
  // the ordinal keeps equal records in one batch distinct. This string is only
  // hashed into the batch id / deduplication token, never persisted verbatim.
  return `derived:${ordinal}:${JSON.stringify({
    ...log,
    body: log.body === null ? null : taggedValue(log.body),
    attributes: attributesJson(log.attributes),
    resource: { ...log.resource, attributes: attributesJson(log.resource.attributes) },
    scope: { ...log.scope, attributes: attributesJson(log.scope.attributes) },
  })}`;
}

function getOtlpLogsBatchId(logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext): string {
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

export type OtlpLogInsertDestination = TelemetryWriteDestination & {
  suffix: "events",
};

/**
 * Plans one canonical physical write. Product-event and log/error projections
 * share the telemetry table, so one request has one ClickHouse deduplication
 * token while the HTTP route still reports rejected input records through OTLP
 * partialSuccess before this plan runs.
 */
export function buildOtlpLogInsertPlan(logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext): OtlpLogInsertDestination[] {
  if (logs.length === 0) return [];
  const requestToken = getOtlpLogsDeduplicationToken(logs, tenant);
  return [{
    table: "analytics_internal.events",
    values: buildOtlpLogRows(logs, tenant),
    suffix: "events",
    deduplicationToken: `${requestToken}:events`,
  }];
}

function errorProjection(log: CanonicalOtlpLogRecord, tenant: OtlpLogTenantContext, batchId: string, ordinal: number): {
  columns: Record<string, unknown>,
  issueInput: IssueBatchDelta,
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

export function buildOtlpLogRows(logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext) {
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
      session_replay_id: tenant.sessionReplayId ?? validUuidAttribute(log, "hexclave.session_replay.id"),
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

export type OtlpLogBillingDebit = {
  occurrenceId: string,
  eventAt: Date,
};

/**
 * Metering inputs for one accepted OTLP logs request. Every accepted projected
 * record is an analytics event (`$log`, `$error`, or a product event), so OTLP
 * must not become a quota bypass for any of them. Keyed by occurrence id so an
 * OTLP exporter retry (same content →
 * same batch id → same occurrence ids) collapses onto the same metering rows
 * instead of double-debiting.
 */
export function getOtlpLogBillingDebits(logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext): OtlpLogBillingDebit[] {
  const batchId = getOtlpLogsBatchId(logs, tenant);
  return logs.flatMap((log, ordinal) => {
    // Billing-wise only the projected event TYPE matters, so the (expensive)
    // error grouping projection is not computed here: a `$error`-classified
    // record and the `$log` fallback carry the same billing item.
    const eventNano = log.timeUnixNano === "0" ? log.observedTimeUnixNano : log.timeUnixNano;
    return [{
      occurrenceId: getOtlpLogOccurrenceId(log, batchId, ordinal),
      eventAt: dateFromUnixNano(eventNano, "log time"),
    }];
  });
}

export function buildOtlpIssueInputs(logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext): IssueBatchDelta[] {
  const batchId = getOtlpLogsBatchId(logs, tenant);
  return logs.flatMap((log, ordinal) => {
    const error = errorProjection(log, tenant, batchId, ordinal);
    return error === null ? [] : [error.issueInput];
  });
}

export function getOtlpIssueBatchId(logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext): string {
  return getOtlpLogsBatchId(logs, tenant);
}

export function buildOtlpProductEventRows(logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext) {
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

export async function insertOtlpLogs(client: ClickHouseClient, logs: CanonicalOtlpLogRecord[], tenant: OtlpLogTenantContext): Promise<void> {
  await writeTelemetryDestinations(client, buildOtlpLogInsertPlan(logs, tenant));
}
