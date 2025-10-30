import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import * as Sentry from "@sentry/nextjs";
import { getEnvVariable, getNextRuntime, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { sentryBaseConfig } from "@stackframe/stack-shared/dist/utils/sentry";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import { registerOTel } from '@vercel/otel';
import "./polyfills";

// this is a hack for making prisma instrumentation work
// somehow prisma instrumentation accesses global and it makes edge instrumentation complain
globalThis.global = globalThis;

export function register() {
  registerOTel({
    serviceName: 'stack-backend',
    instrumentations: [new PrismaInstrumentation()],
    ...getNodeEnvironment() === "development" && getNextRuntime() === "nodejs" ? {
      traceExporter: new OTLPTraceExporter({
        url: `http://localhost:${getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81")}31/v1/traces`,
      }),
    } : {},
  });

  if (getNextRuntime() === "nodejs") {
    process.title = `stack-backend:${getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81")} (node/nextjs)`;
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
