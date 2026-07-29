import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { SpanKind, SpanStatusCode, type Attributes, type HrTime } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { insertAnalyticsSpans, type AnalyticsSpanRow } from "./self-telemetry-spans";
import { DEFAULT_BRANCH_ID } from "./branch-constants";
import { stripLoneSurrogates } from "./clickhouse";
import { getRecordedTenancy, scrubSpanForCustomer, type ResolvedTelemetryTenancy } from "./self-telemetry-tenancy";

/** One tenant's slice of an export batch. `tenancy === null` means the span
 * had no resolved request tenancy and stays under project "internal". */
export type AnalyticsSpanExportGroup = {
  tenancy: ResolvedTelemetryTenancy | null,
  spans: AnalyticsSpanRow[],
};

export type AnalyticsSpanGroupWriter = (groups: AnalyticsSpanExportGroup[]) => Promise<void>;

// Floored (not rounded) so a span's version (its end time in ms) can never
// exceed the wall-clock ms it actually ended in.
export function hrTimeToMilliseconds(time: HrTime): number {
  return Math.floor(time[0] * 1_000 + time[1] / 1_000_000);
}

const SPAN_KIND_NAMES = new Map<SpanKind, string>([
  [SpanKind.INTERNAL, "internal"],
  [SpanKind.SERVER, "server"],
  [SpanKind.CLIENT, "client"],
  [SpanKind.PRODUCER, "producer"],
  [SpanKind.CONSUMER, "consumer"],
]);

const STATUS_CODE_NAMES = new Map<SpanStatusCode, string>([
  [SpanStatusCode.UNSET, "unset"],
  [SpanStatusCode.OK, "ok"],
  [SpanStatusCode.ERROR, "error"],
]);

/** Resource attribute keys promoted into dedicated ClickHouse columns; the
 * remainder is stored in the `resource_attributes` JSON blob. */
const PROMOTED_RESOURCE_ATTRIBUTES = [
  ["service.namespace", "service_namespace"],
  ["service.name", "service_name"],
  ["service.version", "service_version"],
  ["service.instance.id", "service_instance_id"],
  ["deployment.environment.name", "deployment_environment_name"],
] as const;

export function splitResourceAttributes(attributes: Attributes): {
  promoted: Record<(typeof PROMOTED_RESOURCE_ATTRIBUTES)[number][1], string | null>,
  remainderJson: string,
} {
  const remainder: Record<string, unknown> = { ...attributes };
  const promoted = Object.fromEntries(PROMOTED_RESOURCE_ATTRIBUTES.map(([attributeKey, columnName]) => {
    const value = remainder[attributeKey];
    // Only well-formed (string) identity values get promoted; anything else
    // stays in the blob so no information is silently dropped.
    if (typeof value !== "string" || value === "") return [columnName, null];
    delete remainder[attributeKey];
    return [columnName, value];
    // Object.fromEntries erases the key union; the explicit annotation on the
    // return type restores it, and the map above provably covers every key.
  })) as Record<(typeof PROMOTED_RESOURCE_ATTRIBUTES)[number][1], string | null>;
  return { promoted, remainderJson: attributesToJson(remainder) };
}

function attributesToJson(attributes: Record<string, unknown>): string {
  // JSON.stringify drops undefined-valued keys, which is exactly right for
  // OTel Attributes (undefined means "unset").
  return JSON.stringify(stripLoneSurrogates(attributes));
}

function attributesToData(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).flatMap(([key, value]) => value === undefined ? [] : [[key, stripLoneSurrogates(value)]]),
  );
}

/**
 * Expands each row's direct parent into the full root-first ancestry path,
 * resolving through parents present in the same export batch (the common case:
 * one request's spans flush together). Ancestors outside the batch stay as the
 * single known parent id — the read side treats parent_span_ids as "farthest
 * KNOWN ancestor first", not as a completeness guarantee.
 */
function expandParentSpanPaths(rows: AnalyticsSpanRow[]): void {
  const byTraceId = new Map<string, Map<string, AnalyticsSpanRow>>();
  for (const row of rows) {
    let trace = byTraceId.get(row.trace_id);
    if (trace === undefined) {
      trace = new Map();
      byTraceId.set(row.trace_id, trace);
    }
    if (trace.has(row.span_id)) {
      throw new HexclaveAssertionError("A span export batch must not contain the same span twice — the in-process tracer ends each span exactly once.", {
        traceId: row.trace_id,
        spanId: row.span_id,
      });
    }
    trace.set(row.span_id, row);
  }

  const expanded = new Map<AnalyticsSpanRow, string[]>();
  const resolving = new Set<AnalyticsSpanRow>();
  const resolve = (row: AnalyticsSpanRow): string[] => {
    const cached = expanded.get(row);
    if (cached !== undefined) return cached;
    if (resolving.has(row)) {
      throw new HexclaveAssertionError("A span export batch must not contain a parent cycle — the in-process tracer can only parent a span on an already-started span.", {
        traceId: row.trace_id,
        spanId: row.span_id,
      });
    }
    resolving.add(row);
    const directParentId = row.parent_span_ids.at(0);
    let result: string[] = [];
    if (directParentId !== undefined) {
      // Span ids from the tracer are unique only within a trace; never resolve
      // a parent through another trace of the same batch.
      const parent = byTraceId.get(row.trace_id)?.get(directParentId);
      result = parent === undefined ? [directParentId] : [...resolve(parent), directParentId];
    }
    resolving.delete(row);
    expanded.set(row, result);
    return result;
  };

  for (const row of rows) row.parent_span_ids = resolve(row);
}

/**
 * Builds native ClickHouse span rows DIRECTLY from the tracer's completed
 * spans — no wire-protocol round-trip. Returns exactly one row per input span,
 * index-aligned (groupSpansByTenancy relies on that alignment).
 *
 * Input is the backend's own in-process tracer, i.e. trusted: unlike the
 * retired public trace-ingest endpoint there is no id/limit re-validation
 * here — ids come straight from the tracer's span contexts.
 */
export function buildAnalyticsSpanRows(spans: ReadableSpan[]): AnalyticsSpanRow[] {
  const rows = spans.map((span): AnalyticsSpanRow => {
    const spanContext = span.spanContext();
    const endedAtMs = hrTimeToMilliseconds(span.endTime);
    const { promoted, remainderJson } = splitResourceAttributes(span.resource.attributes);
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      span_type: span.name,
      started_at: new Date(hrTimeToMilliseconds(span.startTime)),
      ended_at: new Date(endedAtMs),
      parent_span_ids: span.parentSpanId == null || span.parentSpanId === "" ? [] : [span.parentSpanId],
      kind: SPAN_KIND_NAMES.get(span.kind) ?? throwErr(`Unknown span kind on exported span: ${span.kind}`),
      status_code: STATUS_CODE_NAMES.get(span.status.code) ?? throwErr(`Unknown span status code on exported span: ${span.status.code}`),
      status_message: span.status.message == null || span.status.message === "" ? null : span.status.message,
      service_namespace: promoted.service_namespace,
      service_name: promoted.service_name,
      service_version: promoted.service_version,
      service_instance_id: promoted.service_instance_id,
      deployment_environment_name: promoted.deployment_environment_name,
      resource_attributes: remainderJson,
      scope_name: span.instrumentationLibrary.name,
      scope_version: span.instrumentationLibrary.version ?? null,
      data: attributesToJson(span.attributes),
      producer: "hexclave-backend",
      events: span.events.map((event) => ({
        name: event.name,
        at: new Date(hrTimeToMilliseconds(event.time)),
        data: attributesToData(event.attributes ?? {}),
      })),
      links: span.links.map((link) => ({
        linked_trace_id: link.context.traceId,
        linked_span_id: link.context.spanId,
        attributes: attributesToJson(link.attributes ?? {}),
      })),
      // The row carrying the latest end time wins in the ReplacingMergeTree —
      // matches the wire-era behavior (version = end timestamp in ms).
      version: endedAtMs,
    };
  });
  expandParentSpanPaths(rows);
  return rows;
}

/**
 * Groups an export batch by the tenancy recorded (via
 * TenancyRecordingSpanProcessor) for each span. Row building happens once for
 * the whole batch because parent-path expansion needs to see sibling spans;
 * buildAnalyticsSpanRows guarantees 1:1 index alignment.
 */
export function groupSpansByTenancy(spans: ReadableSpan[]): AnalyticsSpanExportGroup[] {
  const rows = buildAnalyticsSpanRows(spans);
  const groups = new Map<string, AnalyticsSpanExportGroup>();
  for (const [index, span] of spans.entries()) {
    const tenancy = getRecordedTenancy(span);
    const key = tenancy === null ? "" : JSON.stringify([tenancy.projectId, tenancy.branchId, tenancy.userId, tenancy.refreshTokenId, tenancy.sessionReplayId, tenancy.sessionReplaySegmentId]);
    const group = groups.get(key) ?? (() => {
      const created: AnalyticsSpanExportGroup = { tenancy, spans: [] };
      groups.set(key, created);
      return created;
    })();
    group.spans.push(rows[index]);
  }
  return [...groups.values()];
}

/**
 * Default writer: unresolved spans keep today's behavior (project "internal",
 * full data); tenant-resolved spans additionally land — SCRUBBED (see
 * scrubSpanForCustomer) — in the customer's project with the trusted identity
 * columns, which is what connects a customer's browser trace to the backend
 * request it caused. Any group failure rejects the whole export so the batch
 * processor observes the failure (fail loud, no partial-success lies).
 */
async function writeAnalyticsSpanGroups(groups: AnalyticsSpanExportGroup[]): Promise<void> {
  await Promise.all(groups.map(async (group) => {
    if (group.tenancy === null) {
      await insertAnalyticsSpans({ spans: group.spans, projectId: "internal", branchId: DEFAULT_BRANCH_ID });
    } else {
      // Requests authenticated against project "internal" (the dashboard's own
      // traffic) keep full data — scrubbing exists to hide Hexclave
      // internals from CUSTOMERS, and hiding them from ourselves would gut
      // internal observability. They still gain the identity columns, which is
      // what links dashboard sessions to backend traces (the dogfood path).
      const isInternalProject = group.tenancy.projectId === "internal";
      await insertAnalyticsSpans({
        spans: isInternalProject ? group.spans : group.spans.map(scrubSpanForCustomer),
        projectId: group.tenancy.projectId,
        branchId: group.tenancy.branchId,
        userId: group.tenancy.userId,
        refreshTokenId: group.tenancy.refreshTokenId,
        sessionReplayId: group.tenancy.sessionReplayId,
        sessionReplaySegmentId: group.tenancy.sessionReplaySegmentId,
      });
    }
  }));
}

function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error("Failed to export backend spans to Analytics", { cause: error });
}

/** Writes the backend's completed self-instrumentation spans into Hexclave's
 * native Analytics span model. */
export class AnalyticsSpanExporter implements SpanExporter {
  constructor(private readonly writeGroups: AnalyticsSpanGroupWriter = writeAnalyticsSpanGroups) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    (async () => await this.writeGroups(groupSpansByTenancy(spans)))().then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      (error: unknown) => resultCallback({ code: ExportResultCode.FAILED, error: errorFromUnknown(error) }),
    );
  }

  async shutdown(): Promise<void> {}
}
