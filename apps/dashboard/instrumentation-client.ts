// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { getPublicEnvVar } from "@/lib/env";
import * as Sentry from "@sentry/nextjs";
import { getBrowserCompatibilityReport } from "@hexclave/shared/dist/utils/browser-compat";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import posthog from "posthog-js";

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

const isDevelopment = process.env.NODE_ENV === "development";

const postHogKey = getPublicEnvVar('NEXT_PUBLIC_POSTHOG_KEY') ?? "phc_vIUFi0HzHo7oV26OsaZbUASqxvs8qOmap1UBYAutU4k";
if (postHogKey.length > 5) {
  posthog.init(postHogKey, {
    session_recording: {
      maskAllInputs: false,
      maskInputOptions: {
        password: true,
      },
    },
    defaults: '2025-11-30',
    api_host: "/consume",
    ui_host: "https://eu.i.posthog.com",
  });
}


// Cross-tier tracing note: the Hexclave SDK (src/hexclave/client.tsx) now owns
// the browser span lifecycle, the W3C `traceparent`, and the
// W3C `baggage` header on API calls — Sentry no longer participates
// in tracing at all (no propagateTraceparent/tracePropagationTargets, no
// transaction export, no dev no-op-transport keep-alive). Sentry stays
// initialized as an error-reporting/replay backstop only while the native
// $error pipeline proves itself; PostHog likewise stays as a comparison
// backstop. Full dogfood means the product works with both of them removed.
Sentry.init({
  ...sentryBaseConfig,

  dsn: getPublicEnvVar('NEXT_PUBLIC_SENTRY_DSN'),

  // Without the tracing duty there is no reason to run Sentry locally or in CI.
  enabled: !isDevelopment && (process.env.CI === undefined || process.env.CI === ""),

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  integrations: [
    ...isDevelopment ? [] : [
      Sentry.replayIntegration({
        // Additional Replay configuration goes in here, for example:
        maskAllText: false,
        maskAllInputs: false,
        blockAllMedia: false,
      }),
      posthog.sentryIntegration({
        organization: "stackframe-pw",
        projectId: 4507084192219136,
      }),
    ],
  ],

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
        clientBrowserCompatibility: getBrowserCompatibilityReport(),
      };
    }
    return event;
  },
});
