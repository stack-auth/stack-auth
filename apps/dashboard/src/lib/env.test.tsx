import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnvModule() {
  vi.resetModules();
  return await import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("dashboard public env var dual-read", () => {
  it("falls back to the legacy Stack name when the Hexclave value is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://stack.example.test");

    const { getPublicEnvVar } = await loadEnvModule();

    expect(getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL")).toBe("https://stack.example.test");
  });

  it("allows both names when they have the same non-empty value", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "https://api.example.test");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://api.example.test");

    const { getPublicEnvVar } = await loadEnvModule();

    expect(getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL")).toBe("https://api.example.test");
  });

  it("throws when both names are non-empty and different", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "https://hexclave.example.test");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://stack.example.test");

    await expect(loadEnvModule()).rejects.toThrow(/NEXT_PUBLIC_HEXCLAVE_API_URL.*NEXT_PUBLIC_STACK_API_URL.*different values/);
  });

  it("does not treat unreplaced post-build sentinels as a conflict", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "STACK_ENV_VAR_SENTINEL_NEXT_PUBLIC_HEXCLAVE_API_URL");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "STACK_ENV_VAR_SENTINEL_NEXT_PUBLIC_STACK_API_URL");

    await expect(loadEnvModule()).resolves.toBeDefined();
  });

  it("prefers a real value over a sentinel value", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "STACK_ENV_VAR_SENTINEL_NEXT_PUBLIC_HEXCLAVE_API_URL");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://stack.example.test");

    const { getPublicEnvVar } = await loadEnvModule();

    expect(getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL")).toBe("https://stack.example.test");
  });
});
