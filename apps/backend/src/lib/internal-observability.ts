import { getHexclaveServerApp } from "@/hexclave";
import type { Span } from "@hexclave/js";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { context } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";
import { getVerifiedCustomerRequestLinkTarget, runWithCustomerRequestObservability } from "./customer-request-observability";
import { runWithNodeTelemetrySuppressed } from "./node-telemetry-suppression";
import { isTelemetryIngestionPath } from "./telemetry-ingestion-paths";

export { isTelemetryIngestionPath } from "./telemetry-ingestion-paths";

const TRUSTED_SPAN_LINK_WRITER = Symbol.for("hexclave.analytics.trusted-span-link-writer.v1");

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
  request: Request,
  requestId: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  const requestPath = new URL(request.url).pathname;
  return await runWithCustomerRequestObservability(request, async () => {
    if (isTelemetryIngestionPath(requestPath)) {
      // Keep both boundaries. Standard OTel suppression covers instrumentation
      // sharing this @opentelemetry/core instance; the SDK runner enters the
      // hidden bridge's exact context manager so Prisma remains suppressed even
      // when Next.js evaluates the OTel API through another server chunk.
      return await runWithNodeTelemetrySuppressed(
        async () => await context.with(suppressTracing(context.active()), fn),
      );
    }

    // The detailed control-plane trace stays rooted in `internal`. The incoming
    // client span is attached as a verified link below, after auth resolves its
    // project and branch. Rooting here also guarantees that a sampled request
    // cannot name a locally sampled-out Next.js span as its parent.
    const span = getHexclaveServerApp().startSpan("hexclave.api.request", {
      // Do not pass `{ request }` into the internal SDK. The outer authenticated
      // boundary owns customer correlation, while this trace must not inherit
      // the customer's session, sampling decision, or hierarchy.
      root: true,
      data: {
        request_id: requestId,
        method: request.method,
        path: requestPath,
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
        const clientLink = getVerifiedCustomerRequestLinkTarget();
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
