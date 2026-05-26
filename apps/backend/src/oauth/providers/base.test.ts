import { describe, expect, it } from "vitest";
import { getOAuthAccessTokenRefreshError, getOAuthAccessTokenRefreshErrorDisposition, isRetryableOAuthUserInfoError, resolveOAuthAccessTokenExpiredAt } from "./base";

describe("isRetryableOAuthUserInfoError", () => {
  it("returns true for openid-client timeout errors", () => {
    expect(isRetryableOAuthUserInfoError({
      name: "RPError",
      message: "outgoing request timed out after 3500ms",
    })).toBe(true);
  });

  it("returns true for retryable network error codes", () => {
    expect(isRetryableOAuthUserInfoError({
      code: "ETIMEDOUT",
      message: "socket hangup",
    })).toBe(true);
  });

  it("returns true when retryable errors are wrapped in cause", () => {
    expect(isRetryableOAuthUserInfoError({
      message: "request failed",
      cause: {
        name: "AbortError",
      },
    })).toBe(true);
  });

  it("returns false for non-retryable OAuth errors", () => {
    expect(isRetryableOAuthUserInfoError({
      error: "invalid_client",
      message: "client credentials are invalid",
    })).toBe(false);
  });

  it("returns true for provider temporary-unavailability errors", () => {
    expect(isRetryableOAuthUserInfoError({
      error: "temporarily_unavailable",
      message: "provider is temporarily unavailable",
    })).toBe(true);
  });

  it("returns true for HTTP 5xx and 429 response statuses", () => {
    expect(isRetryableOAuthUserInfoError({
      response: {
        status: 503,
      },
    })).toBe(true);
    expect(isRetryableOAuthUserInfoError({
      response: {
        status: 429,
      },
    })).toBe(true);
  });
});

describe("getOAuthAccessTokenRefreshErrorDisposition", () => {
  it("treats openid-client refresh timeouts as temporarily unavailable", () => {
    expect(getOAuthAccessTokenRefreshErrorDisposition({
      name: "RPError",
      message: "outgoing request timed out after 3500ms",
    })).toEqual({ type: "temporarily-unavailable" });
  });

  it("treats invalid_grant refresh failures as invalid refresh tokens", () => {
    expect(getOAuthAccessTokenRefreshErrorDisposition({
      error: "invalid_grant",
    })).toEqual({
      type: "invalid-refresh-token",
      message: "Refresh token is invalid or expired",
    });
  });

  it("recognizes nested OAuth provider error codes", () => {
    expect(getOAuthAccessTokenRefreshErrorDisposition({
      error: {
        error: "invalid_grant",
      },
    })).toEqual({
      type: "invalid-refresh-token",
      message: "Refresh token is invalid or expired",
    });
  });
});

describe("getOAuthAccessTokenRefreshError", () => {
  it("does not treat invalid_grant after an ambiguous refresh attempt as a revoked token", () => {
    const providerError = {
      error: "invalid_grant",
    };
    expect(getOAuthAccessTokenRefreshError(providerError, {
      sawAmbiguousRefreshAttempt: true,
      attempts: 2,
      causes: [{ name: "RPError" }, providerError],
    })).toEqual({
      type: "temporarily-unavailable",
      cause: providerError,
      attempts: 2,
      retryCount: 1,
      sawAmbiguousRefreshAttempt: true,
      causes: [{ name: "RPError" }, providerError],
    });
  });
});

describe("resolveOAuthAccessTokenExpiredAt", () => {
  it("uses finite provider expires_in values", () => {
    expect(resolveOAuthAccessTokenExpiredAt({
      expiresInSeconds: 120,
      expiresAtSeconds: undefined,
      defaultExpiresInMillis: null,
      nowMillis: 1000,
    })?.toISOString()).toBe("1970-01-01T00:02:01.000Z");
  });

  it("ignores non-finite provider expires_at values and uses explicit null defaults", () => {
    expect(resolveOAuthAccessTokenExpiredAt({
      expiresInSeconds: undefined,
      expiresAtSeconds: Number.NaN,
      defaultExpiresInMillis: null,
      nowMillis: 1000,
    })).toBeNull();
  });

  it("ignores non-finite provider expiry values and falls back to one hour", () => {
    expect(resolveOAuthAccessTokenExpiredAt({
      expiresInSeconds: Number.NaN,
      expiresAtSeconds: Number.NaN,
      defaultExpiresInMillis: undefined,
      nowMillis: 1000,
    })?.toISOString()).toBe("1970-01-01T01:00:01.000Z");
  });
});
