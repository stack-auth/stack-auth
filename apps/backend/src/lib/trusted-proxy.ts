import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export type TrustedProxy = "" | "vercel" | "cloudflare" | "cloudrun" | "generic";

export function getTrustedProxy(): TrustedProxy {
  return parseTrustedProxy(getEnvVariable("STACK_TRUSTED_PROXY", ""));
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
