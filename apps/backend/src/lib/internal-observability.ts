import { getHexclaveServerApp } from "@/hexclave";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { context } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";
import type { NextRequest } from "next/server";
import { runWithCustomerRequestObservability } from "./customer-request-observability";
import { runWithNodeTelemetrySuppressed } from "./node-telemetry-suppression";
import { isTelemetryIngestionPath } from "./telemetry-ingestion-paths";

export { isTelemetryIngestionPath } from "./telemetry-ingestion-paths";

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
      // hidden bridge's exact context manager so Prisma remains suppressed even
      // when Next.js evaluates the OTel API through another server chunk.
      return await runWithNodeTelemetrySuppressed(
        async () => await context.with(suppressTracing(context.active()), fn),
      );
    }

    // The detailed control-plane trace stays in `internal`, but its W3C parent
    // still matches the safe customer bridge span written by the outer wrapper.
    return await getHexclaveServerApp().withSpan("hexclave.api.request", {
      // Pass the request explicitly instead of relying on the framework's
      // ambient request provider. The SDK uses this context to honor the
      // incoming W3C sampled flag before its local trace sampler runs.
      request,
      data: {
        request_id: requestId,
        method: request.method,
        path: request.nextUrl.pathname,
      },
    }, async (span) => {
      const response = await fn();
      // setData mutates the span synchronously before withSpan enqueues its final
      // row; the acknowledgement must not add an internal telemetry round-trip
      // to every customer request's latency.
      runAsynchronously(span.setData({
        status_code: response.status,
        ...response.status >= 500 ? { error: `HTTP ${response.status}` } : {},
      }), { noErrorLogging: true });
      return response;
    });
  });
}
