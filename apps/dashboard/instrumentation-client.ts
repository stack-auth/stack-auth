// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { getPublicEnvVar } from "@/lib/env";
import * as Sentry from "@sentry/nextjs";
import { getBrowserCompatibilityReport } from "@hexclave/shared/dist/utils/browser-compat";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import posthog from "posthog-js";
import { createDashboardTracePropagationTargets, resolveDashboardSentryDsn, shouldEnableDashboardTracePropagation } from "./src/lib/cross-tier-tracing";
import { exportDashboardSentryTransaction } from "./src/lib/sentry-browser-trace-export";

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

const isDevelopment = process.env.NODE_ENV === "development";
const shouldExportBrowserTraces = getPublicEnvVar("NEXT_PUBLIC_HEXCLAVE_ANALYTICS_BROWSER_TRACE_EXPORT_ENABLED") === "true";

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


Sentry.init({
  ...sentryBaseConfig,

  dsn: resolveDashboardSentryDsn(getPublicEnvVar('NEXT_PUBLIC_SENTRY_DSN'), isDevelopment),

  // Browser tracing must stay active in development so API requests carry a
  // W3C parent. The no-op transport keeps local events, replays, and spans from
  // leaving the browser even when a developer has a Sentry DSN configured.
  enabled: shouldEnableDashboardTracePropagation(process.env.CI),
  ...isDevelopment ? {
    transport: () => ({
      send: () => Promise.resolve({}),
      flush: () => Promise.resolve(true),
    }),
  } : {},

  // Sentry owns the browser span lifecycle, but emits the standard W3C header
  // so the backend's OpenTelemetry provider can continue the same trace.
  propagateTraceparent: true,
  tracePropagationTargets: createDashboardTracePropagationTargets([
    getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL"),
    getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL"),
  ]),

  beforeSendTransaction(event) {
    if (shouldExportBrowserTraces) {
      // Preserve Sentry's send path and export independently. The callback must
      // stay synchronous so a slow Analytics endpoint never delays the original
      // telemetry pipeline.
      runAsynchronously(() => exportDashboardSentryTransaction(event));
    }
    return event;
  },

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
