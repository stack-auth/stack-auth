import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { getEnvBoolean, getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { registerOTel } from "@vercel/otel";
import { AnalyticsSpanExporter } from "./lib/analytics-span-exporter";
import { initPerfStats } from "./lib/dev-perf-stats";
import { createDevelopmentTraceSampler } from "./lib/otel-sampling";

function createAnalyticsSpanProcessor(): BatchSpanProcessor | null {
  if (!getEnvBoolean("HEXCLAVE_ANALYTICS_OTEL_EXPORT_ENABLED")) return null;
  return new BatchSpanProcessor(new AnalyticsSpanExporter(), {
    maxQueueSize: 4096,
    maxExportBatchSize: 500,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30_000,
  });
}

export async function registerNodeInstrumentation(): Promise<void> {
  // Prisma instrumentation accesses the Node global alias during setup.
  globalThis.global = globalThis;

  const analyticsSpanProcessor = createAnalyticsSpanProcessor();
  registerOTel({
    serviceName: "stack-backend",
    spanProcessors: [
      "auto",
      ...analyticsSpanProcessor === null ? [] : [analyticsSpanProcessor],
    ],
    instrumentations: [
      new PrismaInstrumentation(),
      ...getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          enabled: false,
        },
      }),
    ],
    ...getNodeEnvironment() === "development" ? {
      // The backend runs several high-frequency background loops. Sampling
      // unrelated roots keeps both local exporters below their bounded queue
      // capacity, while the parent-based sampler retains every sampled trace
      // arriving from the dashboard.
      traceSampler: createDevelopmentTraceSampler(),
      traceExporter: new OTLPTraceExporter({
        url: `http://localhost:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")}31/v1/traces`,
      }),
    } : {},
  });

  // `process` is guaranteed here because this module is Node-only.
  process.title = `stack-backend:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")} (node/nextjs)`;
  initPerfStats();
}
