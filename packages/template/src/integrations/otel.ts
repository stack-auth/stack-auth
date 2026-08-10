/**
 * Node-only OpenTelemetry integration for applications that already configure
 * their own provider. Add the exporter and correlation processor to that
 * provider and set `observability.openTelemetry.provider` to
 * `"existing-provider"` so Hexclave never mutates process-wide OTel globals.
 */
export {
  buildHexclaveOtlpTraceExporterConfig,
  buildHexclaveOtlpLogExporterConfig,
  buildHexclaveOtlpMetricExporterConfig,
  createHexclaveCorrelationSpanProcessor,
  createHexclaveOtlpTraceExporter,
  createHexclaveOtlpLogExporter,
  createHexclaveOtlpMetricExporter,
  type HexclaveOtelExporterOptions,
} from "../lib/hexclave-app/apps/implementations/otel-sdk";
export {
  HexclaveSpanPolicySampler,
  shouldIgnoreNextFrameworkSpan,
  type HexclaveManagedSpan,
} from "../lib/hexclave-app/apps/implementations/otel-span-policy";
