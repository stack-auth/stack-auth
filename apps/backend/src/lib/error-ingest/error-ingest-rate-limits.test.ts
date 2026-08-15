import { describe, expect, it } from "vitest";
import { buildErrorIngestRateLimitHeaders } from "./error-ingest-rate-limits";

describe("Sentry-compatible rate-limit response headers", () => {
  it("emits category-aware retry feedback for rate-limited items", () => {
    expect(buildErrorIngestRateLimitHeaders([
      { status: "accepted", category: "error" },
      { status: "rate_limited", category: "error", retryAfterMs: 1_001 },
      { status: "rate_limited", category: "attachment", retryAfterMs: 2_001 },
    ])).toEqual({
      "x-sentry-rate-limits": ["3:attachment;error:project"],
      "retry-after": ["3"],
    });
  });

  it("does not emit headers when no item was rate limited", () => {
    expect(buildErrorIngestRateLimitHeaders([{ status: "accepted", category: "error" }])).toEqual({});
  });

  it("filters malformed categories before they reach an HTTP header", () => {
    expect(buildErrorIngestRateLimitHeaders([{ status: "rate_limited", category: "bad category\n", retryAfterMs: 0 }])).toEqual({
      "x-sentry-rate-limits": ["1::project"],
      "retry-after": ["1"],
    });
  });
});
