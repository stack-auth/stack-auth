import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import type { Event } from "@sentry/node";
import { describe, expect, it } from "vitest";
import { prepareBackendSentryEvent, sanitizeBackendSentryEvent } from "./sentry-scrubbing";

function requireEventExtra(event: Event) {
  const extra = event.extra;
  if (extra == null) {
    throw new Error("expected Sentry extra to be set");
  }
  return extra;
}

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
    const nicifiedError = requireEventExtra(result).nicifiedError;
    expect(nicifiedError).toEqual(expect.stringContaining("innerCode"));
    expect(nicifiedError).toEqual(expect.not.stringContaining("hunter2"));
  });

  it("redacts plural credential keys", () => {
    const result = prepareBackendSentryEvent(
      { extra: { location: "plural-keys" } },
      {
        originalException: new HexclaveAssertionError("plural extraData", {
          tokens: ["rawTokenValue"],
          passwords: ["hunter2"],
          secrets: ["shh"],
        }),
      },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: {
          tokens: "[redacted]",
          passwords: "[redacted]",
          secrets: "[redacted]",
        },
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("rawTokenValue");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("redacts URL userinfo even under a non-sensitive key", () => {
    const result = prepareBackendSentryEvent(
      { extra: { location: "url-userinfo" } },
      {
        originalException: new HexclaveAssertionError("url extraData", {
          url: "postgres://user:hunter2@db/app",
        }),
      },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: {
          url: "postgres://[redacted]@db/app",
        },
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("ignores non-string location values", () => {
    const result = prepareBackendSentryEvent({
      extra: {
        location: { spoofed: true },
      },
    });

    expect(result.extra).toBeUndefined();
  });

  it("truncates deeply nested diagnostic values before nicify", () => {
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 20; depth++) {
      nested = { child: nested };
    }
    const result = prepareBackendSentryEvent(
      { extra: { location: "deep-error" } },
      { originalException: new HexclaveAssertionError("deep extraData", { nested }) },
    );

    expect(JSON.stringify(requireEventExtra(result).errorProps)).toContain("[truncated]");
    expect(JSON.stringify(requireEventExtra(result).errorProps)).not.toContain("leaf");
  });

  it("truncates oversized diagnostic collections before nicify", () => {
    const result = prepareBackendSentryEvent(
      { extra: { location: "wide-error" } },
      {
        originalException: new HexclaveAssertionError("wide extraData", {
          items: Array.from({ length: 80 }, (_, index) => index),
        }),
      },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: expect.objectContaining({
          items: [
            ...Array.from({ length: 50 }, (_, index) => index),
            "[truncated]",
          ],
        }),
      }),
    }));
  });

  it("redacts URL userinfo when the password contains @ or space", () => {
    const result = prepareBackendSentryEvent(
      { extra: { location: "url-userinfo-special-chars" } },
      {
        originalException: new HexclaveAssertionError("url extraData", {
          url: "postgres://user:p@ss word@db/app",
        }),
      },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: {
          url: "postgres://[redacted]@db/app",
        },
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("p@ss word");
  });

  it("stops after 50 enumerable own keys on a wide diagnostic object", () => {
    const wide: Record<string, number> = {};
    for (let index = 0; index < 80; index++) {
      wide[`field${index}`] = index;
    }
    const result = prepareBackendSentryEvent(
      { extra: { location: "wide-object" } },
      { originalException: new HexclaveAssertionError("wide extraData", wide) },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: expect.objectContaining({
          field0: 0,
          field49: 49,
          "[truncated]": true,
        }),
      }),
    }));
    expect(JSON.stringify(requireEventExtra(result).errorProps)).not.toContain("field50");
  });

  it("does not invoke throwing enumerable getters while building extras", () => {
    const extraData = { innerCode: "<safe>" };
    const error = new HexclaveAssertionError("accessor extraData", extraData);
    Object.defineProperty(extraData, "boom", {
      enumerable: true,
      get() {
        throw new Error("diagnostic getter should not run");
      },
    });
    Object.defineProperty(error, "explode", {
      enumerable: true,
      get() {
        throw new Error("error getter should not run");
      },
    });

    const result = prepareBackendSentryEvent(
      { extra: { location: "throwing-getter" } },
      { originalException: error },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      location: "throwing-getter",
      errorProps: expect.objectContaining({
        explode: "[accessor]",
        extraData: {
          innerCode: "<safe>",
          boom: "[accessor]",
        },
      }),
    }));
  });

  it("dumps a shared nested object on every path, not as circular", () => {
    const shared = { leaf: "shared-value" };
    const result = prepareBackendSentryEvent(
      { extra: { location: "diamond" } },
      {
        originalException: new HexclaveAssertionError("diamond extraData", {
          a: shared,
          b: shared,
        }),
      },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: {
          a: { leaf: "shared-value" },
          b: { leaf: "shared-value" },
        },
      }),
    }));
  });

  it("still marks true cycles as circular", () => {
    const extraData: Record<string, unknown> = { name: "cycle-root" };
    extraData.self = extraData;
    const result = prepareBackendSentryEvent(
      { extra: { location: "cycle" } },
      { originalException: new HexclaveAssertionError("cycle extraData", extraData) },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: {
          name: "cycle-root",
          self: "[circular]",
        },
      }),
    }));
  });

  it("does not treat a host followed by a prose email as URL userinfo", () => {
    const prose = "failed to reach https://api.example.com, page ops@company.com";
    const result = prepareBackendSentryEvent(
      { extra: { location: "url-prose" } },
      {
        originalException: new HexclaveAssertionError("url extraData", { note: prose }),
      },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: {
          note: prose,
        },
      }),
    }));
    expect(JSON.stringify(result)).toContain("api.example.com");
    expect(JSON.stringify(result)).toContain("ops@company.com");
  });

  it("caps oversized diagnostic strings and nicify output", () => {
    const huge = "x".repeat(8_000);
    const result = prepareBackendSentryEvent(
      { extra: { location: "huge-string" } },
      { originalException: new HexclaveAssertionError("huge extraData", { dump: huge }) },
    );

    const extra = requireEventExtra(result);
    expect(extra.errorProps).toEqual(expect.objectContaining({
      extraData: {
        dump: `${"x".repeat(5_000)}…`,
      },
    }));
    expect(JSON.stringify(result)).not.toContain("x".repeat(5_001));
    expect(typeof extra.nicifiedError).toBe("string");
    expect((extra.nicifiedError as string).length).toBeLessThanOrEqual(20_000 + 1);
  });

  it("redacts backend admin keys and extra credential-shaped fields", () => {
    const result = prepareBackendSentryEvent(
      { extra: { location: "admin-key" } },
      {
        originalException: new HexclaveAssertionError("key extraData", {
          note: "issued sak_abcdefghijklmnopqrstuvwxyz",
          pwd: "hunter2",
          jwt: "header.payload.sig",
          otp: "123456",
          signature: "sig-value",
        }),
      },
    );

    expect(result.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: {
          note: "issued [redacted]",
          pwd: "[redacted]",
          jwt: "[redacted]",
          otp: "[redacted]",
          signature: "[redacted]",
        },
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("sak_abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("123456");
  });

  it("serializes Dates and dumps non-Error throws", () => {
    const occurredAt = new Date("2026-08-18T12:00:00.000Z");
    const dateResult = prepareBackendSentryEvent(
      { extra: { location: "date" } },
      { originalException: new HexclaveAssertionError("date extraData", { occurredAt }) },
    );
    expect(dateResult.extra).toEqual(expect.objectContaining({
      errorProps: expect.objectContaining({
        extraData: {
          occurredAt: "2026-08-18T12:00:00.000Z",
        },
      }),
    }));

    const thrownResult = prepareBackendSentryEvent(
      { extra: { location: "non-error" } },
      { originalException: { reason: "sandbox-timeout", attempt: 2 } },
    );
    expect(thrownResult.extra).toEqual(expect.objectContaining({
      location: "non-error",
      errorProps: {
        reason: "sandbox-timeout",
        attempt: 2,
      },
      nicifiedError: expect.stringContaining("sandbox-timeout"),
    }));
  });

  it("omits empty errorProps for Errors with no enumerable own data", () => {
    const result = prepareBackendSentryEvent(
      { extra: { location: "plain-error" } },
      { originalException: new Error("plain") },
    );

    expect(result.extra).toEqual({
      location: "plain-error",
    });
  });
});
