import * as Sentry from "@sentry/node";
import { registerErrorSink } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection } from "@hexclave/shared/dist/utils/promises";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";

/**
 * Initializes Sentry for the bulldozer-js server process and wires it into the shared
 * `captureError`/`captureWarning` sink registry, so errors reported from background tasks (e.g. the
 * periodic tick loop) reach Sentry rather than only the console.
 *
 * No-ops when no DSN is configured (local dev / tests); in that case `captureError` still reaches the
 * default console sink registered in `@hexclave/shared`.
 */
export function initSentry(): void {
  const dsn = process.env.BULLDOZER_JS_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "";
  if (!dsn) return;

  Sentry.init({
    ...sentryBaseConfig,
    dsn,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });

  registerErrorSink((location, error, level) => {
    Sentry.captureException(error, { extra: { location }, level });
    ignoreUnhandledRejection(Sentry.flush(2000));
  });
}
