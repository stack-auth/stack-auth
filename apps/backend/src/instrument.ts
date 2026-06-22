import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import * as Sentry from "@sentry/node";
import { initPerfStats } from "./lib/dev-perf-stats";

globalThis.global = globalThis;
// The Elysia process is the Node runtime; set the marker before shared helpers that still ask for Next runtime metadata.
// eslint-disable-next-line no-restricted-syntax
process.env.NEXT_RUNTIME ??= "nodejs";

let registered = false;

export function registerBackendInstrumentation() {
  if (registered) {
    return;
  }
  registered = true;

  const portPrefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
  const isDevelopment = getNodeEnvironment() === "development";

  const sdk = new NodeSDK({
    serviceName: "stack-backend",
    instrumentations: [
      new PrismaInstrumentation(),
      ...getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          enabled: false,
        },
      }),
    ],
    ...isDevelopment ? {
      traceExporter: new OTLPTraceExporter({
        url: `http://localhost:${portPrefix}31/v1/traces`,
      }),
    } : {},
  });
  sdk.start();

  process.title = `stack-backend:${portPrefix} (node/elysia)`;
  initPerfStats();

  Sentry.init({
    ...sentryBaseConfig,
    // We run our own OpenTelemetry NodeSDK above (for Prisma + the dev OTLP exporter), which already
    // registers the global trace/context/propagation APIs. Without this flag, @sentry/node (v10 is
    // OpenTelemetry-native) tries to register them again, logging "Attempted duplicate registration
    // of API: trace/propagation/context". Skipping Sentry's OTel setup lets the NodeSDK own it while
    // error capture continues to work normally.
    skipOpenTelemetrySetup: true,
    dsn: getEnvVariable("NEXT_PUBLIC_SENTRY_DSN", ""),
    enabled: getNodeEnvironment() !== "development" && !getEnvVariable("CI", ""),
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

registerBackendInstrumentation();
