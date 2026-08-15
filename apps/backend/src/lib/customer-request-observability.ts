import { decodeCorrelationBaggage, readBaggageHeader } from "@hexclave/shared/dist/utils/span-context-codec";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { isSpanContextValid, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { RandomIdGenerator } from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSharedClickhouseAdminClient } from "./clickhouse";
import { insertSpans, type SpanInsertRow } from "./spans";
import { isTelemetryIngestionPath } from "./telemetry-ingestion-paths";

const idGenerator = new RandomIdGenerator();
const traceContextPropagator = new W3CTraceContextPropagator();

type CustomerRequestTenancy = {
  projectId: string,
  branchId: string,
  userId: string | null,
  refreshTokenId: string | null,
  sessionReplayId: string | null,
  sessionReplaySegmentId: string | null,
  pageViewSpanId: string | null,
};

type CustomerRequestObservabilityHolder = {
  /** Incoming W3C trace supplied by any interoperable upstream tracer. */
  incomingTraceId: string | null,
  /** Fresh trace used when there is no sampled incoming parent. */
  rootTraceId: string,
  spanId: string,
  /** The span named by the sampled incoming `traceparent`. */
  incomingParentSpanId: string | null,
  startedAt: Date,
  method: string,
  tenancy: CustomerRequestTenancy | null,
};

export type VerifiedCustomerRequestLinkTarget = {
  traceId: string,
  spanId: string,
  projectId: string,
  branchId: string,
};

type CustomerRequestSpanWriter = (row: SpanInsertRow) => Promise<void>;

const customerRequestStorage = new AsyncLocalStorage<CustomerRequestObservabilityHolder>();

function mergeTrustedIdentity(
  current: string | null,
  incoming: string | null,
  field: "userId" | "refreshTokenId",
): string | null {
  if (current !== null && incoming !== null && current !== incoming) {
    throw new Error(`Customer request observability ${field} changed within one request`);
  }
  return incoming ?? current;
}

/**
 * Resolves the customer tenancy for the request span after route authentication.
 *
 * The outer request boundary starts before authentication so it can preserve the
 * incoming W3C parent. This function fills the same mutable ALS holder once the
 * server has verified the project and session. OAuth refresh endpoints learn the
 * user/session later than ordinary access-token routes, so a second same-project
 * call may enrich null identity fields but may never replace a non-null value.
 */
export function resolveCustomerRequestObservability(options: {
  projectId: string,
  branchId: string,
  userId: string | null,
  refreshTokenId: string | null,
  headers?: { get: (name: string) => string | null },
}): void {
  const holder = customerRequestStorage.getStore();
  if (holder === undefined) return;

  const current = holder.tenancy;
  if (current !== null && (current.projectId !== options.projectId || current.branchId !== options.branchId)) {
    throw new Error("Customer request observability tenancy changed within one request");
  }

  const labels = options.headers === undefined
    ? null
    : decodeCorrelationBaggage(readBaggageHeader(options.headers));

  holder.tenancy = {
    projectId: options.projectId,
    branchId: options.branchId,
    userId: mergeTrustedIdentity(current?.userId ?? null, options.userId, "userId"),
    refreshTokenId: mergeTrustedIdentity(current?.refreshTokenId ?? null, options.refreshTokenId, "refreshTokenId"),
    sessionReplayId: current?.sessionReplayId ?? labels?.sessionReplayId ?? null,
    sessionReplaySegmentId: current?.sessionReplaySegmentId ?? labels?.sessionReplaySegmentId ?? null,
    pageViewSpanId: current?.pageViewSpanId ?? labels?.pageViewSpanId ?? null,
  };
}

/**
 * Returns the exact incoming client span only after route authentication proved
 * which project and branch own it. The internal request span uses this as a
 * cross-project link; callers outside the request ALS scope get null.
 */
export function getVerifiedCustomerRequestLinkTarget(): VerifiedCustomerRequestLinkTarget | null {
  const holder = customerRequestStorage.getStore();
  if (
    holder === undefined
    || holder.tenancy === null
    || holder.incomingTraceId === null
    || holder.incomingParentSpanId === null
  ) return null;
  return {
    traceId: holder.incomingTraceId,
    spanId: holder.incomingParentSpanId,
    projectId: holder.tenancy.projectId,
    branchId: holder.tenancy.branchId,
  };
}

function buildCustomerRequestSpan(
  holder: CustomerRequestObservabilityHolder,
  tenancy: CustomerRequestTenancy,
  response: Response,
  endedAt: Date,
): SpanInsertRow {
  return {
    trace_id: holder.incomingParentSpanId !== null
      ? holder.incomingTraceId ?? throwErr("An incoming parent must carry an incoming trace id")
      : holder.rootTraceId,
    span_id: holder.spanId,
    parent_span_id: holder.incomingParentSpanId,
    span_type: "hexclave.api.request",
    billing_item: null,
    started_at: holder.startedAt,
    ended_at: endedAt,
    data: JSON.stringify({
      method: holder.method,
      status_code: response.status,
    }),
    kind: "server",
    // Typed OTel status is independent of the numeric HTTP status in `data`.
    status_code: response.status >= 400 ? "error" : "ok",
    status_message: null,
    service_namespace: null,
    service_name: "hexclave-backend",
    service_version: null,
    service_instance_id: null,
    deployment_environment_name: null,
    resource_attributes: "{}",
    scope_name: null,
    scope_version: null,
    // Platform-generated request spans are customer-visible context, not SDK
    // writes by the customer, and must never consume their span quota.
    producer: "hexclave-backend",
    project_id: tenancy.projectId,
    branch_id: tenancy.branchId,
    user_id: tenancy.userId,
    team_id: null,
    refresh_token_id: tenancy.refreshTokenId,
    session_replay_id: tenancy.sessionReplayId,
    session_replay_segment_id: tenancy.sessionReplaySegmentId,
    page_view_span_id: tenancy.pageViewSpanId,
    version: endedAt.getTime(),
  };
}

async function writeCustomerRequestSpan(row: SpanInsertRow): Promise<void> {
  await insertSpans(getSharedClickhouseAdminClient(), [row]);
}

/**
 * Preserves the incoming trace at the outer request boundary, then writes one
 * scrubbed request span into the authenticated customer project after the
 * response is known. The backend's detailed dogfood trace remains in `internal`;
 * this row is the safe bridge that makes the customer's HTTP client span and the
 * backend tier one trace without exposing SQL, headers, or internal attributes.
 *
 * Any sampled W3C parent is inherited, including a parent stored by another
 * vendor. Trace readers must therefore treat a missing local parent as an
 * external boundary instead of rewriting the trace.
 */
export async function runWithCustomerRequestObservability(
  request: Request,
  fn: () => Promise<Response>,
  writer: CustomerRequestSpanWriter = writeCustomerRequestSpan,
): Promise<Response> {
  if (isTelemetryIngestionPath(new URL(request.url).pathname)) return await fn();

  const extractedContext = traceContextPropagator.extract(ROOT_CONTEXT, request.headers, {
    keys: () => ["traceparent", "tracestate"],
    get: (carrier, key) => carrier.get(key) ?? undefined,
  });
  const extractedSpanContext = trace.getSpanContext(extractedContext);
  // An unsampled W3C context does not promise that its parent was recorded.
  // Storing our child under it would recreate the exact missing-parent rows the
  // trace reader cannot resolve, so treat it like no incoming hierarchy.
  const incomingParent = extractedSpanContext !== undefined
    && isSpanContextValid(extractedSpanContext)
    && (extractedSpanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED
    ? extractedSpanContext
    : null;
  const holder: CustomerRequestObservabilityHolder = {
    incomingTraceId: incomingParent?.traceId ?? null,
    rootTraceId: idGenerator.generateTraceId(),
    spanId: idGenerator.generateSpanId(),
    incomingParentSpanId: incomingParent?.spanId ?? null,
    startedAt: new Date(),
    method: request.method,
    tenancy: null,
  };

  return await customerRequestStorage.run(holder, async () => {
    const response = await fn();
    const tenancy = holder.tenancy;
    // The `internal` project is the one tenancy that also receives the DETAILED
    // request span from `internal-observability` (same name, same parent, same
    // trace, plus request_id/path and the Prisma subtree). Writing the scrubbed
    // bridge row there too put two identical-looking `hexclave.api.request`
    // siblings under every client fetch in our own dashboard. The bridge exists
    // to give a CUSTOMER project a safe view of work it cannot otherwise see;
    // where the full span is already visible it is pure duplication.
    if (tenancy !== null && tenancy.projectId !== "internal") {
      const row = buildCustomerRequestSpan(holder, tenancy, response, new Date());
      runAsynchronously(writer(row));
    }
    return response;
  });
}
