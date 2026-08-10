import { getHexclaveServerApp } from "@/hexclave";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { context, isSpanContextValid, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { suppressTracing, W3CTraceContextPropagator } from "@opentelemetry/core";
import type { NextRequest } from "next/server";
import { getVerifiedCustomerRequestLinkTarget, runWithCustomerRequestObservability } from "./customer-request-observability";
import type { Span, SpanContext } from "@hexclave/next";
import { runWithNodeTelemetrySuppressed } from "./node-telemetry-suppression";
import { isTelemetryIngestionPath } from "./telemetry-ingestion-paths";

export { isTelemetryIngestionPath } from "./telemetry-ingestion-paths";

const TRUSTED_SPAN_LINK_WRITER = Symbol.for("hexclave.analytics.trusted-span-link-writer.v1");
const traceContextPropagator = new W3CTraceContextPropagator();

function isInternalProjectRequest(request: NextRequest): boolean {
  return (request.headers.get("x-hexclave-project-id") ?? request.headers.get("x-stack-project-id")) === "internal";
}

function getIncomingParent(request: NextRequest): SpanContext | null {
  const extractedContext = traceContextPropagator.extract(ROOT_CONTEXT, request.headers, {
    keys: () => ["traceparent", "tracestate"],
    get: (carrier, key) => carrier.get(key) ?? undefined,
  });
  const incoming = trace.getSpanContext(extractedContext);
  if (
    incoming === undefined
    || !isSpanContextValid(incoming)
  ) return null;

  return {
    traceId: incoming.traceId,
    spanId: incoming.spanId,
    traceFlags: incoming.traceFlags,
    ...incoming.traceState === undefined ? {} : { traceState: incoming.traceState.serialize() },
  };
}

function addTrustedBackendSpanLink(span: Span, link: {
  traceId: string,
  spanId: string,
  projectId: string,
  branchId: string,
}): Promise<void> {
  if (!(TRUSTED_SPAN_LINK_WRITER in span)) {
    throw new Error("The internal request span does not support trusted target-scoped links");
  }
  const writer = span[TRUSTED_SPAN_LINK_WRITER];
  if (typeof writer !== "function") {
    throw new Error("The internal request span has an invalid trusted-link writer");
  }
  return writer({
    traceId: link.traceId,
    spanId: link.spanId,
    linkedProjectId: link.projectId,
    linkedBranchId: link.branchId,
  });
}

/**
 * Runs one backend API request inside the internal project's SDK span.
 *
 * Telemetry ingestion is the one excluded surface: the internal SDK delivers
 * through that same route, so tracing its Prisma work would produce another
 * telemetry batch forever. OTel suppression stays ambient for the full async
 * request, which lets Prisma's standard instrumentation skip itself without a
 * backend-specific exporter or instrumentation fork.
 */
export async function runWithInternalRequestObservability(
  request: NextRequest,
  requestId: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  return await runWithCustomerRequestObservability(request, async () => {
    if (isTelemetryIngestionPath(request.nextUrl.pathname)) {
      // Keep both boundaries. Standard OTel suppression covers instrumentation
      // sharing this @opentelemetry/core instance; the SDK runner enters the
      // registered provider's context manager so Prisma remains suppressed even
      // when Next.js evaluates the OTel API through another server chunk.
      return await runWithNodeTelemetrySuppressed(
        async () => await context.with(suppressTracing(context.active()), fn),
      );
    }

    // The internal dashboard is a normal OTel client of this backend: its
    // sampled browser span is the server span's explicit parent. We only take
    // this hierarchy for the internal project; customer requests retain the
    // separate internal trace plus verified cross-project link below, because
    // their incoming span may not exist in the internal project's read model.
    const internalProjectRequest = isInternalProjectRequest(request);
    const incomingParent = internalProjectRequest ? getIncomingParent(request) : null;
    const span = getHexclaveServerApp().startSpan("hexclave.api.request", {
      // Do not force a root when the wire carries no parent. Next/another OTel
      // server instrumentation may already have an active request span; the
      // SDK's server startSpan path inherits that context. Only when both the
      // wire parent and the active context are absent should this request root
      // a trace. Customer requests stay explicitly rooted below because their
      // internal trace is intentionally separate from the customer trace.
      ...internalProjectRequest
        ? incomingParent === null ? {} : { parent: incomingParent }
        : { root: true },
      data: {
        request_id: requestId,
        method: request.method,
        path: request.nextUrl.pathname,
      },
    });
    return await span.run(async () => {
      try {
        const response = await fn();
        // setData mutates the span synchronously before end enqueues its final row;
        // the acknowledgement must not add an internal telemetry round-trip
        // to every customer request's latency.
        runAsynchronously(span.setData({
          status_code: response.status,
          ...response.status >= 500 ? { error: `HTTP ${response.status}` } : {},
        }), { noErrorLogging: true });
        return response;
      } catch (error) {
        runAsynchronously(span.setData({
          error: error instanceof Error ? error.message : String(error),
        }), { noErrorLogging: true });
        throw error;
      } finally {
        const clientLink = internalProjectRequest ? null : getVerifiedCustomerRequestLinkTarget();
        if (clientLink !== null) {
          // The target scope comes from authenticated tenancy state, never from
          // a public wire field. Mutation happens synchronously before withSpan
          // ends, including when the authenticated handler throws; the
          // acknowledgement stays off the request's latency path.
          runAsynchronously(addTrustedBackendSpanLink(span, clientLink), { noErrorLogging: true });
        }
        runAsynchronously(span.end(), { noErrorLogging: true });
      }
    });
  });
}
