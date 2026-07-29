import { HexclaveAssertionError } from "./errors";

export type TelemetryLens = "analytics" | "observability";
export type TelemetrySignalKind = "event" | "log" | "error" | "span";
export type TelemetrySignalOrigin = "client" | "server" | "derived";
export type TelemetryWriterOrigin = Exclude<TelemetrySignalOrigin, "derived">;
export type TelemetryBillingItem = "analytics_events" | "analytics_spans";
export const TELEMETRY_RESOURCE_STRING_MAX_LENGTH = 255;
export const TELEMETRY_RESOURCE_ATTRIBUTES_MAX_BYTES = 16 * 1024;

export type TelemetryResourceAttributePrimitive = string | number | boolean | null;
export type TelemetryResourceAttributeValue = TelemetryResourceAttributePrimitive | TelemetryResourceAttributePrimitive[];

export type TelemetryResource = {
  service: {
    name: string,
    namespace?: string,
    version?: string,
    instanceId?: string,
  },
  deploymentEnvironmentName?: string,
  attributes?: Record<string, TelemetryResourceAttributeValue>,
};

function getUnexpectedObjectKey(value: object, allowedKeys: readonly string[]): string | null {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).find((key) => !allowed.has(key)) ?? null;
}

export function getTelemetryResourceError(resource: unknown): string | null {
  if (typeof resource !== "object" || resource === null || Array.isArray(resource)) {
    return "telemetry.resource must be an object";
  }
  const unexpectedResourceKey = getUnexpectedObjectKey(resource, ["service", "deploymentEnvironmentName", "attributes"]);
  if (unexpectedResourceKey !== null) {
    return `telemetry.resource contains unknown field ${JSON.stringify(unexpectedResourceKey)}`;
  }
  const service = Reflect.get(resource, "service");
  if (typeof service !== "object" || service === null || Array.isArray(service)) {
    return "telemetry.resource.service must be an object";
  }
  const unexpectedServiceKey = getUnexpectedObjectKey(service, ["name", "namespace", "version", "instanceId"]);
  if (unexpectedServiceKey !== null) {
    return `telemetry.resource.service contains unknown field ${JSON.stringify(unexpectedServiceKey)}`;
  }
  const fields = [
    ["service.name", Reflect.get(service, "name"), true],
    ["service.namespace", Reflect.get(service, "namespace"), false],
    ["service.version", Reflect.get(service, "version"), false],
    ["service.instanceId", Reflect.get(service, "instanceId"), false],
    ["deploymentEnvironmentName", Reflect.get(resource, "deploymentEnvironmentName"), false],
  ] as const;
  for (const [name, value, required] of fields) {
    if (value === undefined && !required) continue;
    if (typeof value !== "string" || value.trim() === "") {
      return `telemetry.resource.${name} must be a non-empty string`;
    }
    if (value.length > TELEMETRY_RESOURCE_STRING_MAX_LENGTH) {
      return `telemetry.resource.${name} must be at most ${TELEMETRY_RESOURCE_STRING_MAX_LENGTH} characters`;
    }
  }
  const attributes = Reflect.get(resource, "attributes");
  if (attributes === undefined) return null;
  if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
    return "telemetry.resource.attributes must be a plain object";
  }
  const prototype = Object.getPrototypeOf(attributes);
  if (prototype !== Object.prototype && prototype !== null) {
    return "telemetry.resource.attributes must be a plain object";
  }
  for (const [name, value] of Object.entries(attributes)) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some((item) => (
      item !== null
      && typeof item !== "string"
      && typeof item !== "boolean"
      && (typeof item !== "number" || !Number.isFinite(item))
    ))) {
      return `telemetry.resource.attributes.${name} must be a primitive or an array of primitives`;
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(attributes);
  } catch {
    return "telemetry.resource.attributes must be JSON-serializable";
  }
  if (new TextEncoder().encode(serialized).length > TELEMETRY_RESOURCE_ATTRIBUTES_MAX_BYTES) {
    return `telemetry.resource.attributes must serialize to at most ${TELEMETRY_RESOURCE_ATTRIBUTES_MAX_BYTES} bytes`;
  }
  return null;
}

export function isTelemetryResource(resource: unknown): resource is TelemetryResource {
  return getTelemetryResourceError(resource) === null;
}

/**
 * Resource identity is immutable for the lifetime of an app instance. Copy it
 * at the SDK boundary so later mutations to the caller's config cannot relabel
 * telemetry emitted by an already-created app.
 */
export function snapshotTelemetryResource(resource: unknown): TelemetryResource {
  // `isTelemetryResource` is `getTelemetryResourceError(...) === null` as a type predicate; we call
  // the error-returning form first so the thrown message says which field was wrong, then the
  // predicate form purely to narrow `unknown` (a `string | null` return can't narrow on its own).
  const error = getTelemetryResourceError(resource);
  if (error !== null) {
    throw new HexclaveAssertionError(error);
  }
  if (!isTelemetryResource(resource)) {
    throw new HexclaveAssertionError("Validated telemetry.resource did not satisfy isTelemetryResource");
  }

  const { service, deploymentEnvironmentName, attributes } = resource;

  return {
    service: {
      name: service.name,
      ...service.namespace === undefined ? {} : { namespace: service.namespace },
      ...service.version === undefined ? {} : { version: service.version },
      ...service.instanceId === undefined ? {} : { instanceId: service.instanceId },
    },
    ...deploymentEnvironmentName === undefined ? {} : { deploymentEnvironmentName },
    // Deep-copy so later mutation of the caller's nested attributes object can't relabel telemetry.
    // `getTelemetryResourceError` already proved this is JSON-serializable.
    ...attributes === undefined ? {} : { attributes: JSON.parse(JSON.stringify(attributes)) },
  };
}
export type TelemetrySignalDescriptor = {
  kind: TelemetrySignalKind,
  lens: TelemetryLens,
  origin: TelemetrySignalOrigin,
  writableOrigins: readonly TelemetryWriterOrigin[],
  billingItem: TelemetryBillingItem | null,
  displayName: string,
  description: string,
};

export const SYSTEM_EVENT_TYPES = [
  "$page-view", "$click", "$form-submit", "$window-resize", "$copy", "$cut",
  "$paste", "$context-menu", "$print", "$fullscreen-exit", "$error", "$log",
] as const;
export type SystemEventType = typeof SYSTEM_EVENT_TYPES[number];

export const CLIENT_SYSTEM_SPAN_TYPES = ["$page-view", "$away", "$offline", "$http-client"] as const;
export type ClientSystemSpanType = typeof CLIENT_SYSTEM_SPAN_TYPES[number];

export const SERVER_SYSTEM_SPAN_TYPES = ["$lib-span"] as const;
export type ServerSystemSpanType = typeof SERVER_SYSTEM_SPAN_TYPES[number];

const ANALYTICS_EVENT_TYPES = new Set<string>(SYSTEM_EVENT_TYPES.filter((type) => type !== "$log" && type !== "$error"));
const ANALYTICS_SPAN_TYPES = new Set<string>(["$page-view", "$away", "$offline"]);
const SERVER_SPAN_TYPES = new Set<string>(SERVER_SYSTEM_SPAN_TYPES);

function describeSystemEvent(type: SystemEventType): TelemetrySignalDescriptor {
  if (type === "$log") return { kind: "log", lens: "observability", origin: "client", writableOrigins: ["client", "server"], billingItem: "analytics_events", displayName: "Log", description: "Structured SDK logger output or automatically captured console output." };
  if (type === "$error") return { kind: "error", lens: "observability", origin: "client", writableOrigins: ["client", "server"], billingItem: "analytics_events", displayName: "Error", description: "An automatically captured error occurrence." };
  return { kind: "event", lens: "analytics", origin: "client", writableOrigins: ["client"], billingItem: "analytics_events", displayName: type.slice(1).replaceAll("-", " "), description: "A product interaction captured by the Hexclave SDK." };
}

function describeSystemSpan(type: ClientSystemSpanType | ServerSystemSpanType): TelemetrySignalDescriptor {
  const analyticsOwned = ANALYTICS_SPAN_TYPES.has(type);
  const writableOrigins: readonly TelemetryWriterOrigin[] = type === "$lib-span"
    ? ["server"]
    : type === "$http-client"
      ? ["client", "server"]
      : ["client"];
  return {
    kind: "span",
    lens: analyticsOwned ? "analytics" : "observability",
    origin: SERVER_SPAN_TYPES.has(type) ? "server" : "client",
    writableOrigins,
    billingItem: null,
    displayName: type.slice(1).replaceAll("-", " "),
    description: analyticsOwned ? "A product-session interval captured by the Hexclave SDK." : "A code-execution interval captured by the Hexclave SDK.",
  };
}

export const SYSTEM_SIGNALS: ReadonlyMap<string, TelemetrySignalDescriptor> = new Map([
  ...SYSTEM_EVENT_TYPES.map((type) => [`event:${type}`, describeSystemEvent(type)] as const),
  ...CLIENT_SYSTEM_SPAN_TYPES.map((type) => [`span:${type}`, describeSystemSpan(type)] as const),
  ...SERVER_SYSTEM_SPAN_TYPES.map((type) => [`span:${type}`, describeSystemSpan(type)] as const),
]);

export function classifyTelemetrySignal(type: string, wireKind: "event" | "span", origin?: TelemetrySignalOrigin): TelemetrySignalDescriptor {
  const systemSignal = SYSTEM_SIGNALS.get(`${wireKind}:${type}`);
  if (systemSignal != null) return origin === undefined ? systemSignal : { ...systemSignal, origin };
  return wireKind === "event"
    ? { kind: "event", lens: "analytics", origin: origin ?? "client", writableOrigins: ["client", "server"], billingItem: "analytics_events", displayName: type, description: "A custom product event recorded by the application." }
    : { kind: "span", lens: "observability", origin: origin ?? "client", writableOrigins: ["client", "server"], billingItem: "analytics_spans", displayName: type, description: "A custom code-execution interval recorded by the application." };
}

export function isTelemetrySignalOwnedBy(type: string, wireKind: "event" | "span", lens: TelemetryLens): boolean {
  return classifyTelemetrySignal(type, wireKind).lens === lens;
}

export function canWriteTelemetrySignal(type: string, wireKind: "event" | "span", origin: TelemetryWriterOrigin): boolean {
  return classifyTelemetrySignal(type, wireKind).writableOrigins.includes(origin);
}

export function isAnalyticsSystemEvent(type: string): boolean {
  return ANALYTICS_EVENT_TYPES.has(type);
}

// The analytics WIRE CONTRACT shared between the browser/server SDKs and the
// backend ingestion routes. This module must stay dependency-free (no
// @opentelemetry/api, no node builtins): it is imported by the client SDK's
// event tracker, so anything pulled in here lands in every customer's initial
// bundle. Hexclave's own server-side tracing helpers live in ./telemetry.tsx,
// which re-exports these constants for backend convenience.

// Custom (user-defined) event/span type names: must not start with `$` (reserved
// for system types), start with a letter, and stay within 64 chars. Shared by
// the SDK and analytics batch route so local validation cannot drift from the
// server's batch-level rejection rules.
export const CUSTOM_TELEMETRY_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/;
// The released browser tracker flushes at roughly 64 KB per batch. Using that
// same ceiling for every event/span preserves its generated payloads while
// giving current custom telemetry one bounded validation contract.
export const CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES = 64_000;
export const CUSTOM_TELEMETRY_MAX_PARENT_CHAIN = 10;
// Cap on a `$log` event's message (the human-readable text; structured
// attributes ride in `data` under the normal item-data cap). Shared so the SDK
// truncates to exactly what the route accepts instead of 400ing the batch.
export const TELEMETRY_MAX_LOG_MESSAGE_BYTES = 8_192;

/**
 * Truncates to a UTF-8 byte budget without splitting a code point. Lives here
 * (next to the byte caps it enforces) because every bounded telemetry text —
 * `$error` messages/stacks on both tiers, `$log` bodies, the backend's console
 * log capture — shares it. TextEncoder is a standard global in browsers, Node,
 * and edge runtimes, so this keeps the module dependency-free.
 */
export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  // Chop from a chars-can't-be-shorter-than-bytes upper bound down to budget;
  // the 64-char step keeps this O(few iterations) for realistic inputs.
  let sliced = value.slice(0, maxBytes);
  while (sliced.length > 0 && encoder.encode(sliced).length > maxBytes) {
    sliced = sliced.slice(0, Math.max(0, sliced.length - 64));
  }
  return sliced;
}

// The one log-level vocabulary of the telemetry pipeline, ordered least to
// most severe. `$log` items carry exactly one of these strings on the wire
// (`level`), and the events table stores it verbatim — there is deliberately
// no parallel numeric severity scale.
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
export type LogLevel = typeof LOG_LEVELS[number];

// The one uuid shape accepted anywhere in the telemetry pipeline (span ids,
// parent ids, batch ids, replay ids). Defined ONCE here because the client
// tracker, the propagation header codec, the server SDK buffer, and the batch
// route must agree exactly — an id that passes locally but fails server-side
// 400s the whole batch, so drift between copies is a data-loss bug.
export const TELEMETRY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PAGE_VIEW_SPAN_TYPE = "$page-view";
export const HTTP_CLIENT_SPAN_TYPE = "$http-client";
export const LIB_SPAN_TYPE = "$lib-span";

// ---------------------------------------------------------------------------
// Native uuid ↔ W3C trace-context bridge.
//
// A uuid is 16 bytes — exactly the size of a W3C trace id (32 lowercase hex
// chars); its lower 8 bytes are exactly a W3C span id (16 hex chars). The SDK
// exploits this to connect its native span model to standard OpenTelemetry
// tracing WITHOUT any ingestion-side correlation state: the `$http-client`
// span's uuid U becomes the `traceparent` sent with the request, so every
// backend span of that request stores `trace_id = uuidToW3cTraceId(U)` — a
// pure function of the client span's own id, joinable at read time.
// ---------------------------------------------------------------------------

function assertTelemetryUuid(uuid: string): void {
  if (!TELEMETRY_UUID_RE.test(uuid)) {
    throw new HexclaveAssertionError(`Expected a telemetry uuid, got: ${JSON.stringify(uuid)}`);
  }
}

/** The 32-hex W3C trace id deterministically derived from a native span uuid. */
export function uuidToW3cTraceId(uuid: string): string {
  assertTelemetryUuid(uuid);
  return uuid.toLowerCase().replaceAll("-", "");
}

/**
 * The 16-hex W3C span id derived from a native span uuid (its lower 8 bytes).
 * For RFC 4122 uuids this is never the forbidden all-zero span id: byte 8
 * carries the variant bits (top bits `10`), so the first hex char is 8–b.
 * The regex above technically admits a `0` variant nibble, so we still fail
 * loud on the (never-generated-by-us) all-zero case rather than emit an
 * invalid traceparent.
 */
export function uuidToW3cSpanId(uuid: string): string {
  const spanId = uuidToW3cTraceId(uuid).slice(16);
  if (spanId === "0000000000000000") {
    throw new HexclaveAssertionError("Derived W3C span id is all-zero; the uuid must have been generated outside crypto.randomUUID, which guarantees RFC 4122 variant bits");
  }
  return spanId;
}

/**
 * The `traceparent` header value derived from a native `$http-client` span
 * uuid. Always flagged sampled (`01`): the client only emits a traceparent
 * when it actually stored the bridge span, and parent-based samplers
 * downstream should then keep the whole request trace.
 */
export function buildTraceparent(uuid: string): string {
  return `00-${uuidToW3cTraceId(uuid)}-${uuidToW3cSpanId(uuid)}-01`;
}
