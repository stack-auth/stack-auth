/**
 * Node-only OpenTelemetry integration for applications that already configure
 * their own provider. Add the exporter, correlation processor, and HTTP
 * metric span processor to that provider and set
 * `observability.openTelemetry.provider` to `"existing-provider"` so Hexclave
 * never mutates process-wide OTel globals.
 */
export {
  buildHexclaveOtlpTraceExporterConfig,
  buildHexclaveOtlpLogExporterConfig,
  buildHexclaveOtlpMetricExporterConfig,
  createHexclaveCorrelationSpanProcessor,
  createHexclaveHttpMetricSpanProcessor,
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
