import { opentelemetry, record } from "@elysia/opentelemetry";
import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

type TraceAttributeValue = string | number | boolean | string[] | number[] | boolean[];
type TraceSpan = {
  setAttribute: (key: string, value: TraceAttributeValue) => unknown,
};

const configuredTraceExporterUrl = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const traceExporterUrl = configuredTraceExporterUrl ?? (getNodeEnvironment() === "production"
  ? undefined
  : `http://localhost:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")}31/v1/traces`);

export const instrumentation = opentelemetry({
  serviceName: "bulldozer-js",
  traceExporter: traceExporterUrl === undefined || traceExporterUrl.length === 0 ? undefined : new OTLPTraceExporter({
    url: traceExporterUrl,
  }),
});

export async function traceSpan<T>(optionsOrDescription: string | { description: string, attributes?: Record<string, TraceAttributeValue> }, fn: (span: TraceSpan) => Promise<T>): Promise<T> {
  const options = typeof optionsOrDescription === "string" ? { description: optionsOrDescription } : optionsOrDescription;
  return await record(`bulldozer-js.${options.description}`, async (span) => {
    for (const [key, value] of Object.entries(options.attributes ?? {})) {
      span.setAttribute(key, value);
    }
    return await fn(span);
  });
}
