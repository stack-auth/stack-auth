/**
 * Native Sentry transports use response headers as a scheduling hint. Keep the
 * projection separate from the JSON response so an envelope route cannot
 * accidentally expose an unbounded reason or category string in a header.
 */

export type ErrorIngestRateLimitHeaderItem = {
  status: string,
  category: string,
  retryAfterMs?: number,
};

const SAFE_CATEGORY = /^[a-zA-Z0-9_.:-]{1,64}$/u;

export function buildErrorIngestRateLimitHeaders(
  items: readonly ErrorIngestRateLimitHeaderItem[],
): Record<string, string[]> {
  const rateLimited = items.filter((item) => item.status === "rate_limited");
  if (rateLimited.length === 0) return {};

  const retryAfterMs = Math.max(...rateLimited.map((item) => item.retryAfterMs ?? 0));
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
  const categories = [...new Set(rateLimited.map((item) => item.category).filter((category) => SAFE_CATEGORY.test(category)))].sort().join(";");
  return {
    // `Retry-After` is useful to generic HTTP clients; the Sentry-specific
    // header preserves item categories for SDK transports that track quotas.
    "x-sentry-rate-limits": [`${retryAfterSeconds}:${categories}:project`],
    "retry-after": [String(retryAfterSeconds)],
  };
}
