type BackendInstrumentationPlanOptions = {
  ci: string,
  nodeEnvironment: string,
  otlpEndpoint: string,
  otlpTracesEndpoint: string,
  portPrefix: string,
  sentryDsn: string,
  sentryTracesSampleRate: number,
};

export type BackendInstrumentationPlan = {
  otlpTracesEndpoint: string | undefined,
  sentryEnabled: boolean,
  tracesSampleRate: number,
};

export function createBackendInstrumentationPlan(options: BackendInstrumentationPlanOptions): BackendInstrumentationPlan {
  if (options.ci !== "") {
    return {
      otlpTracesEndpoint: undefined,
      sentryEnabled: false,
      tracesSampleRate: 0,
    };
  }

  // Matches the pre-Elysia @sentry/nextjs gating: Sentry was enabled whenever the DSN
  // was set and we were neither in development nor in CI (CI is short-circuited above).
  // An exact-match on "production" would be too narrow — a self-hoster or staging deploy
  // with a custom NODE_ENV (e.g. "staging", "preview") would silently drop all error
  // reporting. We additionally exclude "test" so test runs never report to Sentry.
  const sentryEnabled = options.sentryDsn !== ""
    && options.nodeEnvironment !== "development"
    && options.nodeEnvironment !== "test";
  const configuredOtlpTracesEndpoint = options.otlpTracesEndpoint.trim();
  const configuredOtlpEndpoint = options.otlpEndpoint.trim();
  const otlpTracesEndpoint = configuredOtlpTracesEndpoint !== ""
    ? validateOtlpEndpoint("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", configuredOtlpTracesEndpoint)
    : configuredOtlpEndpoint !== ""
      ? appendTracesPath(validateOtlpEndpoint("OTEL_EXPORTER_OTLP_ENDPOINT", configuredOtlpEndpoint))
      : options.nodeEnvironment === "development"
        ? `http://localhost:${options.portPrefix}31/v1/traces`
        : undefined;

  return {
    otlpTracesEndpoint,
    sentryEnabled,
    // Sentry owns the one global provider. A non-Sentry OTLP destination still
    // needs sampled spans so its additional processor receives real data.
    tracesSampleRate: sentryEnabled ? options.sentryTracesSampleRate : otlpTracesEndpoint == null ? 0 : 1,
  };
}

function validateOtlpEndpoint(environmentVariableName: string, value: string) {
  // A bare `new URL(value)` throws TypeError("Invalid URL") without naming the source,
  // which is useless during a boot crash-loop — the operator can't tell which env var is
  // malformed. This narrow try/catch is NOT error swallowing: it rethrows immediately
  // (fail early, fail loud), just with the env var name and offending value attached.
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${environmentVariableName} is not a valid URL: ${JSON.stringify(value)}`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${environmentVariableName} must use HTTP or HTTPS, got: ${JSON.stringify(url.protocol)}`);
  }
  return url.toString();
}

function appendTracesPath(value: string) {
  const url = new URL(value);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/traces`;
  return url.toString();
}
