import { describe, expect, it } from "vitest";
import { scrubErrorIngestPayload } from "./error-ingest-scrubber";

describe("scrubErrorIngestPayload", () => {
  it("removes request secrets and strips query data from nested envelope and OTLP shapes", () => {
    const payload = {
      attributes: new Map<string, unknown>([
        ["http.request.header.authorization", "Bearer top-secret"],
        ["url.query", "token=top-secret&email=user@example.com"],
        ["http.route", "/checkout"],
      ]),
      message: "request failed: Authorization: Bearer message-secret; token=inline-secret",
      request: {
        auth: { accessToken: "auth-secret" },
        body: { password: "body-secret", safe: "not retained" },
        headers: { authorization: "header-secret", "x-request-id": "request-id" },
        query: { customer: "customer-secret" },
        url: "https://example.test/checkout?token=url-secret&customer=customer-secret#fragment",
      },
      safe: { method: "POST", status_code: 500 },
    };

    const result = scrubErrorIngestPayload(payload);
    const serialized = JSON.stringify(result.value);

    expect(result.value).toEqual({
      attributes: { "http.route": "/checkout" },
      message: "request failed: Authorization: Bearer [Filtered]; token=[Filtered]",
      request: { url: "https://example.test/checkout" },
      safe: { method: "POST", status_code: 500 },
    });
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("url-secret");
    expect(serialized).not.toContain("customer-secret");
    expect(result.dropped).toEqual([...result.dropped].sort());
    expect(result.truncated).toBe(true);
  });

  it("is cycle-safe, bounds recursion and collections, and emits deterministic output", () => {
    const payload: Record<string, unknown> = {
      z: "last",
      nested: { b: "second", a: "first" },
      items: ["one", "two", "three"],
    };
    payload.aCycle = payload;
    payload.deep = { level: { next: { value: "too deep" } } };

    const options = { maxDepth: 3, maxCollectionEntries: 3, maxPayloadBytes: 512 };
    const first = scrubErrorIngestPayload(payload, options);
    const second = scrubErrorIngestPayload(payload, options);

    expect(first).toEqual(second);
    expect(first.value).toEqual({
      deep: { level: {} },
      items: ["one", "two", "three"],
    });
    expect(first.dropped.some((reason) => reason.endsWith(".cycle"))).toBe(true);
    expect(first.dropped.some((reason) => reason.endsWith(".depth"))).toBe(true);
    expect(first.byteLength).toBeLessThanOrEqual(options.maxPayloadBytes);
  });

  it("enforces UTF-8 string and total payload bounds", () => {
    const result = scrubErrorIngestPayload(
      { first: "😀😀😀😀", second: "this field is removed when the budget is full" },
      { maxStringBytes: 5, maxPayloadBytes: 24 },
    );

    expect(result.byteLength).toBeLessThanOrEqual(24);
    expect(result.value).toEqual({ first: "😀" });
    expect(result.dropped).toContain("$.first.string");
    expect(result.dropped.some((reason) => reason.endsWith(".bytes"))).toBe(true);
  });

  it("fails closed for non-JSON values and accessor properties", () => {
    const payload = Object.defineProperties(
      { bigint: BigInt(1), functionValue: () => "secret" },
      { computed: { enumerable: true, get: () => "should not run" } },
    );

    const result = scrubErrorIngestPayload(payload);

    expect(result.value).toEqual({});
    expect(result.truncated).toBe(true);
    expect(result.dropped.some((reason) => reason.endsWith(".type"))).toBe(true);
    expect(result.dropped.some((reason) => reason.endsWith(".accessor"))).toBe(true);
  });
});
