import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export type TrustedProxy = "" | "vercel" | "cloudflare" | "cloudrun" | "generic";

export function getTrustedProxy(): TrustedProxy {
  return parseTrustedProxy(getEnvVariable("STACK_TRUSTED_PROXY", ""));
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
      "STACK_TRUSTED_PROXY must be configured when a production-like standalone backend uses an HTTPS NEXT_PUBLIC_STACK_API_URL. "
      + 'Use "generic" only for a locked-down reverse proxy that overwrites X-Real-IP, X-Forwarded-Host, and X-Forwarded-Proto, '
      + 'or use "vercel", "cloudflare", or "cloudrun" for the matching provider. '
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
    `STACK_TRUSTED_PROXY must be "vercel", "cloudflare", "cloudrun", "generic", or empty/unset, but got: "${normalizedValue}"`,
  );
}

import.meta.vitest?.test("trusted proxy configuration is normalized and validated", ({ expect }) => {
  expect(parseTrustedProxy("  CloudRun ")).toBe("cloudrun");
  expect(parseTrustedProxy(" Generic ")).toBe("generic");
  expect(parseTrustedProxy("")).toBe("");
  expect(() => parseTrustedProxy("any-proxy")).toThrowErrorMatchingInlineSnapshot(
    `
      [HexclaveAssertionError: STACK_TRUSTED_PROXY must be "vercel", "cloudflare", "cloudrun", "generic", or empty/unset, but got: "any-proxy"

      This is likely an error in Hexclave. Please make sure you are running the newest version and report it.]
    `,
  );
});
