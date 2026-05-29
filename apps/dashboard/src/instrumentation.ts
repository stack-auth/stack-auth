import * as Sentry from "@sentry/nextjs";
import { getEnvBoolean, getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import "./polyfills";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (getEnvBoolean("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT")) {
      globalThis.process.title = `Hexclave — Development Server (port ${getEnvVariable("PORT", "?")})`;
    } else {
      globalThis.process.title = `stack-dashboard:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")} (node/nextjs)`;
    }
    const { startRemoteDevelopmentEnvironmentLifecycleIfNeeded } = await import("./instrumentation-node");
    await startRemoteDevelopmentEnvironmentLifecycleIfNeeded();
  }

  Sentry.init({
    ...sentryBaseConfig,

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
