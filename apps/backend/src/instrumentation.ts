import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import * as Sentry from "@sentry/nextjs";
import { getEnvVariable, getNextRuntime, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import { registerOTel } from '@vercel/otel';
import { initPerfStats } from "./lib/dev-perf-stats";
import "./polyfills";

// this is a hack for making prisma instrumentation work
// somehow prisma instrumentation accesses global and it makes edge instrumentation complain
globalThis.global = globalThis;

export async function register() {
  registerOTel({
    serviceName: 'stack-backend',
    instrumentations: [
      new PrismaInstrumentation(),
      ...getNextRuntime() === "nodejs" ? getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          enabled: false,
        },
      }) : [],
    ],
    ...getNodeEnvironment() === "development" && getNextRuntime() === "nodejs" ? {
      traceExporter: new OTLPTraceExporter({
        url: `http://localhost:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")}31/v1/traces`,
      }),
    } : {},
  });

  if (getNextRuntime() === "nodejs") {
    const portPrefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
    (globalThis as any).process.title = `stack-backend:${portPrefix} (node/nextjs)`;
    // Stash the local backend origin for in-process self-calls (AI proxy, etc.).
    // Turbopack workers sometimes see a stale/default NEXT_PUBLIC_HEXCLAVE_API_URL
    // of :8102 even when this process is listening on ${prefix}02.
    if (getNodeEnvironment() === "development") {
      (globalThis as any).__HEXCLAVE_DEV_BACKEND_ORIGIN__ = `http://localhost:${portPrefix}02`;
    }

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
