/**
 * Re-export doorway for shared OpenTelemetry API consumers.
 *
 * The `trace`/`context` singletons exported here are the process-wide API entry
 * points, shared with the real SDK provider and third-party instrumentation.
 */
export { context, createContextKey, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
export type {
  Attributes,
  AttributeValue,
  Context,
  ContextManager,
  Exception,
  HrTime,
  Link,
  Span,
  SpanAttributes,
  SpanAttributeValue,
  SpanContext,
  SpanOptions,
  SpanStatus,
  TimeInput,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
  Tracer,
  TracerOptions,
  TracerProvider,
} from "@opentelemetry/api";
