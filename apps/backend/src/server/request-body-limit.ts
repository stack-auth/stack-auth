import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

// Vercel rejects request bodies above ~4.5 MB at the platform edge, so hosted deployments are
// already bound to this value. Direct Node ingress (Docker/self-host) matches it by default so
// both deployment styles accept the same requests; operators with a legitimate need for larger
// bodies can raise the cap explicitly.
const defaultMaxRequestBodySizeBytes = 4.5 * 1024 * 1024;

export function getMaxRequestBodySizeBytes(): number {
  const raw = getEnvVariable("HEXCLAVE_MAX_REQUEST_BODY_SIZE_BYTES", "");
  if (raw === "") {
    return defaultMaxRequestBodySizeBytes;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`HEXCLAVE_MAX_REQUEST_BODY_SIZE_BYTES must be a positive integer number of bytes, got: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/**
 * Matches the error srvx rejects body reads with once the accumulated body exceeds
 * `maxRequestBodySize`. The request pipeline maps it to an HTTP 413 instead of the sanitized
 * 500 an unknown error would produce.
 *
 * Deliberately matches ONLY srvx's `code: "ERR_BODY_TOO_LARGE"` marker (verified to survive
 * the createBackendRequest re-wrap of the body stream), NOT the error's `status`/`statusCode`
 * fields: a route handler may intentionally throw its own `StatusError` with statusCode 413
 * and a descriptive message (e.g. the deploy route's tarball-size check), and a status-based
 * match would intercept it in catchError and silently replace that message with the generic
 * "Payload Too Large".
 */
export function isRequestBodyTooLargeError(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }
  return "code" in error && error.code === "ERR_BODY_TOO_LARGE";
}

import.meta.vitest?.test("the body size limit is env-overridable and rejects invalid values", ({ expect }) => {
  const { vi } = import.meta.vitest!;
  try {
    expect(getMaxRequestBodySizeBytes()).toBe(defaultMaxRequestBodySizeBytes);
    vi.stubEnv("HEXCLAVE_MAX_REQUEST_BODY_SIZE_BYTES", "1048576");
    expect(getMaxRequestBodySizeBytes()).toBe(1048576);
    vi.stubEnv("HEXCLAVE_MAX_REQUEST_BODY_SIZE_BYTES", "not-a-number");
    expect(() => getMaxRequestBodySizeBytes()).toThrow("HEXCLAVE_MAX_REQUEST_BODY_SIZE_BYTES");
    vi.stubEnv("HEXCLAVE_MAX_REQUEST_BODY_SIZE_BYTES", "-1");
    expect(() => getMaxRequestBodySizeBytes()).toThrow("HEXCLAVE_MAX_REQUEST_BODY_SIZE_BYTES");
  } finally {
    vi.unstubAllEnvs();
  }
});

import.meta.vitest?.test("only srvx body-too-large errors are recognized", async ({ expect }) => {
  const { StatusError } = await import("@hexclave/shared/dist/utils/errors");
  expect(isRequestBodyTooLargeError(Object.assign(new Error("too large"), { code: "ERR_BODY_TOO_LARGE" }))).toBe(true);
  // A route-thrown 413 StatusError with a descriptive message must NOT match — catchError
  // has to pass it through untouched instead of replacing it with the generic 413.
  expect(isRequestBodyTooLargeError(new StatusError(StatusError.PayloadTooLarge, "The uploaded tarball is too large (max 123 bytes)."))).toBe(false);
  expect(isRequestBodyTooLargeError({ status: 413, statusCode: 413 })).toBe(false);
  expect(isRequestBodyTooLargeError(new Error("some other error"))).toBe(false);
  expect(isRequestBodyTooLargeError(null)).toBe(false);
  expect(isRequestBodyTooLargeError("ERR_BODY_TOO_LARGE")).toBe(false);
});
