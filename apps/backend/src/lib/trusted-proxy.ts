import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export type TrustedProxy = "" | "vercel" | "cloudflare" | "cloudrun" | "generic";

export function getTrustedProxy(): TrustedProxy {
  const configuredProxy = parseTrustedProxy(getEnvVariable("HEXCLAVE_TRUSTED_PROXY", ""));
  if (configuredProxy !== "") {
    return configuredProxy;
  }

  // These variables are injected by the platforms themselves, so they are stronger evidence
  // than request headers (which a direct client can spoof). Generic reverse proxies cannot be
  // inferred safely because Node has no trustworthy way to distinguish the proxy from a client
  // reaching the origin directly.
  if (getEnvVariable("VERCEL", "") === "1") {
    return "vercel";
  }
  if (
    getEnvVariable("K_SERVICE", "") !== ""
    && getEnvVariable("K_REVISION", "") !== ""
    && getEnvVariable("K_CONFIGURATION", "") !== ""
  ) {
    return "cloudrun";
  }
  return "";
}

export function validateStandaloneTrustedProxyConfiguration(options: {
  nodeEnvironment: string,
  publicApiUrl: string,
  trustedProxy: TrustedProxy,
}): void {
  // srvx ignores forwarded host/protocol metadata unless proxy trust is enabled. For an HTTPS
  // public URL that silently turns request-derived OAuth/IDP URLs into internal HTTP URLs, so a
  // standalone production-like process must make the trust decision explicitly before listening.
  if (
    options.nodeEnvironment === "development"
    || options.nodeEnvironment === "test"
    || options.trustedProxy !== ""
  ) {
    return;
  }

  if (new URL(options.publicApiUrl).protocol === "https:") {
    throw new Error(
      "HEXCLAVE_TRUSTED_PROXY must be configured when a production-like standalone backend uses an HTTPS NEXT_PUBLIC_HEXCLAVE_API_URL. "
      + 'Use "generic" only for a locked-down reverse proxy that overwrites X-Real-IP, X-Forwarded-Host, and X-Forwarded-Proto, '
      + 'or use "vercel", "cloudflare", or "cloudrun" for the matching provider. '
      + "The legacy STACK_TRUSTED_PROXY name is also accepted. "
      + "Do not enable proxy trust while the backend origin is directly reachable.",
    );
  }
}

function parseTrustedProxy(value: string): TrustedProxy {
  const normalizedValue = value.toLowerCase().trim();
  if (
    normalizedValue === ""
    || normalizedValue === "vercel"
    || normalizedValue === "cloudflare"
    || normalizedValue === "cloudrun"
    || normalizedValue === "generic"
  ) {
    return normalizedValue;
  }
  throw new HexclaveAssertionError(
    `HEXCLAVE_TRUSTED_PROXY must be "vercel", "cloudflare", "cloudrun", "generic", or empty/unset, but got: "${normalizedValue}"`,
  );
}

const vitest = import.meta.vitest;
if (vitest != null) {
  const { afterEach, expect, test, vi } = vitest;
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("trusted proxy configuration is normalized and validated", () => {
    expect(parseTrustedProxy("  CloudRun ")).toBe("cloudrun");
    expect(parseTrustedProxy(" Generic ")).toBe("generic");
    expect(parseTrustedProxy("")).toBe("");
    expect(() => parseTrustedProxy("any-proxy")).toThrowErrorMatchingInlineSnapshot(
      `
      [HexclaveAssertionError: HEXCLAVE_TRUSTED_PROXY must be "vercel", "cloudflare", "cloudrun", "generic", or empty/unset, but got: "any-proxy"

      This is likely an error in Hexclave. Please make sure you are running the newest version and report it.]
    `,
    );
  });

  test("explicit proxy configuration takes precedence over platform detection", () => {
    vi.stubEnv("HEXCLAVE_TRUSTED_PROXY", "generic");
    vi.stubEnv("VERCEL", "1");
    expect(getTrustedProxy()).toBe("generic");
  });

  test("Vercel proxy trust is inferred from the platform environment", () => {
    vi.stubEnv("VERCEL", "1");
    expect(getTrustedProxy()).toBe("vercel");
  });

  test("Cloud Run proxy trust is inferred only from the complete platform environment", () => {
    vi.stubEnv("K_SERVICE", "hexclave");
    vi.stubEnv("K_REVISION", "hexclave-00001");
    expect(getTrustedProxy()).toBe("");

    vi.stubEnv("K_CONFIGURATION", "hexclave");
    expect(getTrustedProxy()).toBe("cloudrun");
  });
}
