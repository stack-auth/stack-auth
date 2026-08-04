import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import * as Sentry from "@sentry/node";
import backendPackageJson from "../package.json";
import { initPerfStats } from "./lib/dev-perf-stats";
import { getSentryRelease } from "./sentry-release";
import { sanitizeBackendSentryEvent, sanitizeBackendSentrySpan } from "./sentry-scrubbing";

globalThis.global = globalThis;
// The Elysia process is the Node runtime; set the marker before shared helpers that still ask for Next runtime metadata.
// eslint-disable-next-line no-restricted-syntax
process.env.NEXT_RUNTIME ??= "nodejs";

let registered = false;
// Whichever OpenTelemetry owner we started ourselves (the dev NodeSDK or the no-export fallback
// provider), kept so closeBackendInstrumentation() can shut it down. Undefined when Sentry owns OTel.
let ownedTelemetry: NodeSDK | NodeTracerProvider | undefined;

export function registerBackendInstrumentation() {
  if (registered) {
    return;
  }
  registered = true;

  const portPrefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
  const nodeEnvironment = getNodeEnvironment();
  const isDevelopment = nodeEnvironment === "development";
  const sentryDsn = getEnvVariable("NEXT_PUBLIC_SENTRY_DSN", "");
  const sentryEnabled = nodeEnvironment === "production"
    && getEnvVariable("CI", "") === ""
    && sentryDsn !== "";

  // Development exports traces to the local collector. Production lets Sentry
  // own OpenTelemetry completely; mixing two SDK owners caused duplicate global
  // registrations and left Sentry without its sampler/propagator/processors.
  if (isDevelopment) {
    const developmentTelemetrySdk = new NodeSDK({
      serviceName: "stack-backend",
      instrumentations: [
        new PrismaInstrumentation(),
        ...getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-http": {
            enabled: false,
          },
        }),
      ],
      traceExporter: new OTLPTraceExporter({
        url: `http://localhost:${portPrefix}31/v1/traces`,
      }),
    });
    developmentTelemetrySdk.start();
    ownedTelemetry = developmentTelemetrySdk;
  } else if (!sentryEnabled) {
    // When Sentry is disabled (CI, tests, self-hosters without a DSN, local prod builds), nothing
    // else registers a global tracer provider — and, crucially, no global context manager. Under
    // the default NoopContextManager, tracer.startActiveSpan() cannot propagate the active span,
    // so trace.getActiveSpan() returns undefined inside request handlers and telemetry log() throws
    // "No active span found" on every request. (The Next.js runtime used to paper over this because
    // registerOTel always ran.) A processor-less NodeTracerProvider registers a real provider plus
    // the AsyncLocalStorage context manager; spans propagate but are never exported. Don't use an
    // exporter-less NodeSDK for this: sdk-node auto-configures a default OTLP exporter that would
    // uselessly retry against localhost:4318.
    const fallbackTracerProvider = new NodeTracerProvider();
    fallbackTracerProvider.register();
    ownedTelemetry = fallbackTracerProvider;
  }

  process.title = `stack-backend:${portPrefix} (node/elysia)`;
  initPerfStats();

  Sentry.init({
    ignoreErrors: sentryBaseConfig.ignoreErrors,
    normalizeDepth: sentryBaseConfig.normalizeDepth,
    maxValueLength: sentryBaseConfig.maxValueLength,
    debug: sentryBaseConfig.debug,
    tracesSampleRate: sentryEnabled ? sentryBaseConfig.tracesSampleRate : 0,
    skipOpenTelemetrySetup: !sentryEnabled,
    dsn: sentryDsn,
    enabled: sentryEnabled,
    sendDefaultPii: false,
    includeLocalVariables: false,
    environment: getEnvVariable("VERCEL_ENV", nodeEnvironment),
    release: getSentryRelease({
      packageName: backendPackageJson.name,
      packageVersion: backendPackageJson.version,
    }),
    beforeSend: sanitizeBackendSentryEvent,
    beforeSendSpan: sanitizeBackendSentrySpan,
    beforeSendTransaction: sanitizeBackendSentryEvent,
  });
}

export async function closeBackendInstrumentation(timeoutMs = 2000): Promise<void> {
  const closeResults = await Promise.allSettled([
    ownedTelemetry?.shutdown(),
    Sentry.close(timeoutMs),
  ].filter((promise) => promise != null));
  const failures = closeResults.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      "Failed to close backend instrumentation",
    );
  }
}

registerBackendInstrumentation();
