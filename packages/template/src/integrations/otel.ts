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
// `registerManagedOtel` is additionally exposed here because this subpath is
// the loader's bundler-safe anchor: when the SDK's server code is bundled into
// an app (e.g. Next.js/Turbopack bundles workspace dependencies into server
// chunks), `otel-sdk-loader.ts` cannot resolve its relative `./otel-sdk`
// sibling from inside the chunk, so it falls back to requiring
// `<package>/otel` through node_modules — which must therefore expose the
// managed entry point. This subpath is already Node-only, so the export adds
// no new runtime surface to browser bundles.
export { registerManagedOtel } from "../lib/hexclave-app/apps/implementations/otel-sdk";
export type { ManagedOtelOptions, ManagedOtelRegistration } from "../lib/hexclave-app/apps/implementations/otel-managed";
