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
  "$page-view", "$click", "$keystroke", "$form-submit", "$window-resize", "$copy", "$cut",
  "$paste", "$context-menu", "$print", "$fullscreen-exit", "$error", "$log",
] as const;
export type SystemEventType = typeof SYSTEM_EVENT_TYPES[number];

export const CLIENT_SYSTEM_SPAN_TYPES = ["$page-view", "$away", "$offline"] as const;
export type ClientSystemSpanType = typeof CLIENT_SYSTEM_SPAN_TYPES[number];

const ANALYTICS_EVENT_TYPES = new Set<string>(SYSTEM_EVENT_TYPES.filter((type) => type !== "$log" && type !== "$error"));

function describeSystemEvent(type: SystemEventType): TelemetrySignalDescriptor {
  if (type === "$log") return { kind: "log", lens: "observability", origin: "client", writableOrigins: ["client", "server"], billingItem: "analytics_events", displayName: "Log", description: "Structured SDK logger output or automatically captured console output." };
  if (type === "$error") return { kind: "error", lens: "observability", origin: "client", writableOrigins: ["client", "server"], billingItem: "analytics_events", displayName: "Error", description: "An automatically captured error occurrence." };
  return { kind: "event", lens: "analytics", origin: "client", writableOrigins: ["client"], billingItem: "analytics_events", displayName: type.slice(1).replaceAll("-", " "), description: "A product interaction captured by the Hexclave SDK." };
}

function describeSystemSpan(type: ClientSystemSpanType): TelemetrySignalDescriptor {
  return {
    kind: "span",
    lens: "analytics",
    origin: "client",
    writableOrigins: ["client"],
    billingItem: null,
    displayName: type.slice(1).replaceAll("-", " "),
    description: "A product-session interval captured by the Hexclave SDK.",
  };
}

export const SYSTEM_SIGNALS: ReadonlyMap<string, TelemetrySignalDescriptor> = new Map([
  ...SYSTEM_EVENT_TYPES.map((type) => [`event:${type}`, describeSystemEvent(type)] as const),
  ...CLIENT_SYSTEM_SPAN_TYPES.map((type) => [`span:${type}`, describeSystemSpan(type)] as const),
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
// Instrumentation scope names identify the library/tracer that emitted a span.
// They ride on the SDK wire so operation names can live in `span_type` without
// losing the distinction between customer-authored and auto-instrumented work.
export const TELEMETRY_SCOPE_NAME_MAX_BYTES = 1_024;
// Companion to scope_name: the OTel tracer/instrumentation version string.
export const TELEMETRY_SCOPE_VERSION_MAX_BYTES = 1_024;
// First-class OpenTelemetry span kind / status columns. Kept out of opaque
// `data` so ClickHouse filters and the traces UI can use typed LowCardinality
// columns instead of JSON extraction. `internal` / `unset` are the schema
// defaults and are omitted on the wire when that is what the producer means.
export const TELEMETRY_SPAN_KINDS = ["internal", "server", "client", "producer", "consumer"] as const;
export type TelemetrySpanKind = (typeof TELEMETRY_SPAN_KINDS)[number];
export const TELEMETRY_SPAN_STATUS_CODES = ["unset", "ok", "error"] as const;
export type TelemetrySpanStatusCode = (typeof TELEMETRY_SPAN_STATUS_CODES)[number];
export const TELEMETRY_SPAN_STATUS_MESSAGE_MAX_BYTES = 1_024;
// Cap on a `$log` event's message (the human-readable text; structured
// attributes ride in `data` under the normal item-data cap). Shared so the SDK
// truncates to exactly what the route accepts instead of 400ing the batch.
export const TELEMETRY_MAX_LOG_MESSAGE_BYTES = 8_192;

/**
 * One entry of an `$error` event's `data.debug_images`: an emitted bundle file
 * that appears in the error's stack, together with the debug id of the source
 * map the CLI uploaded for it. Read-time symbolication joins `debug_id` onto
 * the frames it parsed out of the (minified) stack.
 *
 * Note the shape: an ARRAY of `{ code_file, debug_id }` pairs, NOT the more
 * obvious `{ [codeFile]: debugId }` object. `data` is stored in a ClickHouse
 * `JSON` column, which materializes one subcolumn per distinct JSON path it
 * ever sees. A filename-keyed object would therefore mint a brand-new
 * subcolumn for every content-hashed chunk name of every deploy of every
 * project, blow through the table's `max_dynamic_paths` budget, and degrade
 * reads for the entire `logs` table. The array costs exactly two fixed paths
 * (`debug_images.code_file` and `debug_images.debug_id`) forever. Chunk names
 * also contain `.` and `/`, which collide with ClickHouse's JSON path syntax,
 * so they could not be used as keys without escaping anyway.
 */
export type DebugImage = { code_file: string, debug_id: string };

// Caps on `data.debug_images`. A page can legitimately load 100+ chunks, but
// only the handful named by one error's own stack are useful, and `data` as a
// whole must stay under CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES alongside an 8 KB
// message and an 8 KB stack. Both caps are enforced together (count first,
// then serialized bytes) because chunk URLs vary wildly in length.
export const ERROR_MAX_DEBUG_IMAGES = 20;
export const ERROR_MAX_DEBUG_IMAGES_BYTES = 4_096;

/**
 * Truncates to a UTF-8 byte budget without splitting a code point. Lives here
 * (next to the byte caps it enforces) because every bounded telemetry text —
 * `$error` messages/stacks on both tiers, `$log` bodies, the backend's console
 * log capture — shares it. TextEncoder is a standard global in browsers, Node,
 * and edge runtimes, so this keeps the module dependency-free.
 */
export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  // NaN makes every `bytes + width > maxBytes` comparison false, which would
  // otherwise let an invalid budget bypass the cap and return the full value.
  if (Number.isNaN(maxBytes) || maxBytes <= 0 || value === "") return "";

  // Stop as soon as the prefix cannot fit. Encoding the entire public message
  // before truncating defeats the cap on exactly the oversized-input path this
  // helper protects, and slicing by UTF-16 units can leave a lone surrogate at
  // the grouping boundary. Count the UTF-8 width of each code point instead;
  // paired surrogates are admitted as one four-byte code point or rejected as a
  // pair, so the persisted prefix and the grouping hash always agree.
  let bytes = 0;
  let index = 0;
  while (index < value.length) {
    const first = value.charCodeAt(index);
    let width: number;
    let units = 1;
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        width = 4;
        units = 2;
      } else {
        width = 3;
      }
    } else if (first >= 0xd800 && first <= 0xdfff) {
      width = 3;
    } else if (first <= 0x7f) {
      width = 1;
    } else if (first <= 0x7ff) {
      width = 2;
    } else {
      width = 3;
    }
    if (bytes + width > maxBytes) break;
    bytes += width;
    index += units;
  }
  return index === value.length ? value : value.slice(0, index);
}

// The one log-level vocabulary of the telemetry pipeline, ordered least to
// most severe. `$log` items carry exactly one of these strings on the wire
// (`level`), and the events table stores it verbatim — there is deliberately
// no parallel numeric severity scale.
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
export type LogLevel = typeof LOG_LEVELS[number];

// The one uuid shape accepted anywhere in the telemetry pipeline for DATABASE
// identities: batch ids, replay ids, segment ids, user ids, refresh token ids.
// Span identity is NOT a uuid — it is W3C trace context (see below). Defined
// ONCE here because the client tracker, the propagation header codec, the
// server SDK buffer, and the batch route must agree exactly — an id that passes
// locally but fails server-side 400s the whole batch, so drift between copies
// is a data-loss bug.
export const TELEMETRY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PAGE_VIEW_SPAN_TYPE = "$page-view";

// ---------------------------------------------------------------------------
// Native W3C trace context.
//
// Span identity IS W3C: a 32-hex trace id, a 16-hex span id, and a single
// nullable parent span id. This replaces the previous model in which every span
// carried its full ancestor path and ids were namespaced with prefixes; the
// hierarchy now lives in one scalar column and cross-tier propagation is the
// standard `traceparent` header rather than a bespoke one.
// ---------------------------------------------------------------------------

export const W3C_TRACE_ID_RE = /^[0-9a-f]{32}$/;
export const W3C_SPAN_ID_RE = /^[0-9a-f]{16}$/;

const ALL_ZERO_TRACE_ID = "0".repeat(32);
const ALL_ZERO_SPAN_ID = "0".repeat(16);

/** Whether `value` is a usable W3C trace id. The all-zero id is invalid per spec. */
export function isW3cTraceId(value: unknown): value is string {
  return typeof value === "string" && W3C_TRACE_ID_RE.test(value) && value !== ALL_ZERO_TRACE_ID;
}

/** Whether `value` is a usable W3C span id. The all-zero id is invalid per spec. */
export function isW3cSpanId(value: unknown): value is string {
  return typeof value === "string" && W3C_SPAN_ID_RE.test(value) && value !== ALL_ZERO_SPAN_ID;
}

function assertTelemetryUuid(uuid: string): void {
  if (!TELEMETRY_UUID_RE.test(uuid)) {
    throw new HexclaveAssertionError(`Expected a telemetry uuid, got: ${JSON.stringify(uuid)}`);
  }
}

/**
 * Session lifecycle spans need stable W3C identities on both sides of the
 * browser/server boundary. A UUID is exactly 128 bits, so removing its hyphens
 * gives a deterministic trace id without hashing or shared state.
 */
export function uuidToW3cTraceId(uuid: string): string {
  assertTelemetryUuid(uuid);
  return uuid.toLowerCase().replaceAll("-", "");
}

/**
 * The lower 64 bits of a telemetry UUID, used as the stable span id for the
 * corresponding lifecycle node. Generated RFC 4122 UUIDs cannot produce the
 * forbidden all-zero value because their variant bits live in this half.
 */
export function uuidToW3cSpanId(uuid: string): string {
  const spanId = uuidToW3cTraceId(uuid).slice(16);
  if (!isW3cSpanId(spanId)) {
    throw new HexclaveAssertionError("Derived W3C span id is all-zero; expected an RFC 4122 telemetry uuid");
  }
  return spanId;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let hex = "";
  for (const byte of buffer) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * A fresh trace id. Retries rather than accepting the all-zero value — the odds
 * are 2^-128, but an invalid id would silently break every downstream join, so
 * the loop is cheaper than the failure mode.
 */
export function generateW3cTraceId(): string {
  let id = randomHex(16);
  while (id === ALL_ZERO_TRACE_ID) id = randomHex(16);
  return id;
}

export function generateW3cSpanId(): string {
  let id = randomHex(8);
  while (id === ALL_ZERO_SPAN_ID) id = randomHex(8);
  return id;
}
