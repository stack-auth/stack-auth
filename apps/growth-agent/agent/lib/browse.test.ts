import { afterEach, describe, expect, it, vi } from "vitest";
import { isBrowseSandboxAvailable } from "./browse.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isBrowseSandboxAvailable", () => {
  it("allows local development to use hosted Vercel sandboxes when explicitly pinned", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("HEXCLAVE_GROWTH_SANDBOX_BACKEND", "vercel");
    vi.stubEnv("VERCEL_TOKEN", "token");
    vi.stubEnv("VERCEL_TEAM_ID", "team");
    vi.stubEnv("VERCEL_PROJECT_ID", "project");

    expect(isBrowseSandboxAvailable()).toBe(true);
  });

  it("keeps the browser unavailable when local development is pinned to Docker", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("HEXCLAVE_GROWTH_SANDBOX_BACKEND", "docker");
    vi.stubEnv("VERCEL_TOKEN", "token");
    vi.stubEnv("VERCEL_TEAM_ID", "team");
    vi.stubEnv("VERCEL_PROJECT_ID", "project");

    expect(isBrowseSandboxAvailable()).toBe(false);
  });

  it("accepts automatic OIDC credentials in a Vercel deployment", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc-token");

    expect(isBrowseSandboxAvailable()).toBe(true);
  });

  it("rejects a Vercel deployment without complete sandbox credentials", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_TOKEN", "token");
    vi.stubEnv("VERCEL_TEAM_ID", "team");
    vi.stubEnv("VERCEL_PROJECT_ID", "");

    expect(isBrowseSandboxAvailable()).toBe(false);
  });
});
