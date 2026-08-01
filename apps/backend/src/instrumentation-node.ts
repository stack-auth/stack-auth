import { getHexclaveServerApp } from "@/hexclave";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { hexclaveInstrumentation, type HexclaveNextInstrumentation } from "@hexclave/next/next";
import { context } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { initPerfStats } from "./lib/dev-perf-stats";
import { isNodeTelemetrySuppressed, registerNodeTelemetrySuppressionRunner } from "./lib/node-telemetry-suppression";

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
  initPerfStats();
}

export async function captureNodeRequestError(
  ...args: Parameters<HexclaveNextInstrumentation["onRequestError"]>
): Promise<void> {
  await getBackendInstrumentation().onRequestError(...args);
}
