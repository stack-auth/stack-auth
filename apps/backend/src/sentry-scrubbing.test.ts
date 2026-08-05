import type { Event } from "@sentry/node";
import { describe, expect, it } from "vitest";
import { sanitizeBackendSentryEvent } from "./sentry-scrubbing";

describe("sanitizeBackendSentryEvent", () => {
  it("removes request and trace data that can contain credentials or PII", () => {
    const event: Event = {
      request: {
        method: "POST",
        url: "https://api.example.com/api/latest/users?token=secret",
        query_string: "token=secret",
        data: { password: "secret" },
        headers: { authorization: "Bearer secret" },
        cookies: { refreshToken: "secret" },
      },
      user: {
        id: "user-secret",
        email: "user@example.com",
      },
      tags: {
        project: "project-secret",
      },
      transaction: "POST /api/latest/users/user-secret",
      extra: {
        location: "backend-global-error",
        connectionString: "postgres://secret",
      },
      contexts: {
        "stack-request": {
          requestId: "request-123",
          method: "POST",
          route: "/api/latest/users/[user_id]",
          authorization: "Bearer secret",
        },
        response: {
          headers: {
            "set-cookie": "refresh-token=secret",
          },
        },
        trace: {
          data: {
            "db.statement": "SELECT * FROM users WHERE email = 'user@example.com'",
            "http.route": "/api/latest/users/{user_id}",
          },
          span_id: "0123456789abcdef",
          trace_id: "0123456789abcdef0123456789abcdef",
        },
      },
      breadcrumbs: [{
        category: "http",
        message: "POST https://api.example.com/api/latest/users?token=secret",
        data: { authorization: "Bearer secret" },
      }],
      spans: [{
        data: {
          "db.statement": "SELECT * FROM users WHERE email = 'user@example.com'",
          "http.request.method": "POST",
          "stack.request.path": "/api/latest/users",
          "stack.smart-request.user.primary-email": "user@example.com",
        },
        description: "POST /api/latest/users?token=secret",
        span_id: "0123456789abcdef",
        start_timestamp: 1,
        trace_id: "0123456789abcdef0123456789abcdef",
      }],
    };

    const result = sanitizeBackendSentryEvent(event);

    expect(result).toMatchInlineSnapshot(`
      {
        "breadcrumbs": [
          {
            "category": "http",
            "level": undefined,
            "timestamp": undefined,
            "type": undefined,
          },
        ],
        "contexts": {
          "stack-request": {
            "method": "POST",
            "requestId": "request-123",
            "route": "/api/latest/users/[user_id]",
          },
          "trace": {
            "data": {
              "http.route": "/api/latest/users/{user_id}",
            },
            "links": undefined,
            "span_id": "0123456789abcdef",
            "tags": undefined,
            "trace_id": "0123456789abcdef0123456789abcdef",
          },
        },
        "extra": {
          "location": "backend-global-error",
        },
        "request": {
          "method": "POST",
        },
        "spans": [
          {
            "data": {
              "http.request.method": "POST",
            },
            "description": undefined,
            "span_id": "0123456789abcdef",
            "start_timestamp": 1,
            "trace_id": "0123456789abcdef0123456789abcdef",
          },
        ],
        "tags": undefined,
        "transaction": "backend.request",
        "user": undefined,
      }
    `);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("user@example.com");
  });
});
