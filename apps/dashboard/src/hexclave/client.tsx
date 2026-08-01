import { getPublicEnvVar } from "@/lib/env";
import { StackClientApp } from "@hexclave/next";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import "../polyfills";

if (getPublicEnvVar("NEXT_PUBLIC_STACK_PROJECT_ID") !== "internal") {
  throw new Error("This project is not configured correctly. stack-dashboard must always use the internal project.");
}

const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";
const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";

export const hexclaveClientApp = new StackClientApp({
  baseUrl: {
    browser: getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL") ?? getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_BROWSER_STACK_API_URL is not set"),
    server: getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_API_URL") ?? getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_SERVER_STACK_API_URL is not set"),
  },
  projectId: "internal",
  publishableClientKey: getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"),
  tokenStore: isPreview || isRemoteDevelopmentEnvironment ? "memory" : "nextjs-cookie",
  urls: {
    afterSignIn: "/projects",
    afterSignUp: "/new-project",
    afterSignOut: "/",
  },
  analytics: {
    enabled: !isRemoteDevelopmentEnvironment,
    // Dogfood the full autocapture surface on the internal dashboard so
    // session-replay markers / analytics tables see $form-submit,
    // $window-resize, and the integrity-signal events ($copy/$paste/…) —
    // not just $click/$page-view. Off by default for customer apps.
    integritySignals: !isRemoteDevelopmentEnvironment,
    replays: {
      captureKeystrokes: !isPreview && !isRemoteDevelopmentEnvironment,
      maskAllInputs: false,
      enabled: !isPreview && !isRemoteDevelopmentEnvironment,
    },
  },
  observability: {
    enabled: !isRemoteDevelopmentEnvironment,
    spanPropagation: {
      // The API is cross-origin from the dashboard, so the SDK's same-origin
      // default would never attach the span-context header (or traceparent) to
      // API calls. Allowlisting the exact API origins is what makes the SDK —
      // not Sentry — own dashboard→backend cross-tier tracing (the backend
      // CORS-allows both headers). This is the dogfood reference for the
      // customer-facing `observability.spanPropagation.allowedOrigins` option.
      allowedOrigins: getHexclaveApiOrigins([
        getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL"),
        getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL"),
      ]),
    },
  },
  telemetry: {
    resource: {
      service: {
        name: "stack-dashboard",
      },
      deploymentEnvironmentName: process.env.NODE_ENV,
    },
  },
});

/**
 * Exact origins (never substrings — `api.example.com.attacker.test` must not
 * match) of the Hexclave API endpoints the browser may talk to.
 */
function getHexclaveApiOrigins(apiUrls: readonly (string | null | undefined)[]): string[] {
  const origins = new Set<string>();
  for (const apiUrl of apiUrls) {
    if (apiUrl == null || apiUrl === "") continue;
    origins.add(new URL(apiUrl).origin);
  }
  return [...origins];
}
