import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRetryableFetchError, localEmulatorReadyTimeoutMs, resolveProjectId } from "./auth.js";

describe("isRetryableFetchError", () => {
  it("retries TypeError (Node fetch wraps connection errors as TypeError)", () => {
    expect(isRetryableFetchError(new TypeError("fetch failed"))).toBe(true);
  });

  it("retries AbortError and TimeoutError (per-request signal fired)", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isRetryableFetchError(abort)).toBe(true);
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(isRetryableFetchError(timeout)).toBe(true);
  });

  it("retries ECONNREFUSED / ENOTFOUND / ETIMEDOUT / ECONNRESET messages", () => {
    expect(isRetryableFetchError(new Error("connect ECONNREFUSED 127.0.0.1:1"))).toBe(true);
    expect(isRetryableFetchError(new Error("getaddrinfo ENOTFOUND foo"))).toBe(true);
    expect(isRetryableFetchError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryableFetchError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("retries non-Error throws (defensive: unknown shape, give it another go)", () => {
    expect(isRetryableFetchError("string")).toBe(true);
    expect(isRetryableFetchError(undefined)).toBe(true);
    expect(isRetryableFetchError({ weird: true })).toBe(true);
  });

  it("does not retry generic Errors that aren't transport-shaped", () => {
    expect(isRetryableFetchError(new Error("something else broke"))).toBe(false);
    expect(isRetryableFetchError(new SyntaxError("bad json"))).toBe(false);
  });
});

describe("localEmulatorReadyTimeoutMs", () => {
  const SAVED = process.env.STACK_EMULATOR_READY_TIMEOUT_MS;
  beforeEach(() => {
    delete process.env.STACK_EMULATOR_READY_TIMEOUT_MS;
  });
  afterEach(() => {
    if (SAVED === undefined) delete process.env.STACK_EMULATOR_READY_TIMEOUT_MS;
    else process.env.STACK_EMULATOR_READY_TIMEOUT_MS = SAVED;
  });

  it("returns the default when the env var is unset", () => {
    expect(localEmulatorReadyTimeoutMs()).toBe(10_000);
  });

  it("treats empty string as unset", () => {
    process.env.STACK_EMULATOR_READY_TIMEOUT_MS = "";
    expect(localEmulatorReadyTimeoutMs()).toBe(10_000);
  });

  it("parses a valid non-negative integer (including 0 for fail-fast)", () => {
    process.env.STACK_EMULATOR_READY_TIMEOUT_MS = "0";
    expect(localEmulatorReadyTimeoutMs()).toBe(0);
    process.env.STACK_EMULATOR_READY_TIMEOUT_MS = "2500";
    expect(localEmulatorReadyTimeoutMs()).toBe(2500);
  });

  it("rejects negative, non-integer, and non-numeric values", () => {
    process.env.STACK_EMULATOR_READY_TIMEOUT_MS = "-1";
    expect(() => localEmulatorReadyTimeoutMs()).toThrow(/Invalid STACK_EMULATOR_READY_TIMEOUT_MS/);
    process.env.STACK_EMULATOR_READY_TIMEOUT_MS = "1.5";
    expect(() => localEmulatorReadyTimeoutMs()).toThrow(/Invalid STACK_EMULATOR_READY_TIMEOUT_MS/);
    process.env.STACK_EMULATOR_READY_TIMEOUT_MS = "abc";
    expect(() => localEmulatorReadyTimeoutMs()).toThrow(/Invalid STACK_EMULATOR_READY_TIMEOUT_MS/);
  });
});

describe("resolveProjectId", () => {
  const SAVED = process.env.STACK_PROJECT_ID;
  const SAVED_HEXCLAVE = process.env.HEXCLAVE_PROJECT_ID;
  beforeEach(() => {
    delete process.env.STACK_PROJECT_ID;
    delete process.env.HEXCLAVE_PROJECT_ID;
  });
  afterEach(() => {
    if (SAVED === undefined) delete process.env.STACK_PROJECT_ID;
    else process.env.STACK_PROJECT_ID = SAVED;
    if (SAVED_HEXCLAVE === undefined) delete process.env.HEXCLAVE_PROJECT_ID;
    else process.env.HEXCLAVE_PROJECT_ID = SAVED_HEXCLAVE;
  });

  it("uses the --cloud-project-id option when provided", () => {
    expect(resolveProjectId("proj_from_flag")).toBe("proj_from_flag");
  });

  it("falls back to the STACK_PROJECT_ID env var when the option is omitted", () => {
    process.env.STACK_PROJECT_ID = "proj_from_env";
    expect(resolveProjectId(undefined)).toBe("proj_from_env");
  });

  it("prefers the option over the env var", () => {
    process.env.STACK_PROJECT_ID = "proj_from_env";
    expect(resolveProjectId("proj_from_flag")).toBe("proj_from_flag");
  });

  it("treats an empty option string as absent and falls back to the env var", () => {
    process.env.STACK_PROJECT_ID = "proj_from_env";
    expect(resolveProjectId("")).toBe("proj_from_env");
  });

  it("throws a CliError with help text when neither is provided", () => {
    expect(() => resolveProjectId(undefined)).toThrow(/HEXCLAVE_PROJECT_ID/);
  });
});
