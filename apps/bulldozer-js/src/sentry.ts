import * as Sentry from "@sentry/node";
import { registerErrorSink } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection } from "@hexclave/shared/dist/utils/promises";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";

// Init Sentry for the bulldozer-js process and route `captureError`/`captureWarning` to it. No-ops
// without a DSN, in which case errors still hit the default console sink.
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
