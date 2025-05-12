import * as Sentry from "@sentry/nextjs";
import { getEnvVariable, getNextRuntime, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { sentryBaseConfig } from "@stackframe/stack-shared/dist/utils/sentry";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import "./polyfills";

export function register() {
  if (getNextRuntime() === "nodejs") {
    globalThis.process.title = "stack-dashboard (node/nextjs)";
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
