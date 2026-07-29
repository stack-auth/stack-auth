import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { getEnvBoolean, getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { registerOTel } from "@vercel/otel";
import { AnalyticsLogExporter } from "./lib/self-telemetry-log-exporter";
import { AnalyticsSpanExporter } from "./lib/self-telemetry-span-exporter";
import { initPerfStats } from "./lib/dev-perf-stats";
import { installOtelConsoleCapture } from "./lib/otel-console-capture";
import { createBackendTraceSampler } from "./lib/otel-sampling";
import { WarnAndErrorLogRecordProcessor } from "./lib/self-telemetry-log-processor";
import { ErrorPromotingBatchSpanProcessor } from "./lib/self-telemetry-trace-processor";
import { TenancyRecordingSpanProcessor } from "./lib/self-telemetry-tenancy";

function createAnalyticsSpanProcessor(): ErrorPromotingBatchSpanProcessor | null {
  if (!getEnvBoolean("HEXCLAVE_SELF_TELEMETRY_ENABLED")) return null;
  return new ErrorPromotingBatchSpanProcessor(new AnalyticsSpanExporter(), {
    maxExportBatchSize: 500,
    scheduledDelayMillis: 1_000,
  });
}

function createAnalyticsLogProcessor(
  analyticsSpanProcessor: ErrorPromotingBatchSpanProcessor | null,
): LogRecordProcessor | null {
  if (!getEnvBoolean("HEXCLAVE_SELF_TELEMETRY_ENABLED")) return null;
  const batchProcessor = new BatchLogRecordProcessor(new AnalyticsLogExporter(), {
    maxQueueSize: 4096,
    maxExportBatchSize: 500,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30_000,
  });
  return new WarnAndErrorLogRecordProcessor(
    batchProcessor,
    (traceId) => analyticsSpanProcessor?.markTraceAsErrored(traceId),
  );
}

export async function registerNodeInstrumentation(): Promise<void> {
  // Prisma instrumentation accesses the Node global alias during setup.
  globalThis.global = globalThis;

  const analyticsSpanProcessor = createAnalyticsSpanProcessor();
  const analyticsLogProcessor = createAnalyticsLogProcessor(analyticsSpanProcessor);
  registerOTel({
    serviceName: "stack-backend",
    // RECORD-only spans are useful only while the error-promoting processor is
    // installed. When self telemetry is disabled, leave the provider's default
    // sampler intact so an unrelated production exporter does not silently
    // lose 90% of traces merely because this optional pipeline is off.
    ...analyticsSpanProcessor === null ? {} : { traceSampler: createBackendTraceSampler() },
    spanProcessors: [
      "auto",
      // Must be registered whenever the analytics exporter is: it records (at
      // span START, via a WeakMap sidecar) which request's tenancy holder was
      // ambient, which is what lets AnalyticsSpanExporter fan spans out to the
      // customer project that caused them instead of only "internal".
      ...analyticsSpanProcessor === null ? [] : [new TenancyRecordingSpanProcessor(), analyticsSpanProcessor],
    ],
    ...analyticsLogProcessor === null ? {} : { logRecordProcessor: analyticsLogProcessor },
    instrumentations: [
      new PrismaInstrumentation(),
      ...getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          enabled: false,
        },
      }),
    ],
    ...getNodeEnvironment() === "development" ? {
      traceExporter: new OTLPTraceExporter({
        url: `http://localhost:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")}31/v1/traces`,
      }),
    } : {},
  });

  // Unlike spans (fed by the auto-instrumentations above), NOTHING emits
  // through the OTel Logs API on its own — the backend logs via `console.*`.
  // Without this bridge the log processor registered above drains an empty
  // queue forever, so it is the log pipeline's sole record source. Installed
  // after registerOTel so the LoggerProvider it emits into is already the
  // registered global (the bridge would also tolerate the reverse order, since
  // it resolves the logger per emit).
  if (analyticsLogProcessor !== null) {
    installOtelConsoleCapture({
      onErrorTrace: (traceId) => analyticsSpanProcessor?.markTraceAsErrored(traceId),
    });
  }

  // `process` is guaranteed here because this module is Node-only.
  process.title = `stack-backend:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")} (node/nextjs)`;
  initPerfStats();
}
