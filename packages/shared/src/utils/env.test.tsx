import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvVariable, getProcessEnv, resolveHexclaveStackEnvVarValue } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Hexclave/Stack env var dual-read", () => {
  it("falls back to the legacy Stack name when the Hexclave value is empty", () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://stack.example.test");

    expect(getEnvVariable("NEXT_PUBLIC_STACK_API_URL")).toBe("https://stack.example.test");
    expect(getProcessEnv("NEXT_PUBLIC_STACK_API_URL")).toBe("https://stack.example.test");
  });

  it("allows both names when they have the same non-empty value", () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "https://api.example.test");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://api.example.test");

    expect(getEnvVariable("NEXT_PUBLIC_STACK_API_URL")).toBe("https://api.example.test");
    expect(getProcessEnv("NEXT_PUBLIC_STACK_API_URL")).toBe("https://api.example.test");
  });

  it("throws when both names are non-empty and different", () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "https://hexclave.example.test");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://stack.example.test");

    expect(() => getEnvVariable("NEXT_PUBLIC_STACK_API_URL")).toThrow(/NEXT_PUBLIC_HEXCLAVE_API_URL.*NEXT_PUBLIC_STACK_API_URL.*different values/);
    expect(() => getProcessEnv("NEXT_PUBLIC_STACK_API_URL")).toThrow(/NEXT_PUBLIC_HEXCLAVE_API_URL.*NEXT_PUBLIC_STACK_API_URL.*different values/);
  });

  it("checks renamed legacy aliases when falling back", () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_URL", "https://hexclave-url.example.test");
    vi.stubEnv("NEXT_PUBLIC_STACK_URL", "https://stack-url.example.test");

    expect(() => getEnvVariable("NEXT_PUBLIC_STACK_API_URL")).toThrow(/NEXT_PUBLIC_HEXCLAVE_URL.*NEXT_PUBLIC_STACK_URL.*different values/);
  });

  it("returns undefined when both names are empty", () => {
    expect(resolveHexclaveStackEnvVarValue("HEXCLAVE_FOO", "STACK_FOO", "", "")).toBeUndefined();
  });

  it("falls back to the legacy Stack name when a canonical Hexclave name is looked up", () => {
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://stack.example.test");

    // Caller passes the canonical HEXCLAVE_ name but only the legacy value is set.
    expect(getEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL")).toBe("https://stack.example.test");
    expect(getProcessEnv("NEXT_PUBLIC_HEXCLAVE_API_URL")).toBe("https://stack.example.test");
  });

  it("throws on a conflict when a canonical Hexclave name is looked up", () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "https://hexclave.example.test");
    vi.stubEnv("NEXT_PUBLIC_STACK_API_URL", "https://stack.example.test");

    expect(() => getEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL")).toThrow(/NEXT_PUBLIC_HEXCLAVE_API_URL.*NEXT_PUBLIC_STACK_API_URL.*different values/);
  });
});
