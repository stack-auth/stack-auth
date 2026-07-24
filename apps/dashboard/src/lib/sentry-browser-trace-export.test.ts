import { describe, expect, it } from "vitest";
import { dashboardSentryTransactionToOtlp } from "./sentry-browser-trace-export";

describe("dashboardSentryTransactionToOtlp", () => {
  it("preserves Sentry trace identity, hierarchy, operation names, and timing", () => {
    const payload = dashboardSentryTransactionToOtlp({
      transaction: "/projects/internal/analytics/traces",
      start_timestamp: 1_753_228_800.123,
      timestamp: 1_753_228_802.523,
      contexts: {
        trace: {
          data: {
            "sentry.source": "url",
            "sentry.origin": "stale-origin",
          },
          op: "pageload",
          span_id: "1111111111111111",
          trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "ok",
          origin: "auto.pageload.browser",
        },
      },
      spans: [{
        data: {
          "http.request.method": "GET",
          "server.address": "localhost",
        },
        description: "GET http://localhost:8102/api/v1/users/me",
        op: "browser.request",
        parent_span_id: "1111111111111111",
        span_id: "2222222222222222",
        start_timestamp: 1_753_228_800.5,
        timestamp: 1_753_228_800.75,
        trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "ok",
      }],
    });

    expect(payload).toMatchInlineSnapshot(`
      {
        "resourceSpans": [
          {
            "resource": {
              "attributes": [
                {
                  "key": "service.name",
                  "value": {
                    "stringValue": "stack-dashboard-browser",
                  },
                },
                {
                  "key": "deployment.environment.name",
                  "value": {
                    "stringValue": "test",
                  },
                },
              ],
            },
            "scopeSpans": [
              {
                "scope": {
                  "name": "@sentry/nextjs-browser",
                },
                "spans": [
                  {
                    "attributes": [
                      {
                        "key": "sentry.source",
                        "value": {
                          "stringValue": "url",
                        },
                      },
                      {
                        "key": "sentry.origin",
                        "value": {
                          "stringValue": "auto.pageload.browser",
                        },
                      },
                      {
                        "key": "sentry.description",
                        "value": {
                          "stringValue": "/projects/internal/analytics/traces",
                        },
                      },
                      {
                        "key": "sentry.status",
                        "value": {
                          "stringValue": "ok",
                        },
                      },
                      {
                        "key": "sentry.transaction",
                        "value": {
                          "stringValue": "/projects/internal/analytics/traces",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1753228802523000000",
                    "kind": 1,
                    "name": "pageload",
                    "spanId": "1111111111111111",
                    "startTimeUnixNano": "1753228800123000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  },
                  {
                    "attributes": [
                      {
                        "key": "http.request.method",
                        "value": {
                          "stringValue": "GET",
                        },
                      },
                      {
                        "key": "server.address",
                        "value": {
                          "stringValue": "localhost",
                        },
                      },
                      {
                        "key": "sentry.description",
                        "value": {
                          "stringValue": "GET http://localhost:8102/api/v1/users/me",
                        },
                      },
                      {
                        "key": "sentry.status",
                        "value": {
                          "stringValue": "ok",
                        },
                      },
                      {
                        "key": "sentry.transaction",
                        "value": {
                          "stringValue": "/projects/internal/analytics/traces",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1753228800750000000",
                    "kind": 3,
                    "name": "browser.request",
                    "parentSpanId": "1111111111111111",
                    "spanId": "2222222222222222",
                    "startTimeUnixNano": "1753228800500000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  },
                ],
              },
            ],
          },
        ],
      }
    `);
  });

  it("does not export incomplete transactions or unfinished child spans", () => {
    expect(dashboardSentryTransactionToOtlp({
      transaction: "/incomplete",
      contexts: {
        trace: {
          span_id: "1111111111111111",
          trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    })).toBeNull();

    const payload = dashboardSentryTransactionToOtlp({
      start_timestamp: 1,
      timestamp: 2,
      contexts: {
        trace: {
          span_id: "1111111111111111",
          trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
      spans: [{
        data: {},
        span_id: "2222222222222222",
        start_timestamp: 1.5,
        trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }],
    });
    expect(payload?.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });
});
