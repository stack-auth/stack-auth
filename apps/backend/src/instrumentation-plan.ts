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

  const sentryEnabled = options.nodeEnvironment === "production" && options.sentryDsn !== "";
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
  const url = new URL(value);
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
