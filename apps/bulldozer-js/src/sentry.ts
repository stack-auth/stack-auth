import * as Sentry from "@sentry/node";
import { registerErrorSink } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection } from "@hexclave/shared/dist/utils/promises";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";

export function resolveBulldozerSentryEnvironment(): string {
  const configured = process.env.BULLDOZER_JS_SENTRY_ENVIRONMENT?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

// Init Sentry for the bulldozer-js process and route `captureError`/`captureWarning` to it. No-ops
// without a DSN, in which case errors still hit the default console sink. Returns whether Sentry was
// actually configured, so the boot path can decide whether to emit the startup signal to Sentry
// (vs. spamming the local console on every dev reload, where there's no DSN).
export function initSentry(): boolean {
  const dsn = process.env.BULLDOZER_JS_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "";
  if (!dsn) return false;

  Sentry.init({
    ...sentryBaseConfig,
    dsn,
    environment: resolveBulldozerSentryEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: 0,

    // Mirror the CLI/backend enrichment: surface the Error's own props (this is what
    // exposes HexclaveAssertionError's attached context, e.g. tableId/rowId/rowData),
    // its `cause`, and a deep nicify dump that survives buggy pretty-printers.
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
          errorProps: { ...error },
          nicifiedError: nicified,
        };
      }
      return event;
    },
  });

  registerErrorSink((location, error, level) => {
    Sentry.captureException(error, { extra: { location }, level });
    ignoreUnhandledRejection(Sentry.flush(2000));
  });

  return true;
}
