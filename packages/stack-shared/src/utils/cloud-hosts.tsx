/**
 * Single source of truth for the stack-auth ↔ hexclave host pairs that the
 * cloud deployment treats as equivalent siblings. Each
 * `[stackAuthHost, hexclaveHost]` pair is consumed in a few places:
 *
 * 1. `CLOUD_API_HOST_BY_REQUEST_HOST` in the backend's `request-api-url.ts` —
 *    the allowlist of request hosts we resolve into a JWT `iss` claim.
 * 2. `issuerHostAliases` in `tokens.tsx` — the bidirectional validator alias
 *    map, so a token issued under either host validates against the other.
 * 3. `getCloudApiUrlSiblings` below — resolves the branded base URLs used for
 *    OAuth `redirect_uri` callbacks (both at runtime and in the dashboard).
 *
 * Deriving all of these from this one list prevents drift.
 */
export const CLOUD_HOST_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["api.stack-auth.com", "api.hexclave.com"],
  ["api.dev.stack-auth.com", "api.dev.hexclave.com"],
  ["api.staging.stack-auth.com", "api.staging.hexclave.com"],
];

function hostFromApiUrlOrHost(input: string): string | undefined {
  try {
    return new URL(input).host.split(":")[0].toLowerCase();
  } catch {
    const firstHost = input.split(",")[0]?.trim();
    if (!firstHost) return undefined;
    return firstHost.split(":")[0].toLowerCase();
  }
}

/**
 * Given an API URL (or bare host), if its host belongs to a known
 * stack-auth ↔ hexclave cloud pair, return both branded base URLs. Returns
 * null for unknown hosts (localhost, vercel previews, self-host custom
 * domains).
 */
export function getCloudApiUrlSiblings(apiUrlOrHost: string | undefined | null): { stackAuth: string, hexclave: string } | null {
  if (!apiUrlOrHost) return null;
  const host = hostFromApiUrlOrHost(apiUrlOrHost);
  if (!host) return null;
  for (const [stackAuthHost, hexclaveHost] of CLOUD_HOST_PAIRS) {
    if (host === stackAuthHost || host === hexclaveHost) {
      return { stackAuth: `https://${stackAuthHost}`, hexclave: `https://${hexclaveHost}` };
    }
  }
  return null;
}

/**
 * The stack-auth-branded base URL for the given deployment API URL. Used as the
 * OAuth `redirect_uri` base for shared providers and for custom providers that
 * predate `customCallbackUrl` (so existing flows keep hitting
 * `api.stack-auth.com`). Unknown hosts fall back to the input unchanged.
 */
export function getStackAuthApiBaseUrl(apiUrl: string): string {
  return getCloudApiUrlSiblings(apiUrl)?.stackAuth ?? apiUrl;
}

/**
 * The hexclave-branded base URL for the given deployment API URL. Used when a
 * new custom OAuth provider is set up, so its `customCallbackUrl` points at the
 * hexclave brand. Unknown hosts fall back to the input unchanged.
 */
export function getHexclaveApiBaseUrl(apiUrl: string): string {
  return getCloudApiUrlSiblings(apiUrl)?.hexclave ?? apiUrl;
}

import.meta.vitest?.test("getCloudApiUrlSiblings maps both sides of each cloud pair", ({ expect }) => {
  for (const [stackAuthHost, hexclaveHost] of CLOUD_HOST_PAIRS) {
    const expected = { stackAuth: `https://${stackAuthHost}`, hexclave: `https://${hexclaveHost}` };
    for (const host of [stackAuthHost, hexclaveHost]) {
      expect(getCloudApiUrlSiblings(host)).toEqual(expected);
      expect(getCloudApiUrlSiblings(`https://${host}`)).toEqual(expected);
      expect(getCloudApiUrlSiblings(`https://${host.toUpperCase()}:443`)).toEqual(expected);
    }
  }
});

import.meta.vitest?.test("getCloudApiUrlSiblings returns null for unknown hosts", ({ expect }) => {
  expect(getCloudApiUrlSiblings("http://localhost:8102")).toBeNull();
  expect(getCloudApiUrlSiblings("https://my-app.vercel.app")).toBeNull();
  expect(getCloudApiUrlSiblings(undefined)).toBeNull();
  expect(getCloudApiUrlSiblings("")).toBeNull();
});

import.meta.vitest?.test("getStackAuthApiBaseUrl / getHexclaveApiBaseUrl resolve brands and fall back", ({ expect }) => {
  expect(getStackAuthApiBaseUrl("https://api.hexclave.com")).toBe("https://api.stack-auth.com");
  expect(getHexclaveApiBaseUrl("https://api.stack-auth.com")).toBe("https://api.hexclave.com");
  expect(getStackAuthApiBaseUrl("https://api.dev.stack-auth.com")).toBe("https://api.dev.stack-auth.com");
  expect(getHexclaveApiBaseUrl("http://localhost:8102")).toBe("http://localhost:8102");
  expect(getStackAuthApiBaseUrl("http://localhost:8102")).toBe("http://localhost:8102");
});
