import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { growthSandboxBackend } from "./sandbox-backend.ts";

/**
 * These tests pin the decision that used to be implicit. The whole point of sandbox-backend.ts is
 * that "which runtime hosts the sandbox" must never again be decided by whatever happens to be in
 * the environment, so the precedence rules are asserted rather than assumed.
 *
 * Backends are compared by their `name`, which eve documents as the stable identifier participating
 * in template-cache keys — "docker" and "vercel" (eve's own doc comment says "local" for
 * the Docker backend, but the shipped value is "docker"; these tests assert the real one).
 */

const OPTIONS = {
  docker: { networkPolicy: "deny-all" },
  vercel: { networkPolicy: "deny-all" },
} as const;

const ENV_VAR = "HEXCLAVE_GROWTH_SANDBOX_BACKEND";

describe("growthSandboxBackend", () => {
  let savedOverride: string | undefined;
  let savedVercel: string | undefined;

  beforeEach(() => {
    savedOverride = process.env[ENV_VAR];
    savedVercel = process.env.VERCEL;
    delete process.env[ENV_VAR];
    delete process.env.VERCEL;
  });

  afterEach(() => {
    if (savedOverride === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = savedOverride;
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
  });

  it("defaults to docker when nothing in the environment says otherwise", () => {
    expect(growthSandboxBackend(OPTIONS).name).toMatchInlineSnapshot(`"docker"`);
  });

  it("uses vercel when running on a real Vercel deployment", () => {
    process.env.VERCEL = "1";
    expect(growthSandboxBackend(OPTIONS).name).toMatchInlineSnapshot(`"vercel"`);
  });

  it("lets the explicit override force docker even on a Vercel deployment", () => {
    // The override losing to VERCEL would make the local pin unenforceable, which is the exact
    // failure this module exists to prevent.
    process.env.VERCEL = "1";
    process.env[ENV_VAR] = "docker";
    expect(growthSandboxBackend(OPTIONS).name).toMatchInlineSnapshot(`"docker"`);
  });

  it("lets the explicit override force vercel with no VERCEL env var", () => {
    process.env[ENV_VAR] = "vercel";
    expect(growthSandboxBackend(OPTIONS).name).toMatchInlineSnapshot(`"vercel"`);
  });

  it("treats an empty override as unset rather than as an error", () => {
    // Shell and dotenv plumbing produce empty strings for "not configured" all the time; failing
    // there would break deployments that never opted in.
    process.env[ENV_VAR] = "";
    expect(growthSandboxBackend(OPTIONS).name).toMatchInlineSnapshot(`"docker"`);
  });

  it("throws on an unrecognised override instead of silently falling back", () => {
    process.env[ENV_VAR] = "modal";
    expect(() => growthSandboxBackend(OPTIONS)).toThrowErrorMatchingInlineSnapshot(
      `[Error: HEXCLAVE_GROWTH_SANDBOX_BACKEND must be one of docker, vercel, got "modal". Fail loudly rather than guessing: picking the wrong one either bills a hosted sandbox for every local run or breaks a deployment that cannot run containers.]`,
    );
  });

  it("is read per call, so a deployment can change it without a rebuild", () => {
    expect(growthSandboxBackend(OPTIONS).name).toBe("docker");
    process.env[ENV_VAR] = "vercel";
    expect(growthSandboxBackend(OPTIONS).name).toBe("vercel");
  });
});
