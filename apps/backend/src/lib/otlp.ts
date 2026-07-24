import { stripLoneSurrogates } from "./clickhouse";

const TRACE_ID_RE = /^[0-9a-f]{32}$/i;
const SPAN_ID_RE = /^[0-9a-f]{16}$/i;
const UNSIGNED_INTEGER_RE = /^(0|[1-9][0-9]*)$/;
const MAX_SPANS_PER_REQUEST = 10_000;
const MAX_ATTRIBUTES_PER_ENTITY = 256;
const MAX_NESTING_DEPTH = 16;
const MAX_STRING_LENGTH = 64 * 1024;

const SPAN_KINDS = [
  "SPAN_KIND_UNSPECIFIED",
  "SPAN_KIND_INTERNAL",
  "SPAN_KIND_SERVER",
  "SPAN_KIND_CLIENT",
  "SPAN_KIND_PRODUCER",
  "SPAN_KIND_CONSUMER",
] as const;

const STATUS_CODES = [
  "STATUS_CODE_UNSET",
  "STATUS_CODE_OK",
  "STATUS_CODE_ERROR",
] as const;

export class OtlpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtlpValidationError";
  }
}

export type NormalizedOtlpSpan = {
  trace_id: string,
  span_id: string,
  name: string,
  started_at: Date,
  ended_at: Date,
  parent_span_ids: string[],
  kind: string,
  status_code: string,
  status_message: string | null,
  trace_state: string | null,
  trace_flags: number,
  service_namespace: string | null,
  service_name: string | null,
  service_version: string | null,
  service_instance_id: string | null,
  deployment_environment_name: string | null,
  resource_attributes: string,
  resource_schema_url: string | null,
  scope_name: string | null,
  scope_version: string | null,
  scope_attributes: string,
  scope_schema_url: string | null,
  attributes: string,
  dropped_resource_attributes: number,
  dropped_scope_attributes: number,
  dropped_attributes: number,
  dropped_events: number,
  dropped_links: number,
  events: NormalizedOtlpSpanEvent[],
  links: NormalizedOtlpSpanLink[],
  version: number,
};

export type NormalizedOtlpSpanEvent = {
  name: string,
  at: Date,
  attributes: Record<string, unknown>,
  dropped_attributes: number,
};

export type NormalizedOtlpSpanLink = {
  linked_trace_id: string,
  linked_span_id: string,
  linked_trace_state: string | null,
  linked_trace_flags: number,
  attributes: string,
  dropped_attributes: number,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new OtlpValidationError(`${path} must be an object`);
  return value;
}

function getArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new OtlpValidationError(`${path} must be an array`);
  return value;
}

function optionalArray(value: unknown, path: string): unknown[] {
  return value === undefined ? [] : getArray(value, path);
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> {
  return value === undefined ? {} : getRecord(value, path);
}

function requiredString(value: unknown, path: string, maxLength = MAX_STRING_LENGTH): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OtlpValidationError(`${path} must be a non-empty string`);
  }
  if (value.length > maxLength) throw new OtlpValidationError(`${path} is too long`);
  return value;
}

function boundedString(value: unknown, path: string, maxLength = MAX_STRING_LENGTH): string {
  if (typeof value !== "string") throw new OtlpValidationError(`${path} must be a string`);
  if (value.length > maxLength) throw new OtlpValidationError(`${path} is too long`);
  return value;
}

function optionalString(value: unknown, path: string, maxLength = MAX_STRING_LENGTH): string | null {
  if (value === undefined || value === "") return null;
  return requiredString(value, path, maxLength);
}

function unsignedInteger(value: unknown, path: string, max: number): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && UNSIGNED_INTEGER_RE.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new OtlpValidationError(`${path} must be an unsigned integer no greater than ${max}`);
  }
  return parsed;
}

function optionalUnsignedInteger(value: unknown, path: string, max: number): number {
  return value === undefined ? 0 : unsignedInteger(value, path, max);
}

function identifier(value: unknown, path: string, regex: RegExp, expectedLength: number): string {
  const result = requiredString(value, path, expectedLength).toLowerCase();
  if (!regex.test(result) || /^0+$/.test(result)) {
    throw new OtlpValidationError(`${path} must be a non-zero ${expectedLength}-character hexadecimal identifier`);
  }
  return result;
}

function optionalSpanId(value: unknown, path: string): string | null {
  if (value === undefined || value === "") return null;
  return identifier(value, path, SPAN_ID_RE, 16);
}

function unixNano(value: unknown, path: string): { raw: string, date: Date, millis: number } {
  const raw = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : requiredString(value, path, 20);
  if (!UNSIGNED_INTEGER_RE.test(raw)) throw new OtlpValidationError(`${path} must be an unsigned decimal integer string`);

  const nanos = BigInt(raw);
  if (nanos === 0n || nanos > 18_446_744_073_709_551_615n) {
    throw new OtlpValidationError(`${path} must be a non-zero uint64 nanosecond timestamp`);
  }
  const millisBigInt = nanos / 1_000_000n;
  if (millisBigInt > BigInt(8_640_000_000_000_000)) {
    throw new OtlpValidationError(`${path} is outside the supported Date range`);
  }
  const millis = Number(millisBigInt);
  return { raw, date: new Date(millis), millis };
}

function decodeAnyValue(value: unknown, path: string, depth: number): unknown {
  if (depth > MAX_NESTING_DEPTH) throw new OtlpValidationError(`${path} is nested too deeply`);
  const anyValue = getRecord(value, path);
  const populatedKeys = ["stringValue", "boolValue", "intValue", "doubleValue", "arrayValue", "kvlistValue", "bytesValue"]
    .filter((key) => anyValue[key] !== undefined);
  if (populatedKeys.length !== 1) throw new OtlpValidationError(`${path} must contain exactly one AnyValue variant`);

  const key = populatedKeys[0];
  const variant = anyValue[key];
  switch (key) {
    case "stringValue": {
      return boundedString(variant, `${path}.stringValue`);
    }
    case "boolValue": {
      if (typeof variant !== "boolean") throw new OtlpValidationError(`${path}.boolValue must be a boolean`);
      return variant;
    }
    case "intValue": {
      const integer = typeof variant === "number" && Number.isSafeInteger(variant) ? String(variant) : requiredString(variant, `${path}.intValue`, 20);
      if (!/^-?(0|[1-9][0-9]*)$/.test(integer)) throw new OtlpValidationError(`${path}.intValue must be a decimal integer string`);
      return integer;
    }
    case "doubleValue": {
      if (typeof variant !== "number" || !Number.isFinite(variant)) throw new OtlpValidationError(`${path}.doubleValue must be a finite number`);
      return variant;
    }
    case "bytesValue": {
      return { bytes_base64: boundedString(variant, `${path}.bytesValue`) };
    }
    case "arrayValue": {
      const arrayValue = getRecord(variant, `${path}.arrayValue`);
      return optionalArray(arrayValue.values, `${path}.arrayValue.values`)
        .map((item, index) => decodeAnyValue(item, `${path}.arrayValue.values[${index}]`, depth + 1));
    }
    case "kvlistValue": {
      const kvlistValue = getRecord(variant, `${path}.kvlistValue`);
      return attributesToObject(kvlistValue.values, `${path}.kvlistValue.values`, depth + 1);
    }
    default: {
      throw new OtlpValidationError(`${path} contains an unsupported AnyValue variant`);
    }
  }
}

function attributesToObject(value: unknown, path: string, depth = 0): Record<string, unknown> {
  const attributes = optionalArray(value, path);
  if (attributes.length > MAX_ATTRIBUTES_PER_ENTITY) {
    throw new OtlpValidationError(`${path} contains more than ${MAX_ATTRIBUTES_PER_ENTITY} attributes`);
  }
  const entries = new Map<string, unknown>();
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = getRecord(attributes[index], `${path}[${index}]`);
    const key = requiredString(attribute.key, `${path}[${index}].key`, 1024);
    if (entries.has(key)) throw new OtlpValidationError(`${path} contains duplicate key ${JSON.stringify(key)}`);
    entries.set(key, decodeAnyValue(attribute.value, `${path}[${index}].value`, depth + 1));
  }
  return Object.fromEntries(entries);
}

function normalizeEvents(value: unknown, path: string): NormalizedOtlpSpanEvent[] {
  return optionalArray(value, path).map((eventValue, index) => {
    const eventPath = `${path}[${index}]`;
    const event = getRecord(eventValue, eventPath);
    const timestamp = unixNano(event.timeUnixNano, `${eventPath}.timeUnixNano`);
    return {
      at: timestamp.date,
      name: requiredString(event.name, `${eventPath}.name`, 1024),
      attributes: attributesToObject(event.attributes, `${eventPath}.attributes`),
      dropped_attributes: optionalUnsignedInteger(event.droppedAttributesCount, `${eventPath}.droppedAttributesCount`, 0xffff_ffff),
    };
  });
}

function normalizeLinks(value: unknown, path: string): NormalizedOtlpSpanLink[] {
  return optionalArray(value, path).map((linkValue, index) => {
    const linkPath = `${path}[${index}]`;
    const link = getRecord(linkValue, linkPath);
    return {
      linked_trace_id: identifier(link.traceId, `${linkPath}.traceId`, TRACE_ID_RE, 32),
      linked_span_id: identifier(link.spanId, `${linkPath}.spanId`, SPAN_ID_RE, 16),
      linked_trace_state: optionalString(link.traceState, `${linkPath}.traceState`, 512),
      linked_trace_flags: optionalUnsignedInteger(link.flags, `${linkPath}.flags`, 0xffff_ffff),
      attributes: JSON.stringify(attributesToObject(link.attributes, `${linkPath}.attributes`)),
      dropped_attributes: optionalUnsignedInteger(link.droppedAttributesCount, `${linkPath}.droppedAttributesCount`, 0xffff_ffff),
    };
  });
}

function takeOptionalStringAttribute(attributes: Record<string, unknown>, key: string, path: string): string | null {
  const value = attributes[key];
  if (value === undefined) return null;
  if (typeof value !== "string") throw new OtlpValidationError(`${path}.${key} must be a string`);
  delete attributes[key];
  return value;
}

function expandParentSpanPaths(rows: NormalizedOtlpSpan[]): void {
  const byTraceId = new Map<string, Map<string, NormalizedOtlpSpan>>();
  for (const row of rows) {
    let trace = byTraceId.get(row.trace_id);
    if (trace === undefined) {
      trace = new Map();
      byTraceId.set(row.trace_id, trace);
    }
    if (trace.has(row.span_id)) {
      throw new OtlpValidationError(
        `request contains duplicate span ${JSON.stringify(row.span_id)} in trace ${JSON.stringify(row.trace_id)}`,
      );
    }
    trace.set(row.span_id, row);
  }

  const expanded = new Map<NormalizedOtlpSpan, string[]>();
  const resolving = new Set<NormalizedOtlpSpan>();
  const resolve = (row: NormalizedOtlpSpan): string[] => {
    const cached = expanded.get(row);
    if (cached !== undefined) return cached;
    if (resolving.has(row)) {
      throw new OtlpValidationError(
        `request contains a parent cycle at span ${JSON.stringify(row.span_id)} in trace ${JSON.stringify(row.trace_id)}`,
      );
    }
    resolving.add(row);
    const directParentId = row.parent_span_ids.at(0);
    let result: string[] = [];
    if (directParentId !== undefined) {
      // OTLP span IDs are unique only within a trace. Never resolve a parent
      // through another trace from the same export request.
      const parent = byTraceId.get(row.trace_id)?.get(directParentId);
      result = parent === undefined ? [directParentId] : [...resolve(parent), directParentId];
    }
    resolving.delete(row);
    expanded.set(row, result);
    return result;
  };

  for (const row of rows) row.parent_span_ids = resolve(row);
}

export function normalizeOtlpJsonTraceRequest(value: unknown): NormalizedOtlpSpan[] {
  const request = getRecord(value, "request");
  const resourceSpans = optionalArray(request.resourceSpans, "request.resourceSpans");
  const rows: NormalizedOtlpSpan[] = [];

  for (let resourceIndex = 0; resourceIndex < resourceSpans.length; resourceIndex += 1) {
    const resourceSpanPath = `request.resourceSpans[${resourceIndex}]`;
    const resourceSpan = getRecord(resourceSpans[resourceIndex], resourceSpanPath);
    const resource = optionalRecord(resourceSpan.resource, `${resourceSpanPath}.resource`);
    const resourceAttributes = attributesToObject(resource.attributes, `${resourceSpanPath}.resource.attributes`);
    const serviceNamespace = takeOptionalStringAttribute(resourceAttributes, "service.namespace", `${resourceSpanPath}.resource.attributes`);
    const serviceName = takeOptionalStringAttribute(resourceAttributes, "service.name", `${resourceSpanPath}.resource.attributes`);
    const serviceVersion = takeOptionalStringAttribute(resourceAttributes, "service.version", `${resourceSpanPath}.resource.attributes`);
    const serviceInstanceId = takeOptionalStringAttribute(resourceAttributes, "service.instance.id", `${resourceSpanPath}.resource.attributes`);
    const deploymentEnvironmentName = takeOptionalStringAttribute(resourceAttributes, "deployment.environment.name", `${resourceSpanPath}.resource.attributes`);
    const resourceSchemaUrl = optionalString(resourceSpan.schemaUrl, `${resourceSpanPath}.schemaUrl`);
    const droppedResourceAttributes = optionalUnsignedInteger(resource.droppedAttributesCount, `${resourceSpanPath}.resource.droppedAttributesCount`, 0xffff_ffff);

    const scopeSpans = optionalArray(resourceSpan.scopeSpans, `${resourceSpanPath}.scopeSpans`);
    for (let scopeIndex = 0; scopeIndex < scopeSpans.length; scopeIndex += 1) {
      const scopeSpanPath = `${resourceSpanPath}.scopeSpans[${scopeIndex}]`;
      const scopeSpan = getRecord(scopeSpans[scopeIndex], scopeSpanPath);
      const scope = optionalRecord(scopeSpan.scope, `${scopeSpanPath}.scope`);
      const scopeName = optionalString(scope.name, `${scopeSpanPath}.scope.name`, 1024);
      const scopeVersion = optionalString(scope.version, `${scopeSpanPath}.scope.version`, 1024);
      const scopeAttributes = attributesToObject(scope.attributes, `${scopeSpanPath}.scope.attributes`);
      const scopeSchemaUrl = optionalString(scopeSpan.schemaUrl, `${scopeSpanPath}.schemaUrl`);
      const droppedScopeAttributes = optionalUnsignedInteger(scope.droppedAttributesCount, `${scopeSpanPath}.scope.droppedAttributesCount`, 0xffff_ffff);

      const spans = optionalArray(scopeSpan.spans, `${scopeSpanPath}.spans`);
      for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
        if (rows.length >= MAX_SPANS_PER_REQUEST) {
          throw new OtlpValidationError(`request contains more than ${MAX_SPANS_PER_REQUEST} spans`);
        }
        const spanPath = `${scopeSpanPath}.spans[${spanIndex}]`;
        const span = getRecord(spans[spanIndex], spanPath);
        const traceId = identifier(span.traceId, `${spanPath}.traceId`, TRACE_ID_RE, 32);
        const spanId = identifier(span.spanId, `${spanPath}.spanId`, SPAN_ID_RE, 16);
        const parentSpanId = optionalSpanId(span.parentSpanId, `${spanPath}.parentSpanId`);
        const start = unixNano(span.startTimeUnixNano, `${spanPath}.startTimeUnixNano`);
        const end = unixNano(span.endTimeUnixNano, `${spanPath}.endTimeUnixNano`);
        if (BigInt(end.raw) < BigInt(start.raw)) throw new OtlpValidationError(`${spanPath}.endTimeUnixNano must not precede startTimeUnixNano`);

        const kind = optionalUnsignedInteger(span.kind, `${spanPath}.kind`, SPAN_KINDS.length - 1);
        const status = optionalRecord(span.status, `${spanPath}.status`);
        const statusCode = optionalUnsignedInteger(status.code, `${spanPath}.status.code`, STATUS_CODES.length - 1);
        const attributes = attributesToObject(span.attributes, `${spanPath}.attributes`);
        const events = normalizeEvents(span.events, `${spanPath}.events`);
        const links = normalizeLinks(span.links, `${spanPath}.links`);
        const statusMessage = optionalString(status.message, `${spanPath}.status.message`);
        const droppedAttributesCount = optionalUnsignedInteger(span.droppedAttributesCount, `${spanPath}.droppedAttributesCount`, 0xffff_ffff);
        const droppedEventsCount = optionalUnsignedInteger(span.droppedEventsCount, `${spanPath}.droppedEventsCount`, 0xffff_ffff);
        const droppedLinksCount = optionalUnsignedInteger(span.droppedLinksCount, `${spanPath}.droppedLinksCount`, 0xffff_ffff);

        rows.push({
          trace_id: traceId,
          span_id: spanId,
          name: requiredString(span.name, `${spanPath}.name`, 1024),
          started_at: start.date,
          ended_at: end.date,
          parent_span_ids: parentSpanId === null ? [] : [parentSpanId],
          kind: SPAN_KINDS[kind].slice("SPAN_KIND_".length).toLowerCase(),
          status_code: STATUS_CODES[statusCode].slice("STATUS_CODE_".length).toLowerCase(),
          status_message: statusMessage,
          trace_state: optionalString(span.traceState, `${spanPath}.traceState`, 512),
          trace_flags: optionalUnsignedInteger(span.flags, `${spanPath}.flags`, 0xffff_ffff),
          service_namespace: serviceNamespace,
          service_name: serviceName,
          service_version: serviceVersion,
          service_instance_id: serviceInstanceId,
          deployment_environment_name: deploymentEnvironmentName,
          resource_attributes: JSON.stringify(stripLoneSurrogates(resourceAttributes)),
          resource_schema_url: resourceSchemaUrl,
          scope_name: scopeName,
          scope_version: scopeVersion,
          scope_attributes: JSON.stringify(stripLoneSurrogates(scopeAttributes)),
          scope_schema_url: scopeSchemaUrl,
          attributes: JSON.stringify(stripLoneSurrogates(attributes)),
          dropped_resource_attributes: droppedResourceAttributes,
          dropped_scope_attributes: droppedScopeAttributes,
          dropped_attributes: droppedAttributesCount,
          dropped_events: droppedEventsCount,
          dropped_links: droppedLinksCount,
          events,
          links,
          version: end.millis,
        });
      }
    }
  }

  expandParentSpanPaths(rows);
  return rows;
}
