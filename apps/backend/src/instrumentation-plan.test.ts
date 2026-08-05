import { describe, expect, it } from "vitest";
import { createBackendInstrumentationPlan } from "./instrumentation-plan";

const baseOptions = {
  ci: "",
  nodeEnvironment: "production",
  otlpEndpoint: "",
  otlpTracesEndpoint: "",
  portPrefix: "81",
  sentryDsn: "",
  sentryTracesSampleRate: 0.25,
};

describe("createBackendInstrumentationPlan", () => {
  it("uses Sentry as the production trace destination when it is configured", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      sentryDsn: "https://public@example.invalid/1",
    })).toMatchInlineSnapshot(`
      {
        "otlpTracesEndpoint": undefined,
        "sentryEnabled": true,
        "tracesSampleRate": 0.25,
      }
    `);
  });

  it("exports development traces through the local collector", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      nodeEnvironment: "development",
      portPrefix: "93",
    })).toMatchInlineSnapshot(`
      {
        "otlpTracesEndpoint": "http://localhost:9331/v1/traces",
        "sentryEnabled": false,
        "tracesSampleRate": 1,
      }
    `);
  });

  it("supports a self-hosted OTLP destination without enabling Sentry", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      otlpTracesEndpoint: "https://otel.example.com/v1/traces",
    })).toMatchInlineSnapshot(`
      {
        "otlpTracesEndpoint": "https://otel.example.com/v1/traces",
        "sentryEnabled": false,
        "tracesSampleRate": 1,
      }
    `);
  });

  it("derives the traces URL from the standard all-signals OTLP endpoint", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      otlpEndpoint: "https://otel.example.com/collector",
    })).toMatchInlineSnapshot(`
      {
        "otlpTracesEndpoint": "https://otel.example.com/collector/v1/traces",
        "sentryEnabled": false,
        "tracesSampleRate": 1,
      }
    `);
  });

  it("does not send telemetry from CI even when destinations are configured", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      ci: "true",
      otlpTracesEndpoint: "https://otel.example.com/v1/traces",
      sentryDsn: "https://public@example.invalid/1",
    })).toMatchInlineSnapshot(`
      {
        "otlpTracesEndpoint": undefined,
        "sentryEnabled": false,
        "tracesSampleRate": 0,
      }
    `);
  });

  it("rejects non-HTTP exporter endpoints", () => {
    expect(() => createBackendInstrumentationPlan({
      ...baseOptions,
      otlpTracesEndpoint: "file:///tmp/traces",
    })).toThrowErrorMatchingInlineSnapshot(`[Error: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must use HTTP or HTTPS, got: "file:"]`);
  });
});
