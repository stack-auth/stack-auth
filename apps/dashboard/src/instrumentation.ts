import * as Sentry from "@sentry/nextjs";
import type { HexclaveNextInstrumentation } from "@hexclave/next/next";
import { getEnvBoolean, getEnvVariable, getNextRuntime, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { sentryBaseConfig } from "@hexclave/shared/dist/utils/sentry";
import { nicify } from "@hexclave/shared/dist/utils/strings";
import "./polyfills";

// The dashboard dogfoods the Hexclave SDK for its own server-tier telemetry
// (outbound-fetch spans, uncaught-error events, ambient request attribution)
// instead of the previous @vercel/otel + OTLP-export setup — the backend's
// OTLP ingestion route is being removed entirely.
//
// Resolved lazily (and memoized) because the same instrumentation instance
// must back both `register` and `onRequestError`, and because in the remote
// development environment the dashboard intentionally has no server app
// (`getHexclaveServerApp()` throws there) — telemetry is disabled in that
// mode rather than crashing startup.
let hexclaveNextInstrumentationPromise: Promise<HexclaveNextInstrumentation | null> | undefined;
function getHexclaveNextInstrumentation(): Promise<HexclaveNextInstrumentation | null> {
  hexclaveNextInstrumentationPromise ??= (async () => {
    // Next.js builds instrumentation for both Node.js and Edge. Keep the
    // runtime check inline so the Edge bundle does not follow these
    // Node-only imports.
    if (process.env.NEXT_RUNTIME !== "nodejs") return null;
    const { isRemoteDevelopmentEnvironmentEnabled } = await import("./lib/remote-development-environment/env");
    if (isRemoteDevelopmentEnvironmentEnabled()) return null;
    const [{ hexclaveInstrumentation }, { getHexclaveServerApp }] = await Promise.all([
      import("@hexclave/next/next"),
      import("./hexclave/server"),
    ]);
    return hexclaveInstrumentation(getHexclaveServerApp());
  })();
  return hexclaveNextInstrumentationPromise;
}

export async function register() {
  const hexclaveNextInstrumentation = await getHexclaveNextInstrumentation();
  // register() became async when it grew the library-span-bridge claim; Next
  // awaits the exported register, so awaiting here keeps the bridge installed
  // before any app code can emit spans.
  await hexclaveNextInstrumentation?.register();

  // Next.js builds instrumentation for both Node.js and Edge. Keep the runtime
  // check inline so the Edge bundle does not follow this Node-only import.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (getEnvBoolean("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT")) {
      globalThis.process.title = `Hexclave — Development Server (port ${getEnvVariable("PORT", "?")})`;

      const { startRemoteDevelopmentEnvironmentLifecycle } = await import("./lib/remote-development-environment/manager");
      startRemoteDevelopmentEnvironmentLifecycle();
    } else {
      globalThis.process.title = `stack-dashboard:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")} (node/nextjs)`;
    }
  }

  if (getNextRuntime() === "nodejs" || getNextRuntime() === "edge") {
    Sentry.init({
      ...sentryBaseConfig,

      dsn: getEnvVariable("NEXT_PUBLIC_SENTRY_DSN", ""),

      enabled: getNodeEnvironment() !== "development" && !getEnvVariable("CI", ""),

      // Sentry is an error-reporting backstop only. Now that @vercel/otel is
      // gone, the dashboard server deliberately runs no OpenTelemetry
      // provider at all (server telemetry goes through the Hexclave SDK
      // natively), so keep Sentry from registering its own provider — with
      // sentryBaseConfig's tracesSampleRate it would otherwise resurrect a
      // full OTel tracing setup.
      skipOpenTelemetrySetup: true,

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

// Reports every error Next.js catches during request handling as a `$error`
// event linked to the caller's session. No-ops where the server app is
// unavailable (Edge runtime, remote development environment).
export async function onRequestError(
  ...args: Parameters<HexclaveNextInstrumentation["onRequestError"]>
): Promise<void> {
  const hexclaveNextInstrumentation = await getHexclaveNextInstrumentation();
  if (hexclaveNextInstrumentation === null) return;
  await hexclaveNextInstrumentation.onRequestError(...args);
}
