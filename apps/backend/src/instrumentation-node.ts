import { getHexclaveServerApp } from "@/hexclave";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { hexclaveInstrumentation, type HexclaveNextInstrumentation } from "@hexclave/next/next";
import { context } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { initPerfStats } from "./lib/dev-perf-stats";
import { isNodeTelemetrySuppressed, registerNodeTelemetrySuppressionRunner } from "./lib/node-telemetry-suppression";
import { registerErrorSink } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection } from "@hexclave/shared/dist/utils/promises";

let instrumentation: ReturnType<typeof hexclaveInstrumentation> | null = null;

function getBackendInstrumentation() {
  const options = {
    // Instrumentation classes are the only provider-specific wiring required;
    // the SDK owns the OTel provider and converts their spans to native rows.
    instrumentations: [
      new PrismaInstrumentation(),
      ...getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          enabled: false,
        },
        "@opentelemetry/instrumentation-undici": {
          enabled: false,
        },
      }),
    ],
    // Customer request cookies and correlation labels belong to the customer's
    // project. Backend observability is intentionally rooted in `internal`.
    requestAttribution: false,
    // The backend-owned task-local flag survives Next.js server chunk copies;
    // standard OTel suppression remains the compatibility path for any other
    // instrumentation using this exact @opentelemetry/core instance.
    isTelemetrySuppressed: () => isNodeTelemetrySuppressed() || isTracingSuppressed(context.active()),
  };
  instrumentation ??= hexclaveInstrumentation(getHexclaveServerApp(), options);
  return instrumentation;
}

/**
 * Re-entrancy latch for the error sink below.
 *
 * `captureError` is called from inside the telemetry send path itself (a failed
 * batch POST reports through it), so a sink that captures unconditionally would
 * recurse: capture -> send -> fail -> capture. The OTel/task-local suppression
 * flag covers the instrumented call stack, but not a failure that surfaces on a
 * later microtask, which is exactly how an async send fails.
 */
let emittingCapturedError = false;

/**
 * Forwards Hexclave's OWN handled errors into its OWN error tracking.
 *
 * Without this, `captureError()` reaches only the console sink and Sentry. The
 * console sink produces a level=`error` `$log` row — with no stack and no
 * fingerprint, because `captureError` nicifies the error to a STRING before it
 * reaches `console.error`, and `installConsoleCapture` only stamps
 * `error_fingerprint` when it is handed a real `Error`. The net effect was that
 * the `internal` project accumulated error logs and never produced a single
 * Issue, i.e. we were not dogfooding the feature at all.
 *
 * Registered here rather than in `polyfills.tsx` (where the Sentry sink lives)
 * because the SDK's server app is Node-only, while polyfills also load on Edge.
 */
function registerCapturedErrorTelemetrySink(): void {
  registerErrorSink((location, error, level) => {
    // Warnings are not errors; routing them here would fill the Issues list
    // with things nobody intends to resolve.
    if (level !== "error") return;
    if (emittingCapturedError) return;
    if (isNodeTelemetrySuppressed()) return;

    emittingCapturedError = true;
    try {
      const instrumented = getBackendInstrumentation();
      // Deliberately not awaited and deliberately not reported on failure: the
      // original error has already been logged by the console sink, and
      // reporting a telemetry failure through `captureError` is the recursion
      // this latch exists to prevent.
      ignoreUnhandledRejection(instrumented.captureHandledError(error, { location }));
    } finally {
      emittingCapturedError = false;
    }
  });
}

export async function registerNodeInstrumentation(): Promise<void> {
  // Prisma instrumentation accesses the Node global alias during setup.
  globalThis.global = globalThis;
  const backendInstrumentation = getBackendInstrumentation();
  await backendInstrumentation.register();
  // Route modules can be evaluated from another Next.js server chunk. Hand
  // them the registered instance's closure instead of making them reconstruct
  // an SDK instance whose bridge context would not govern Prisma's provider.
  registerNodeTelemetrySuppressionRunner(
    backendInstrumentation.runWithTelemetrySuppressed,
  );

  // `process` is guaranteed here because this module is Node-only.
  process.title = `stack-backend:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")} (node/nextjs)`;
  registerCapturedErrorTelemetrySink();
  initPerfStats();
}

export async function captureNodeRequestError(
  ...args: Parameters<HexclaveNextInstrumentation["onRequestError"]>
): Promise<void> {
  await getBackendInstrumentation().onRequestError(...args);
}
