import { describe, expect, it } from "vitest";
import { normalizeOtlpJsonTraceRequest, OtlpValidationError } from "./otlp";

const FIXTURE = {
  resourceSpans: [{
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: "checkout-api" } },
        { key: "deployment.environment.name", value: { stringValue: "test" } },
      ],
      droppedAttributesCount: 0,
    },
    schemaUrl: "https://opentelemetry.io/schemas/1.27.0",
    scopeSpans: [{
      scope: {
        name: "@prisma/instrumentation",
        version: "7.1.0",
        attributes: [{ key: "scope.enabled", value: { boolValue: true } }],
      },
      spans: [{
        traceId: "5b8efff798038103d269b633813fc60c",
        spanId: "eee19b7ec3c1b174",
        parentSpanId: "6f05b84f3f6e2f2e",
        traceState: "vendor=value",
        flags: 1,
        name: "prisma:client:operation",
        kind: 1,
        startTimeUnixNano: "1753228800123456789",
        endTimeUnixNano: "1753228800456789123",
        attributes: [
          { key: "db.system.name", value: { stringValue: "postgresql" } },
          { key: "db.operation.name", value: { stringValue: "findMany" } },
          { key: "db.rows_affected", value: { intValue: "2" } },
        ],
        events: [{
          timeUnixNano: "1753228800456000000",
          name: "query.complete",
          attributes: [{ key: "cache.hit", value: { boolValue: false } }],
        }],
        links: [{
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
          flags: 1,
          attributes: [],
        }],
        status: { code: 1 },
      }],
    }],
  }],
};

describe("normalizeOtlpJsonTraceRequest", () => {
  it("maps a representative OTLP JSON span into the native analytics shape", () => {
    const rows = normalizeOtlpJsonTraceRequest(FIXTURE);

    expect(rows).toMatchInlineSnapshot(`
      [
        {
          "attributes": "{"db.system.name":"postgresql","db.operation.name":"findMany","db.rows_affected":"2"}",
          "deployment_environment_name": "test",
          "dropped_attributes": 0,
          "dropped_events": 0,
          "dropped_links": 0,
          "dropped_resource_attributes": 0,
          "dropped_scope_attributes": 0,
          "ended_at": 2025-07-23T00:00:00.456Z,
          "events": [
            {
              "at": 2025-07-23T00:00:00.456Z,
              "attributes": {
                "cache.hit": false,
              },
              "dropped_attributes": 0,
              "name": "query.complete",
            },
          ],
          "kind": "internal",
          "links": [
            {
              "attributes": "{}",
              "dropped_attributes": 0,
              "linked_span_id": "00f067aa0ba902b7",
              "linked_trace_flags": 1,
              "linked_trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
              "linked_trace_state": null,
            },
          ],
          "name": "prisma:client:operation",
          "parent_span_ids": [
            "6f05b84f3f6e2f2e",
          ],
          "resource_attributes": "{}",
          "resource_schema_url": "https://opentelemetry.io/schemas/1.27.0",
          "scope_attributes": "{"scope.enabled":true}",
          "scope_name": "@prisma/instrumentation",
          "scope_schema_url": null,
          "scope_version": "7.1.0",
          "service_instance_id": null,
          "service_name": "checkout-api",
          "service_namespace": null,
          "service_version": null,
          "span_id": "eee19b7ec3c1b174",
          "started_at": 2025-07-23T00:00:00.123Z,
          "status_code": "ok",
          "status_message": null,
          "trace_flags": 1,
          "trace_id": "5b8efff798038103d269b633813fc60c",
          "trace_state": "vendor=value",
          "version": 1753228800456,
        },
      ]
    `);
  });

  it("rejects zero identifiers instead of creating an unqueryable trace", () => {
    const malformed = structuredClone(FIXTURE);
    malformed.resourceSpans[0].scopeSpans[0].spans[0].traceId = "00000000000000000000000000000000";

    expect(() => normalizeOtlpJsonTraceRequest(malformed)).toThrowError(
      new OtlpValidationError("request.resourceSpans[0].scopeSpans[0].spans[0].traceId must be a non-zero 32-character hexadecimal identifier"),
    );
  });

  it("expands OTLP direct parents into Hexclave root-first ancestry", () => {
    const trace = structuredClone(FIXTURE);
    const baseSpan = trace.resourceSpans[0].scopeSpans[0].spans[0];
    trace.resourceSpans[0].scopeSpans[0].spans = [
      { ...baseSpan, spanId: "1111111111111111", parentSpanId: "" },
      { ...baseSpan, spanId: "2222222222222222", parentSpanId: "1111111111111111" },
      { ...baseSpan, spanId: "3333333333333333", parentSpanId: "2222222222222222" },
    ];

    const rows = normalizeOtlpJsonTraceRequest(trace);

    expect(rows.map((row) => row.parent_span_ids)).toEqual([
      [],
      ["1111111111111111"],
      [
        "1111111111111111",
        "2222222222222222",
      ],
    ]);
  });

  it("scopes duplicate IDs and parent expansion to each trace", () => {
    const request = structuredClone(FIXTURE);
    const baseSpan = request.resourceSpans[0].scopeSpans[0].spans[0];
    request.resourceSpans[0].scopeSpans[0].spans = [
      {
        ...baseSpan,
        traceId: "11111111111111111111111111111111",
        spanId: "aaaaaaaaaaaaaaaa",
        parentSpanId: "",
      },
      {
        ...baseSpan,
        traceId: "11111111111111111111111111111111",
        spanId: "bbbbbbbbbbbbbbbb",
        parentSpanId: "aaaaaaaaaaaaaaaa",
      },
      {
        ...baseSpan,
        traceId: "22222222222222222222222222222222",
        spanId: "aaaaaaaaaaaaaaaa",
        parentSpanId: "cccccccccccccccc",
      },
    ];

    const rows = normalizeOtlpJsonTraceRequest(request);

    expect(rows.map((row) => ({
      traceId: row.trace_id,
      spanId: row.span_id,
      parents: row.parent_span_ids,
    }))).toEqual([
      {
        traceId: "11111111111111111111111111111111",
        spanId: "aaaaaaaaaaaaaaaa",
        parents: [],
      },
      {
        traceId: "11111111111111111111111111111111",
        spanId: "bbbbbbbbbbbbbbbb",
        parents: ["aaaaaaaaaaaaaaaa"],
      },
      {
        traceId: "22222222222222222222222222222222",
        spanId: "aaaaaaaaaaaaaaaa",
        parents: ["cccccccccccccccc"],
      },
    ]);
  });

  it("treats prototype-named attributes as ordinary own properties", () => {
    const request: unknown = {
      resourceSpans: [{
        resource: {
          attributes: [{
            key: "__proto__",
            value: {
              kvlistValue: {
                values: [{
                  key: "service.name",
                  value: { stringValue: "spoofed-service" },
                }],
              },
            },
          }],
        },
        scopeSpans: [{
          spans: [{
            traceId: "11111111111111111111111111111111",
            spanId: "2222222222222222",
            name: "prototype-attribute-test",
            startTimeUnixNano: "1753228800123456789",
            endTimeUnixNano: "1753228800456789123",
          }],
        }],
      }],
    };

    const [row] = normalizeOtlpJsonTraceRequest(request);

    expect(row.service_name).toBeNull();
    expect(row.resource_attributes).toBe('{"__proto__":{"service.name":"spoofed-service"}}');
  });
});
