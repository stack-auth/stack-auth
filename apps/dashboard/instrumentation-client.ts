// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { getPublicEnvVar } from "@/lib/env";
import * as Sentry from "@sentry/nextjs";
import { getBrowserCompatibilityReport } from "@stackframe/stack-shared/dist/utils/browser-compat";
import { sentryBaseConfig } from "@stackframe/stack-shared/dist/utils/sentry";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import posthog from "posthog-js";

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

const postHogKey = getPublicEnvVar('NEXT_PUBLIC_POSTHOG_KEY') ?? "phc_vIUFi0HzHo7oV26OsaZbUASqxvs8qOmap1UBYAutU4k";
if (postHogKey.length > 5) {
  posthog.init(postHogKey, {
    // We use Sentry's Replay integration below for error debugging. Keep
    // PostHog session recording off to avoid loading its lazy recorder, which
    // is the source of Sentry issue STACK-SERVER-1NK:
    // "Called on script loaded before session recording is available".
    // PostHog documents `disable_session_recording: true` as the config-level
    // way to prevent automatic web session recording.
    // Source: https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record
    disable_session_recording: true,
    defaults: '2025-11-30',
    api_host: "/consume",
    ui_host: "https://eu.i.posthog.com",
  });
}


Sentry.init({
  ...sentryBaseConfig,

  dsn: getPublicEnvVar('NEXT_PUBLIC_SENTRY_DSN'),

  enabled: process.env.NODE_ENV !== "development" && !process.env.CI,

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  integrations: [
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
