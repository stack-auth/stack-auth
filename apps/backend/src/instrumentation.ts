import * as Sentry from "@sentry/nextjs";
import { getEnvVariable, getNextRuntime, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import { registerOTel } from "@vercel/otel";
import "./polyfills";

export async function register() {
  // Next statically eliminates the opposite branch for each runtime. Keeping
  // the import directly behind NEXT_RUNTIME is what prevents Node-only Prisma,
  // ClickHouse, and networking modules from entering the Edge bundle.
  // eslint-disable-next-line no-restricted-syntax -- getNextRuntime() is opaque to Next's compile-time runtime elimination.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import("./instrumentation-node");
    await registerNodeInstrumentation();
  } else {
    registerOTel({ serviceName: "stack-backend" });
  }

  if (getNextRuntime() === "nodejs" || getNextRuntime() === "edge") {
    Sentry.init({
      ...sentryBaseConfig,

      dsn: getEnvVariable("NEXT_PUBLIC_SENTRY_DSN", ""),

      enabled: getNodeEnvironment() !== "development" && !getEnvVariable("CI", ""),

      // @vercel/otel owns the provider. Allowing Sentry to install another one
      // breaks the shared active context and fragments distributed traces.
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
