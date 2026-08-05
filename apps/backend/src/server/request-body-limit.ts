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
 * `maxRequestBodySize` (it carries `code: "ERR_BODY_TOO_LARGE"` and `status`/`statusCode` 413).
 * The request pipeline maps it to an HTTP 413 instead of the sanitized 500 an unknown error
 * would produce.
 */
export function isRequestBodyTooLargeError(error: unknown): boolean {
  if (error == null || typeof error !== "object") {
    return false;
  }
  if ("code" in error && error.code === "ERR_BODY_TOO_LARGE") {
    return true;
  }
  return ("statusCode" in error && error.statusCode === 413)
    || ("status" in error && error.status === 413);
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

import.meta.vitest?.test("only srvx body-too-large errors are recognized", ({ expect }) => {
  expect(isRequestBodyTooLargeError(Object.assign(new Error("too large"), { code: "ERR_BODY_TOO_LARGE" }))).toBe(true);
  expect(isRequestBodyTooLargeError({ status: 413, statusCode: 413 })).toBe(true);
  expect(isRequestBodyTooLargeError(new Error("some other error"))).toBe(false);
  expect(isRequestBodyTooLargeError(null)).toBe(false);
  expect(isRequestBodyTooLargeError("ERR_BODY_TOO_LARGE")).toBe(false);
});
