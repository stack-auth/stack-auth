import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import * as Sentry from "@sentry/nextjs";
import { getEnvVariable, getNextRuntime, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { sentryBaseConfig } from "@stackframe/stack-shared/dist/utils/sentry";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import { initPerfStats } from "./lib/dev-perf-stats";
import "./polyfills";

// this is a hack for making prisma instrumentation work
// somehow prisma instrumentation accesses global and it makes edge instrumentation complain
globalThis.global = globalThis;

function getOTelInstrumentations() {
  return [
    new PrismaInstrumentation(),
    ...getNextRuntime() === "nodejs" ? getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        enabled: false,
      },
    }) : [],
  ];
}

function getDevTraceExporter() {
  if (getNodeEnvironment() === "development" && getNextRuntime() === "nodejs") {
    return new OTLPTraceExporter({
      url: `http://localhost:${getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81")}31/v1/traces`,
    });
  }
  return undefined;
}

async function registerOTelProvider() {
  const instrumentations = getOTelInstrumentations();
  const devExporter = getDevTraceExporter();

  if (getEnvVariable("VERCEL", "")) {
    // On Vercel: use @vercel/otel which wraps the standard OTEL SDK with Vercel-specific defaults
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({
      serviceName: 'stack-backend',
      instrumentations,
      ...devExporter ? { traceExporter: devExporter } : {},
    });
  } else {
    // On Cloud Run / self-hosted: use standard @opentelemetry/sdk-node
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const otelEndpoint = getEnvVariable("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    const exporter = devExporter ?? (otelEndpoint ? new OTLPTraceExporter({ url: otelEndpoint }) : undefined);
    const sdk = new NodeSDK({
      serviceName: 'stack-backend',
      instrumentations,
      // Cast needed: @opentelemetry/exporter-trace-otlp-http may be a different major than sdk-node,
      // but the runtime interface is compatible
      ...(exporter ? { traceExporter: exporter as any } : {}),
    });
    sdk.start();
  }
}

export async function register() {
  await registerOTelProvider();

  if (getNextRuntime() === "nodejs") {
    (globalThis as any).process.title = `stack-backend:${getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81")} (node/nextjs)`;

    // Initialize performance stats collection in development
    initPerfStats();
  }

  if (getNextRuntime() === "nodejs" || getNextRuntime() === "edge") {
    Sentry.init({
      ...sentryBaseConfig,

      dsn: getEnvVariable("NEXT_PUBLIC_SENTRY_DSN", ""),

      enabled: getNodeEnvironment() !== "development" && !getEnvVariable("CI", ""),

      // Add exception metadata to the event
      beforeSend(event, hint) {
        const error = hint.originalException;
        let nicified;
        try {
          nicified = nicify(error, { maxDepth: 8 });
        } catch (e) {
          nicified = `Error occurred during nicification: ${e}`;
        }
        if (error instanceof Error) {
          event.extra = {
            ...event.extra,
            cause: error.cause,
            errorProps: {
              ...error,
            },
            nicifiedError: nicified,
          };
        }
        return event;
      },
    });

  }
}
