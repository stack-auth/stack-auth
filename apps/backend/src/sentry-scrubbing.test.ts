import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import type { Event } from "@sentry/node";
import { describe, expect, it } from "vitest";
import { prepareBackendSentryEvent, sanitizeBackendSentryEvent } from "./sentry-scrubbing";

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
          "http.route": "/api/latest/users/{user_id}",
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
        "extra": undefined,
        "request": {
          "method": "POST",
        },
        "spans": [
          {
            "data": {
              "http.request.method": "POST",
              "http.route": "/api/latest/users/{user_id}",
            },
            "description": "POST /api/latest/users/{user_id}",
            "span_id": "0123456789abcdef",
            "start_timestamp": 1,
            "trace_id": "0123456789abcdef0123456789abcdef",
          },
        ],
        "tags": undefined,
        "transaction": "POST /api/latest/users/[user_id]",
        "user": undefined,
      }
    `);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("user@example.com");
  });

  it("retains audited application span names while stripping data-bearing descriptions", () => {
    const safeSpan = {
      data: {},
      description: "STACK: smart request parseAuth",
      span_id: "0123456789abcdef",
      start_timestamp: 1,
      trace_id: "0123456789abcdef0123456789abcdef",
    };
    const unsafeSpan = {
      data: {},
      description: "STACK: sending email to user@example.com",
      span_id: "fedcba9876543210",
      start_timestamp: 1,
      trace_id: "0123456789abcdef0123456789abcdef",
    };

    const result = sanitizeBackendSentryEvent({
      spans: [safeSpan, unsafeSpan],
    });

    expect(result.spans.map((span) => span.description)).toEqual([
      "STACK: smart request parseAuth",
      undefined,
    ]);
  });

  it("does not use concrete URLs or malformed route metadata as transaction names", () => {
    const result = sanitizeBackendSentryEvent({
      transaction: "GET /users/customer-123?token=secret",
      contexts: {
        "stack-request": {
          method: "GET",
          route: "/users/customer-123?token=secret",
          requestId: "request-123",
        },
      },
    });

    expect(result.transaction).toBe("backend.request");
  });

  it("does not use unsupported extension methods in request descriptions", () => {
    const event: Event = {
      request: {
        method: "BREW",
      },
      transaction: "BREW /api/latest/users",
      contexts: {
        trace: {
          data: {
            "http.request.method": "BREW",
            "http.route": "/api/latest/users",
          },
          span_id: "0123456789abcdef",
          trace_id: "0123456789abcdef0123456789abcdef",
        },
      },
      spans: [{
        data: {
          "http.request.method": "BREW",
          "http.route": "/api/latest/users",
        },
        description: "BREW /api/latest/users",
        span_id: "0123456789abcdef",
        start_timestamp: 1,
        trace_id: "0123456789abcdef0123456789abcdef",
      }],
    };

    const result = sanitizeBackendSentryEvent(event);

    expect({
      spanDescription: result.spans?.[0]?.description,
      transaction: result.transaction,
    }).toEqual({
      spanDescription: undefined,
      transaction: "backend.request",
    });
  });

  it("retains a fixed placeholder for requests that finish before route matching", () => {
    const event: Event = {
      request: {
        method: "OPTIONS",
        url: "https://api.example.com/api/latest/users/customer-secret",
      },
      contexts: {
        trace: {
          data: {},
          span_id: "0123456789abcdef",
          trace_id: "0123456789abcdef0123456789abcdef",
        },
      },
    };
    const result = sanitizeBackendSentryEvent(event);

    expect(result.transaction).toBe("OPTIONS <unmatched>");
    expect(result.request).toEqual({ method: "OPTIONS" });
    expect(result.contexts).toEqual({
      trace: {
        data: {
          "http.request.method": "OPTIONS",
          "http.route": "<unmatched>",
        },
        links: undefined,
        span_id: "0123456789abcdef",
        tags: undefined,
        trace_id: "0123456789abcdef0123456789abcdef",
      },
    });
    expect(JSON.stringify(result)).not.toContain("customer-secret");
  });

  it("clears all extras, including ones that look like diagnostics", () => {
    const result = sanitizeBackendSentryEvent({
      extra: {
        location: "js-execution-freestyle-failed",
        connectionString: "postgres://secret",
        nicifiedError: "should not survive sanitize alone",
      },
    });

    expect(result.extra).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("postgres://secret");
  });
});

describe("prepareBackendSentryEvent", () => {
  it("rebuilds extra from location + exception diagnostics after scrubbing", () => {
    const cause = new Error("upstream sandbox failure");
    const error = new HexclaveAssertionError(
      "JS execution freestyle engine failed, falling back to vercel sandbox engine",
      { cause, innerCode: "<redacted workflow>", innerOptions: { timeoutMs: 1_000 } },
    );

    const result = prepareBackendSentryEvent(
      {
        request: {
          method: "POST",
          url: "https://api.example.com/api/latest/users?token=secret",
          data: { password: "secret" },
        },
        extra: {
          location: "js-execution-freestyle-failed",
          connectionString: "postgres://secret",
        },
      },
      { originalException: error },
    );

    expect(result.request).toEqual({ method: "POST" });
    expect(result.extra).toEqual(expect.objectContaining({
      location: "js-execution-freestyle-failed",
      cause: {
        name: "Error",
        message: "upstream sandbox failure",
      },
      errorProps: expect.objectContaining({
        extraData: {
          cause: {
            name: "Error",
            message: "upstream sandbox failure",
          },
          innerCode: "<redacted workflow>",
          innerOptions: { timeoutMs: 1_000 },
        },
      }),
      nicifiedError: expect.stringContaining("innerCode"),
    }));
    expect(JSON.stringify(result)).not.toContain("postgres://secret");
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });

  it("redacts credential-shaped keys in the dashboard dump", () => {
    const error = new HexclaveAssertionError(
      "OAuth callback failed",
      {
        innerCode: "<safe>",
        password: "hunter2",
        connectionString: "postgres://user:hunter2@db/app",
        authorization: "Bearer hunter2",
        oauth: {
          accessToken: "hunter2-token",
          timeoutMs: 1_000,
        },
      },
    );

    const result = prepareBackendSentryEvent(
      { extra: { location: "oauth-callback" } },
      { originalException: error },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      location: "oauth-callback",
      errorProps: expect.objectContaining({
        extraData: {
          innerCode: "<safe>",
          password: "[redacted]",
          connectionString: "[redacted]",
          authorization: "[redacted]",
          oauth: {
            accessToken: "[redacted]",
            timeoutMs: 1_000,
          },
        },
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("hunter2");
    const nicifiedError = result.extra.nicifiedError;
    expect(nicifiedError).toEqual(expect.stringContaining("innerCode"));
    expect(nicifiedError).toEqual(expect.not.stringContaining("hunter2"));
  });

  it("ignores non-string location values", () => {
    const result = prepareBackendSentryEvent({
      extra: {
        location: { spoofed: true },
      },
    });

    expect(result.extra).toBeUndefined();
  });
});
