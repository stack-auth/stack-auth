import { describe, expect, it } from "vitest";
import { FILTERED_VALUE, createSafeParsedRequestContext, createSafeRequestContext, createSafeSmartRequestContext, scrubContextValue } from "./safe-request-context";

describe("safe request context", () => {
  it("keeps route diagnostics while excluding credentials and query values", () => {
    const context = createSafeRequestContext({
      requestId: "request-1",
      method: "POST",
      url: "https://api.example.test/api/users?limit=10&token=top-secret",
      status: 500,
      headers: new Headers({
        "content-type": "application/json",
        "user-agent": "test-client/1.0",
        authorization: "Bearer header-secret",
        cookie: "session=session-secret; theme=dark",
        "x-stack-project-id": "project-1",
      }),
    });

    expect(context).toMatchInlineSnapshot(`
      {
        "cookies": {
          "names": [
            "session",
            "theme",
          ],
        },
        "headers": {
          "content-type": "application/json",
          "user-agent": "test-client/1.0",
          "x-stack-project-id": "project-1",
        },
        "method": "POST",
        "queryParameterCount": 2,
        "requestId": "request-1",
        "status": 500,
        "url": "/api/users",
      }
    `);
    expect(JSON.stringify(context)).not.toContain("header-secret");
    expect(JSON.stringify(context)).not.toContain("session-secret");
    expect(JSON.stringify(context)).not.toContain("top-secret");
    expect(JSON.stringify(context)).not.toContain("limit=10");
  });

  it("scrubs and bounds caller-controlled URL path segments", () => {
    const context = createSafeRequestContext({
      requestId: "request-path",
      method: "GET",
      url: "https://api.example.test/api/users/user@example.test/tokens/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-material",
      headers: new Headers(),
    });
    // Dynamic/catch-all segments are request data: value-shaped secrets and
    // PII in the path must not reach the error-context boundary verbatim.
    expect(context.url).not.toContain("user@example.test");
    expect(context.url).not.toContain("signature-material");
    expect(context.url).toContain("/api/users/");

    const longSegment = "a".repeat(2_000);
    const bounded = createSafeRequestContext({
      requestId: "request-long-path",
      method: "GET",
      url: `https://api.example.test/api/${longSegment}`,
      headers: new Headers(),
    });
    expect(bounded.url.length).toBeLessThanOrEqual(512);

    const encoded = createSafeRequestContext({
      requestId: "request-encoded-path",
      method: "GET",
      url: "https://api.example.test/api/alice%40example.test/eyJhbGciOiJIUzI1NiJ9%2EeyJzdWIiOiIxIn0%2Esignature-material",
      headers: new Headers(),
    });
    expect(encoded.url).not.toContain("alice@example.test");
    expect(encoded.url).not.toContain("signature-material");
  });

  it("bounds and scrubs cookie names", () => {
    const jwtName = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-material";
    const manyCookies = Array.from({ length: 80 }, (_, index) => `cookie-${String(index).padStart(2, "0")}=x`).join("; ");
    const context = createSafeRequestContext({
      requestId: "request-cookies",
      method: "GET",
      url: "https://api.example.test/api/users",
      headers: new Headers({ cookie: `${jwtName}=1; ${manyCookies}` }),
    });
    // Value-shaped secrets smuggled into the NAME half of a pair are scrubbed…
    expect(JSON.stringify(context.cookies)).not.toContain("signature-material");
    expect(context.cookies.names).toContain("[Filtered]");
    // …and the collection is bounded with an explicit truncation marker.
    expect(context.cookies.names.length).toBeLessThanOrEqual(51);
    expect(context.cookies.names).toContain("[Names limited]");

    const encoded = createSafeRequestContext({
      requestId: "request-encoded-cookie",
      method: "GET",
      url: "https://api.example.test/api/users",
      headers: new Headers({ cookie: "alice%40example.test=1; eyJhbGciOiJIUzI1NiJ9%2EeyJzdWIiOiIxIn0%2Esignature-material=1" }),
    });
    expect(JSON.stringify(encoded.cookies)).not.toContain("alice@example.test");
    expect(JSON.stringify(encoded.cookies)).not.toContain("signature-material");
  });

  it("recursively bounds and scrubs approved structured diagnostics", () => {
    const privateKey = "-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----";
    const value = scrubContextValue({
      safe: "keep this diagnostic",
      nested: {
        authorization: "Bearer nested-secret",
        email: "user@example.test",
        password: "password-secret",
        arbitrary: "token=embedded-secret",
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature-material",
        database: "postgres://user:db-password@db.example.test/app",
        key: privateKey,
      },
      array: [{ secretValue: "array-secret" }],
    });

    expect(value).toMatchInlineSnapshot(`
      {
        "array": [
          {
            "secretValue": "[Filtered]",
          },
        ],
        "nested": {
          "arbitrary": "token=[Filtered]",
          "authorization": "[Filtered]",
          "database": "postgres://[Filtered]@db.example.test/app",
          "email": "[Filtered]",
          "jwt": "[Filtered]",
          "key": "[Filtered]",
          "password": "[Filtered]",
        },
        "safe": "keep this diagnostic",
      }
    `);
    const serialized = JSON.stringify(value);
    for (const secret of ["nested-secret", "password-secret", "embedded-secret", "signature-material", "db-password", "private-key-material", "array-secret", "user@example.test"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(FILTERED_VALUE).toBe("[Filtered]");
  });

  it("scrubs quoted credentials containing whitespace and delimiters", () => {
    const value = scrubContextValue({
      diagnostic: String.raw`password="two words,still secret" api_key='alpha;beta' token=bare-secret`,
    });

    expect(value).toEqual({
      diagnostic: 'password="[Filtered]" api_key=\'[Filtered]\' token=[Filtered]',
    });
  });

  it("projects smart requests to bounded shape metadata and safe auth correlation", () => {
    const requestType: "server" = "server";
    const smartRequest = {
      auth: {
        project: { id: "project-1" },
        branchId: "branch-1",
        type: requestType,
        user: { id: "user-1" },
        refreshTokenId: "refresh-token-secret",
      },
      url: "https://api.example.test/api/events?query=keep&access_token=secret",
      method: "POST",
      body: { message: "secret body text", nested: { client_secret: "client-secret" } },
      headers: {
        "content-type": ["application/json"],
        authorization: ["Bearer header-secret"],
        cookie: ["session=session-secret"],
      },
      query: { query: "keep", access_token: "secret" },
      params: { eventId: "event-1" },
      clientVersion: { platform: "node", sdk: "@hexclave/js", version: "1.0.0" },
    };

    const context = createSafeSmartRequestContext(smartRequest, "request-2");
    expect(context.auth).toMatchInlineSnapshot(`
      {
        "authenticated": true,
        "branchId": "branch-1",
        "projectId": "project-1",
        "refreshTokenPresent": true,
        "type": "server",
        "userId": "user-1",
      }
    `);
    expect(context).not.toHaveProperty("body");
    expect(context.query).toMatchInlineSnapshot(`
      {
        "keyCount": 2,
        "keys": [
          "query",
        ],
        "type": "object",
      }
    `);
    const serialized = JSON.stringify(context);
    for (const secret of ["refresh-token-secret", "session-secret", "header-secret", "secret body text", "client-secret", "keep", "secret"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("bounds recursive diagnostics by depth, collection size, and total characters", () => {
    let deep: unknown = "not retained";
    for (let index = 9; index >= 1; index--) deep = { [`level${index}`]: deep };
    const value = {
      deep,
      values: Array.from({ length: 150 }, (_, index) => `value-${index}`),
      wide: Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`key-${index}`, "x"])),
      large: "safe-value-".repeat(2_000),
    };

    const scrubbed = scrubContextValue(value);
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).toContain("[Depth limited]");
    expect(serialized).toContain("[Items limited]");
    expect(serialized).toContain("[Keys limited]");
    expect(serialized).not.toContain("not retained");
    expect(serialized.length).toBeLessThan(18_000);
  });

  it("makes parsed validation context deterministic without retaining values", () => {
    expect(createSafeParsedRequestContext({ z: "secret", a: { password: "secret" } })).toMatchInlineSnapshot(`
      {
        "keys": [
          "a",
          "z",
        ],
      }
    `);
  });
});
