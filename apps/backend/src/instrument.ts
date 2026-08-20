import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { context } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import * as Sentry from "@sentry/node";
import backendPackageJson from "../package.json";
import { getHexclaveServerApp } from "./hexclave";
import { createBackendInstrumentationPlan } from "./instrumentation-plan";
import { initPerfStats } from "./lib/dev-perf-stats";
import { registerNodeTelemetrySuppressionRunner } from "./lib/node-telemetry-suppression";
import { getSentryRelease } from "./sentry-release";
import { prepareBackendSentryEvent, sanitizeBackendSentrySpan } from "./sentry-scrubbing";

globalThis.global = globalThis;
// The Elysia process is the Node runtime; set the marker before shared helpers that still ask for Next runtime metadata.
// eslint-disable-next-line no-restricted-syntax
process.env.NEXT_RUNTIME ??= "nodejs";

let registered = false;
let disableBackendInstrumentations: (() => void) | null = null;

export function registerBackendInstrumentation() {
  if (registered) {
    return;
  }
  registered = true;

  const portPrefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
  const nodeEnvironment = getNodeEnvironment();
  const sentryDsn = getEnvVariable("NEXT_PUBLIC_SENTRY_DSN", "");
  const plan = createBackendInstrumentationPlan({
    ci: getEnvVariable("CI", ""),
    nodeEnvironment,
    otlpEndpoint: getEnvVariable("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
    otlpTracesEndpoint: getEnvVariable("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", ""),
    portPrefix,
    sentryDsn,
    sentryTracesSampleRate: sentryBaseConfig.tracesSampleRate,
  });

  process.title = `stack-backend:${portPrefix} (node/elysia)`;
  initPerfStats();

  // Dogfood the same managed SDK integration customers use. Construction
  // synchronously installs Hexclave's tracer, logger, meter, W3C propagation,
  // correlation processor, and authenticated OTLP exporters before any other
  // integration can claim the process-wide OpenTelemetry globals.
  getHexclaveServerApp();

  // Prisma supplies an official OTel instrumentation class rather than using
  // the global API by itself. Register it against the provider the Hexclave
  // SDK just installed; otherwise switching provider ownership away from
  // Sentry silently removes database spans from otherwise-complete traces.
  disableBackendInstrumentations = registerInstrumentations({
    instrumentations: [new PrismaInstrumentation()],
  });

  // Sentry remains an optional error-reporting sink for installations with a
  // DSN, but it must never own or be required by backend OpenTelemetry.
  Sentry.init({
    ignoreErrors: sentryBaseConfig.ignoreErrors,
    normalizeDepth: sentryBaseConfig.normalizeDepth,
    maxValueLength: sentryBaseConfig.maxValueLength,
    debug: sentryBaseConfig.debug,
    tracesSampleRate: 0,
    skipOpenTelemetrySetup: true,
    dsn: sentryDsn,
    enabled: plan.sentryEnabled,
    sendDefaultPii: false,
    includeLocalVariables: false,
    environment: getEnvVariable("VERCEL_ENV", nodeEnvironment),
    release: getSentryRelease({
      packageName: backendPackageJson.name,
      packageVersion: backendPackageJson.version,
    }),
    beforeSend: prepareBackendSentryEvent,
    beforeSendSpan: sanitizeBackendSentrySpan,
    beforeSendTransaction: prepareBackendSentryEvent,
  });

  // Hexclave owns the process provider; enter the standard suppression context
  // from that provider's OTel graph so ingestion cannot recursively export.
  registerNodeTelemetrySuppressionRunner(
    async (fn) => await context.with(suppressTracing(context.active()), fn),
  );
}

export async function closeBackendInstrumentation(timeoutMs = 2000): Promise<void> {
  disableBackendInstrumentations?.();
  disableBackendInstrumentations = null;
  const [, sentryClosed] = await Promise.all([
    getHexclaveServerApp().flush(),
    Sentry.close(timeoutMs),
  ]);
  if (!sentryClosed) {
    throw new Error(`Backend instrumentation did not close within ${timeoutMs}ms`);
  }
}

registerBackendInstrumentation();
