// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { getPublicEnvVar } from "@/lib/env";
import * as Sentry from "@sentry/nextjs";
import { getBrowserCompatibilityReport } from "@stackframe/stack-shared/dist/utils/browser-compat";
import { sentryBaseConfig } from "@stackframe/stack-shared/dist/utils/sentry";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import posthog from "posthog-js";

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
