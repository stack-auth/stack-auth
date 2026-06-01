import * as Sentry from "@sentry/nextjs";
import { getEnvBoolean, getEnvVariable, getNextRuntime, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import "./polyfills";

export async function register() {
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
