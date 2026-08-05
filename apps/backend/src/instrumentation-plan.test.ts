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

  // The pre-Elysia @sentry/nextjs setup enabled Sentry for any non-development,
  // non-CI environment with a DSN — not just NODE_ENV=production. These tests pin
  // that behavior so staging/preview-like NODE_ENV values keep error reporting.
  it("enables Sentry for a custom non-development NODE_ENV such as staging", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      nodeEnvironment: "staging",
      sentryDsn: "https://public@example.invalid/1",
    }).sentryEnabled).toBe(true);
  });

  it("does not enable Sentry in development even when a DSN is set", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      nodeEnvironment: "development",
      sentryDsn: "https://public@example.invalid/1",
    }).sentryEnabled).toBe(false);
  });

  it("does not enable Sentry in test even when a DSN is set", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      nodeEnvironment: "test",
      sentryDsn: "https://public@example.invalid/1",
    }).sentryEnabled).toBe(false);
  });

  it("does not enable Sentry when the DSN is empty", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
    }).sentryEnabled).toBe(false);
  });

  it("does not enable Sentry in CI even with a DSN and a production NODE_ENV", () => {
    expect(createBackendInstrumentationPlan({
      ...baseOptions,
      ci: "true",
      sentryDsn: "https://public@example.invalid/1",
    }).sentryEnabled).toBe(false);
  });

  it("names the offending environment variable when the OTLP endpoint is not a URL", () => {
    expect(() => createBackendInstrumentationPlan({
      ...baseOptions,
      otlpEndpoint: "not a url",
    })).toThrowErrorMatchingInlineSnapshot(`[Error: OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL: "not a url"]`);
  });

  it("names the offending environment variable when the traces endpoint is not a URL", () => {
    expect(() => createBackendInstrumentationPlan({
      ...baseOptions,
      otlpTracesEndpoint: "::::",
    })).toThrowErrorMatchingInlineSnapshot(`[Error: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is not a valid URL: "::::"]`);
  });

  it("rejects non-HTTP exporter endpoints", () => {
    expect(() => createBackendInstrumentationPlan({
      ...baseOptions,
      otlpTracesEndpoint: "file:///tmp/traces",
    })).toThrowErrorMatchingInlineSnapshot(`[Error: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must use HTTP or HTTPS, got: "file:"]`);
  });
});
