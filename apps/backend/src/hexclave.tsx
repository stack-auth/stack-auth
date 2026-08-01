import { StackServerApp } from '@hexclave/next';
import { getEnvBoolean, getEnvVariable } from '@hexclave/shared/dist/utils/env';

function createHexclaveServerApp() {
  // Fail fast if the backend self-URL env var is missing — without it the SDK
  // would silently inherit `defaultBaseUrl` (https://api.stack-auth.com), which
  // is almost never what we want for backend self-calls.
  //
  // We deliberately do NOT pass it as an explicit `baseUrl` to the SDK: doing
  // so collapses `resolveApiUrls` to a single-element URL list, which short-
  // circuits `_withFallback` (`apiUrls.length <= 1` branch). The SDK reads the
  // same env var internally and additionally appends its hardcoded fallback
  // URLs, which is what the e2e-fallback-tests workflow relies on so backend
  // self-calls (quota debits in email-queue-step, send-test-email, analytics
  // events batch, etc.) survive a primary-port outage.
  getEnvVariable('NEXT_PUBLIC_STACK_API_URL');
  const selfTelemetryEnabled = getEnvBoolean("HEXCLAVE_SELF_TELEMETRY_ENABLED");
  return new StackServerApp({
    projectId: 'internal',
    tokenStore: null,
    publishableClientKey: getEnvVariable('STACK_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY'),
    secretServerKey: getEnvVariable('STACK_INTERNAL_PROJECT_SECRET_SERVER_KEY'),
    // The backend is an ordinary SDK producer owned by the internal project.
    // This keeps its logs, errors, request spans, fetches, and library spans on
    // the normal authenticated ingestion path instead of maintaining a second
    // ClickHouse exporter with customer-tenancy fan-out.
    analytics: { enabled: selfTelemetryEnabled },
    observability: {
      enabled: selfTelemetryEnabled,
      // Healthy backend traces are deterministically sampled as complete SDK
      // flush groups. Errors, failed requests/library work, and slow spans are
      // promoted before the analytics batch transport is invoked.
      traceSampleRate: 0.1,
      // The backend's internal trace context must not become a customer-facing
      // Hexclave correlation header on downstream calls. W3C trace propagation
      // remains independent and follows the SDK's trusted-origin policy.
      spanPropagation: { enabled: false },
    },
    telemetry: {
      resource: {
        service: { name: "hexclave-backend" },
      },
    },
  });
}

let hexclaveServerApp: ReturnType<typeof createHexclaveServerApp> | null = null;

export function getHexclaveServerApp() {
  hexclaveServerApp ??= createHexclaveServerApp();
  return hexclaveServerApp;
}
