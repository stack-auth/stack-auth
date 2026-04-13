import { describe, expect, it } from "vitest";
import { isRetryableOAuthUserInfoError } from "./base";

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
});
