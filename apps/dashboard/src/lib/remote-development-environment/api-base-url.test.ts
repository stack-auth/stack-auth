import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function isAllowedApiBaseUrl(value: string): Promise<boolean> {
  const { isAllowedRemoteDevelopmentEnvironmentApiBaseUrl } = await import("./api-base-url");
  return isAllowedRemoteDevelopmentEnvironmentApiBaseUrl(value);
}

describe("remote development environment API base URL allowlist", () => {
  it("accepts the production Stack API host", async () => {
    await expect(isAllowedApiBaseUrl("https://api.hexclave.com")).resolves.toBe(true);
    await expect(isAllowedApiBaseUrl("https://api.hexclave.com/")).resolves.toBe(true);
  });

  it("accepts the exact local API base URL passed to the dashboard", async () => {
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "http://127.0.0.1:8102");

    await expect(isAllowedApiBaseUrl("http://127.0.0.1:8102")).resolves.toBe(true);
  });

  it("rejects arbitrary loopback hosts", async () => {
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "http://127.0.0.1:8102");

    await expect(isAllowedApiBaseUrl("http://127.1.2.3:8102")).resolves.toBe(false);
  });

  it("rejects arbitrary hexclave subdomains", async () => {
    await expect(isAllowedApiBaseUrl("https://evil.hexclave.com")).resolves.toBe(false);
  });

  it("accepts explicit custom hosts from the STACK-prefixed allowlist", async () => {
    vi.stubEnv("STACK_RDE_API_BASE_URL_ALLOWLIST", "https://api.staging.hexclave.com");

    await expect(isAllowedApiBaseUrl("https://api.staging.hexclave.com")).resolves.toBe(true);
  });
});
