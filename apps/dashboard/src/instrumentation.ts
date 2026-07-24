import * as Sentry from "@sentry/nextjs";
import { getEnvBoolean, getEnvVariable, getNextRuntime, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import { OTLPHttpJsonTraceExporter, registerOTel } from "@vercel/otel";
import { createStackApiOriginTraceTargets } from "./lib/cross-tier-tracing";
import {
  CompositeDashboardTraceExporter,
  createAnalyticsTraceExporterConfig,
} from "./lib/dashboard-trace-export";
import "./polyfills";

export async function register() {
  const developmentTraceExporterUrl = getNodeEnvironment() === "development"
    ? `http://localhost:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")}31/v1/traces`
    : null;
  const developmentTraceExporter = developmentTraceExporterUrl === null
    ? null
    : new OTLPHttpJsonTraceExporter({
      url: developmentTraceExporterUrl,
    });
  const analyticsTraceExporterConfig = getEnvBoolean("HEXCLAVE_ANALYTICS_OTEL_EXPORT_ENABLED")
    ? createAnalyticsTraceExporterConfig({
      apiUrl: getEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL"),
      projectId: getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID"),
      secretServerKey: getEnvVariable("HEXCLAVE_SECRET_SERVER_KEY"),
    })
    : null;
  const analyticsTraceExporter = analyticsTraceExporterConfig === null
    ? null
    : new OTLPHttpJsonTraceExporter(analyticsTraceExporterConfig);
  const traceExporter = developmentTraceExporter === null
    ? analyticsTraceExporter
    : analyticsTraceExporter === null
      ? developmentTraceExporter
      : new CompositeDashboardTraceExporter([
        developmentTraceExporter,
        analyticsTraceExporter,
      ]);

  registerOTel({
    serviceName: "stack-dashboard",
    instrumentationConfig: {
      fetch: {
        propagateContextUrls: createStackApiOriginTraceTargets([
          getEnvVariable("NEXT_PUBLIC_BROWSER_STACK_API_URL", ""),
          getEnvVariable("NEXT_PUBLIC_SERVER_STACK_API_URL", ""),
          getEnvVariable("NEXT_PUBLIC_STACK_API_URL", ""),
        ]),
        // Export POSTs must not create new spans that recursively schedule
        // another export after every otherwise-idle batch.
        ignoreUrls: [
          ...(developmentTraceExporterUrl === null ? [] : [developmentTraceExporterUrl]),
          ...(analyticsTraceExporterConfig === null ? [] : [analyticsTraceExporterConfig.url]),
        ],
      },
    },
    ...(traceExporter === null ? {} : { traceExporter }),
  });

  // Next.js builds instrumentation for both Node.js and Edge. Keep the runtime
  // check inline so the Edge bundle does not follow this Node-only import.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (getEnvBoolean("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT")) {
      globalThis.process.title = `Hexclave — Development Server (port ${getEnvVariable("PORT", "?")})`;

      const { startRemoteDevelopmentEnvironmentLifecycle } = await import("./lib/remote-development-environment/manager");
      startRemoteDevelopmentEnvironmentLifecycle();
    } else {
      globalThis.process.title = `stack-dashboard:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")} (node/nextjs)`;
    }
  }

  if (getNextRuntime() === "nodejs" || getNextRuntime() === "edge") {
    Sentry.init({
      ...sentryBaseConfig,

      dsn: getEnvVariable("NEXT_PUBLIC_SENTRY_DSN", ""),

      enabled: getNodeEnvironment() !== "development" && !getEnvVariable("CI", ""),

      // @vercel/otel owns the server provider so Sentry must not register a
      // competing provider and split the active trace context.
      skipOpenTelemetrySetup: true,

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
