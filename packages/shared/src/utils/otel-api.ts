/**
 * Re-export doorway for the parts of `@opentelemetry/api` that the SDK's
 * hidden library-span bridge (packages/template's library-span-bridge.ts)
 * implements against.
 *
 * Why this module exists: packages/template must NOT take a direct dependency
 * on `@opentelemetry/api` — the SDK's public story is "no OTel knowledge or
 * configuration required", and its dependency tree should reflect that.
 * packages/shared already depends on `@opentelemetry/api` for its own
 * telemetry helpers, so it re-exports exactly the values and types the bridge
 * needs (nothing more), keeping the OTel API surface we commit to reviewable
 * in one place. Note that the `trace`/`context` singletons exported here are
 * the PROCESS-WIDE API entry points (`@opentelemetry/api` registers its
 * globals on a `Symbol.for`-keyed globalThis slot), which is precisely what
 * lets the bridge become the tracer provider that third-party libraries
 * (Prisma instrumentation, Drizzle, Vercel AI SDK) resolve at runtime.
 */
export { context, createContextKey, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
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
  Tracer,
  TracerOptions,
  TracerProvider,
} from "@opentelemetry/api";
